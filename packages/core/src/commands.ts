/**
 * Command Bus (SPEC.md §2, §14).
 *
 * Every mutation takes this path and only this path: validation, authorization,
 * transaction, handler, revision collection, events, audit. Studio, REST, the SDK,
 * the CLI and MCP are all callers of the same bus, so an agent's action passes
 * exactly the checks a user's click passes.
 */
import {
  diff,
  type InferShape,
  object,
  type Patch,
  type Schema,
  type Shape,
} from '@assemora/schema'

import { type AssemoraContext, contextOrInternal } from './context.js'
import { AssemoraError, UnknownCommandError, ValidationError } from './errors.js'
import type { EventBus, PayloadOf } from './events.js'
import type { Logger } from './logger.js'
import type {
  AuditPort,
  AuthorizationPort,
  RevisionDraft,
  RevisionEntry,
  TransactionPort,
} from './ports.js'
import type { SchemaRegistry } from './registry.js'

/** What a handler receives in addition to its validated input. */
export type CommandContext = AssemoraContext & {
  readonly logger: Logger
  /** Queues a side effect. Listeners run after the transaction commits (SPEC.md §81). */
  emit<K extends string>(name: K, payload: PayloadOf<K>): void
  /** Records a reversible change. Written inside the transaction (SPEC.md §64). */
  revise(draft: RevisionDraft): void
  /**
   * Asks whether the actor may act on this particular record (SPEC.md §51).
   *
   * A handler calls it once the row is loaded and before anything is written, so a
   * record-level rule sits in the mutation path like every other check.
   */
  authorize(subject: string, action: string, record: unknown): Promise<void>
}

export type CommandDefinition<S extends Shape, R> = {
  readonly name: string
  readonly description: string | undefined
  readonly input: Schema<InferShape<S>>
  /**
   * Whether this command can honestly be previewed (SPEC.md §73).
   *
   * A dry run undoes the transaction, which undoes rows and nothing else. A handler
   * that writes a file or calls another service half-runs and then reports that
   * nothing changed, so it says so here and `dryRun()` refuses it.
   */
  readonly previewable: boolean
  handle(input: InferShape<S>, context: CommandContext): Promise<R>
}

/** A command of any shape, as stored by the bus. */
export type AnyCommand = {
  readonly name: string
  readonly description: string | undefined
  readonly input: Schema<unknown>
  readonly previewable: boolean
  handle(input: never, context: CommandContext): Promise<unknown>
}

/** One entity a command would touch, and how (SPEC.md §73, §75). */
export type ChangedEntity = {
  readonly entityType: string
  readonly entityId: string
  readonly before: unknown
  readonly after: unknown
  readonly patch: Patch
}

/**
 * What a command *would* do, having done none of it (SPEC.md §73).
 *
 * The handler ran, the rows were written and the transaction was undone, so this is
 * the real answer of the real handler rather than a simulation of one.
 */
export type Preview = {
  readonly command: string
  readonly result: unknown
  readonly changes: readonly ChangedEntity[]
  /** The events it would emit. None of them were emitted. */
  readonly events: readonly string[]
}

/**
 * ```ts
 * export const PublishPage = command('pages.publish', {
 *   input: { id: uuid() },
 *   handle: async ({ id }, ctx) => { ... },
 * })
 * ```
 */
export const command = <S extends Shape, R>(
  name: string,
  definition: {
    readonly input: S
    readonly description?: string
    /** Defaults to true. Say `false` when the handler reaches outside the database. */
    readonly previewable?: boolean
    handle(input: InferShape<S>, context: CommandContext): Promise<R>
  },
): CommandDefinition<S, R> => ({
  name,
  description: definition.description,
  input: object(definition.input),
  previewable: definition.previewable ?? true,
  handle: definition.handle,
})

export type CommandBus = {
  register(definition: AnyCommand, module?: string): void
  execute<S extends Shape, R>(definition: CommandDefinition<S, R>, input: unknown): Promise<R>
  execute(name: string, input: unknown): Promise<unknown>
  /**
   * Runs a command and undoes it, answering with what it would have changed
   * (SPEC.md §73).
   *
   * Every stage a real command passes, this passes: a dry run an actor may not
   * perform is refused exactly as the command would be, so a preview can never be
   * used to find out what a forbidden command would do.
   */
  dryRun<S extends Shape, R>(definition: CommandDefinition<S, R>, input: unknown): Promise<Preview>
  dryRun(name: string, input: unknown): Promise<Preview>
  has(name: string): boolean
  names(): readonly string[]
}

export type CommandBusOptions = {
  readonly authorization: AuthorizationPort
  readonly transactions: TransactionPort
  readonly revisions: { record(entries: readonly RevisionEntry[]): Promise<void> }
  readonly audit: AuditPort
  readonly events: EventBus
  readonly registry: SchemaRegistry
  readonly logger: Logger
}

