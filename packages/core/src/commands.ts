/**
 * Command Bus (SPEC.md §2, §14).
 *
 * Every mutation takes this path and only this path: validation, authorization,
 * transaction, handler, revision collection, events, audit. Studio, REST, the SDK,
 * the CLI and MCP are all callers of the same bus, so an agent's action passes
 * exactly the checks a user's click passes.
 */
import { type InferShape, object, type Schema, type Shape } from '@assemora/schema'

import { type AssemoraContext, contextOrInternal } from './context.js'
import { UnknownCommandError, ValidationError } from './errors.js'
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
  handle(input: InferShape<S>, context: CommandContext): Promise<R>
}

/** A command of any shape, as stored by the bus. */
export type AnyCommand = {
  readonly name: string
  readonly description: string | undefined
  readonly input: Schema<unknown>
  handle(input: never, context: CommandContext): Promise<unknown>
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
    handle(input: InferShape<S>, context: CommandContext): Promise<R>
  },
): CommandDefinition<S, R> => ({
  name,
  description: definition.description,
  input: object(definition.input),
  handle: definition.handle,
})

export type CommandBus = {
  register(definition: AnyCommand, module?: string): void
  execute<S extends Shape, R>(definition: CommandDefinition<S, R>, input: unknown): Promise<R>
  execute(name: string, input: unknown): Promise<unknown>
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

  const run = async (definition: AnyCommand, rawInput: unknown): Promise<unknown> => {
    const context = contextOrInternal()
    const startedAt = performance.now()

    const audit = (outcome: 'succeeded' | 'failed', metadata?: Record<string, unknown>) =>
      options.audit.record({
        action: definition.name,
        source: context.source,
        requestId: context.requestId,
        ...(context.actor === undefined ? {} : { actor: context.actor }),
        outcome,
        durationMs: performance.now() - startedAt,
        ...(metadata === undefined ? {} : { metadata }),
      })

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

      // 3-5. Transaction, handler, revisions.
      const result = await options.transactions.run(async () => {
        const handled = await (
          definition.handle as (input: unknown, context: CommandContext) => Promise<unknown>
        )(parsed.value, commandContext)

        if (revisions.length > 0) await options.revisions.record(revisions)

        return handled
      })

      // 6. Events, only once the change is durable.
      for (const event of queued) {
        await options.events.emit(event.name, event.payload as PayloadOf<string>)
      }

      // 7. Audit.
      await audit('succeeded', { revisions: revisions.length, events: queued.length })

      return result
    } catch (error) {
      await audit('failed', {
        reason: error instanceof Error ? error.message : String(error),
      })
      throw error
    }
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
      if (typeof target !== 'string') return run(target, input) as Promise<never>

      const definition = registered.get(target)
      if (definition === undefined) throw new UnknownCommandError(target)

      return run(definition, input) as Promise<never>
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