export const createCommandBus = (options: CommandBusOptions): CommandBus => {
  const registered = new Map<string, AnyCommand>()

  /**
   * The one pipeline, entered two ways (SPEC.md §14, §73).
   *
   * A preview runs every stage a real command runs — validation, authorization, the
   * handler, the revision collection — and then undoes the transaction instead of
   * committing it. It is not a simulation of the handler; it is the handler.
   */
  const run = async (
    definition: AnyCommand,
    rawInput: unknown,
    preview = false,
  ): Promise<unknown> => {
    const context = contextOrInternal()
    const startedAt = performance.now()

    /**
     * Records the attempt, and never fails because of it.
     *
     * The audit log is written after the transaction has already committed, so a
     * failure here cannot undo anything — and turning a successful publish into an
     * error because logging broke would be the wrong trade every time (SPEC.md §67).
     */
    const audit = async (
      outcome: 'succeeded' | 'failed' | 'previewed',
      metadata?: Record<string, unknown>,
      entity?: { readonly entityType: string; readonly entityId: string },
    ) => {
      try {
        await options.audit.record({
          action: definition.name,
          source: context.source,
          requestId: context.requestId,
          ...(context.actor === undefined ? {} : { actor: context.actor }),
          outcome,
          durationMs: performance.now() - startedAt,
          ...(entity ?? {}),
          ...(metadata === undefined ? {} : { metadata }),
        })
      } catch (error) {
        options.logger.error('The audit log could not be written', {
          command: definition.name,
          requestId: context.requestId,
          reason: error instanceof Error ? error.message : String(error),
        })
      }
    }

    // 1. Validation.
    const parsed = definition.input.parse(rawInput)

    if (!parsed.ok) {
      await audit('failed', { reason: 'VALIDATION_ERROR' })
      throw new ValidationError(parsed.issues)
    }

    try {
      // 2. Authorization — before anything is opened or written.
      await options.authorization.authorize({
        command: definition.name,
        input: parsed.value,
        context,
      })

      const revisions: RevisionEntry[] = []
      const queued: { readonly name: string; readonly payload: unknown }[] = []

      const commandContext: CommandContext = {
        ...context,
        logger: options.logger.child({ command: definition.name }),
        emit: (name, payload) => {
          queued.push({ name, payload })
        },
        authorize: async (subject, action, record) => {
          await options.authorization.authorizeRecord?.({ subject, action, record, context })
        },

        revise: (draft) => {
          revisions.push({
            ...draft,
            command: definition.name,
            requestId: context.requestId,
            ...(context.actor === undefined ? {} : { actor: context.actor }),
          })
        },
      }

      // 3-5. Transaction, handler, revisions. A preview undoes all three.
      const result = await options.transactions.run(
        async () => {
          const handled = await (
            definition.handle as (input: unknown, context: CommandContext) => Promise<unknown>
          )(parsed.value, commandContext)

          if (revisions.length > 0) await options.revisions.record(revisions)

          return handled
        },
        preview ? { rollback: true } : undefined,
      )

      if (preview) {
        // No events: nothing became durable, and a listener cannot be un-notified.
        await audit('previewed', { changes: revisions.length })

        return {
          command: definition.name,
          result,
          changes: revisions.map((revision) => ({
            entityType: revision.entityType,
            entityId: revision.entityId,
            before: revision.before,
            after: revision.after,
            patch: diff(revision.before, revision.after),
          })),
          events: queued.map((event) => event.name),
        } satisfies Preview
      }

      // 6. Events, only once the change is durable.
      for (const event of queued) {
        await options.events.emit(event.name, event.payload as PayloadOf<string>)
      }

      // 7. Audit. The first revision names what was acted on; a command that touched
      // several says how many.
      const acted = revisions[0]

      await audit(
        'succeeded',
        { revisions: revisions.length, events: queued.length },
        acted === undefined
          ? undefined
          : { entityType: acted.entityType, entityId: acted.entityId },
      )

      return result
    } catch (error) {
      await audit('failed', {
        reason: error instanceof Error ? error.message : String(error),
      })
      throw error
    }
  }

  const resolve = (target: AnyCommand | string): AnyCommand => {
    if (typeof target !== 'string') return target

    const definition = registered.get(target)

    if (definition === undefined) throw new UnknownCommandError(target)

    return definition
  }

  const bus: CommandBus = {
    register(definition, module) {
      registered.set(definition.name, definition)

      options.registry.register('commands', {
        name: definition.name,
        ...(definition.description === undefined ? {} : { description: definition.description }),
        input: definition.input.toJsonSchema(),
        ...(module === undefined ? {} : { module }),
      })
    },

    execute(target: AnyCommand | string, input: unknown): Promise<never> {
      return run(resolve(target), input) as Promise<never>
    },

    // `async`, so a refusal is a rejection: a method that promises a Promise must
    // not throw before there is one.
    async dryRun(target: AnyCommand | string, input: unknown): Promise<never> {
      const definition = resolve(target)

      if (!definition.previewable) {
        throw new AssemoraError(
          'NOT_PREVIEWABLE',
          `"${definition.name}" does something a transaction cannot undo, so it cannot be previewed`,
          { status: 422 },
        )
      }

      return (await run(definition, input, true)) as never
    },

    has(name) {
      return registered.has(name)
    },

    names() {
      return [...registered.keys()]
    },
  }

  return bus
}
