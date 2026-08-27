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
import { collectDispatches, type JobRequest, queuedFrom } from './jobs.js'
import type { Logger } from './logger.js'
import {
  type AuditPort,
  type AuthorizationPort,
  captureError,
  type ErrorReporting,
  type ErrorTrackingPort,
  logErrors,
  type QueuedJob,
  type QueuePort,
  type RevisionDraft,
  type RevisionEntry,
  type TransactionPort,
} from './ports.js'
import type { CommandReach, SchemaRegistry } from './registry.js'

/** What a handler receives in addition to its validated input. */
export type CommandContext = AssemoraContext & {
  readonly logger: Logger
  /** Queues a side effect. Listeners run after the transaction commits (SPEC.md §81). */
  emit<K extends string>(name: K, payload: PayloadOf<K>): void
  /**
   * Schedules durable work. Handed to the queue once the outermost transaction
   * commits (SPEC.md §82).
   *
   * It exists for the reason `emit` exists, and the free `dispatch()` writes into the
   * same batch: a job that reached a queue before a rollback would run against a
   * world that never existed (ADR-0023). "The outermost" and not "this command's" —
   * a command's own transaction may be a savepoint inside one that is still free to
   * undo everything it wrote.
   */
  dispatch(...jobs: readonly JobRequest[]): void
  /**
   * Holds work until the change this command made is durable (ADR-0023, SPEC.md §73).
   *
   * For the effects a transaction cannot undo *and that live in this process*:
   * registering a resource, warming a cache, swapping a compiled artefact. Rows are
   * the transaction's business; this is everything else a handler leaves behind.
   *
   * It is on the context and not reached for directly, and that is the whole point.
   * `TransactionPort.afterCommit` registers against the outermost commit, which is
   * exactly right for a handler that is committing and exactly wrong for one that is
   * being *previewed*: a preview is a savepoint inside somebody else's transaction,
   * so a handler calling the port itself would push its registration onto the outer
   * command's pending list and have it run when that command commits. A
   * `changesets.propose` — how an agent's mutation arrives by default (SPEC.md §75) —
   * would then apply for real what it promised only to describe. The bus withholds
   * jobs and events from a preview for that reason and cannot see past a handler that
   * goes around it, so this is the seam that cannot be gone around.
   *
   * It runs before the jobs and the events of the same command: those are told that
   * the change happened, and a listener must not be told before the change is
   * finished. Like them, it has no caller left to reject to, so a failure is logged
   * rather than thrown, and nothing that could still be refused for good belongs here.
   */
  afterCommit(work: () => void | Promise<void>): void
  /** Records a reversible change. Written inside the transaction (SPEC.md §64). */
  revise(draft: RevisionDraft): void
  /**
   * Asks whether the actor may act on this particular record (SPEC.md §51).
   *
   * A handler calls it once the row is loaded and before anything is written, so a
   * record-level rule sits in the mutation path like every other check.
   */
  authorize(subject: string, action: string, record: unknown): Promise<void>
  /**
   * Runs another command from inside this one (SPEC.md §14).
   *
   * The nested command opens a savepoint inside this transaction, so if the outer
   * one fails the inner writes go with it. `changesets.apply` is what needs this:
   * applying a proposal means running the commands it proposed, in the applier's
   * own context and under the applier's own permissions.
   */
  execute(command: string, input: unknown): Promise<unknown>
  /**
   * Previews a sequence of commands without performing any of them (SPEC.md §73).
   *
   * Used by `changesets.propose` to turn a proposal into a diff, and by
   * `changesets.apply` to check that the world has not moved underneath it.
   */
  preview(proposals: readonly Proposal[]): Promise<readonly Preview[]>
}

export type CommandDefinition<S extends Shape, R> = {
  readonly name: string
  readonly description: string | undefined
  readonly input: Schema<InferShape<S>>
  /**
   * What this command acts on, when that is not what its name says.
   *
   * A command name is a permission name (ADR-0015), and for nearly every command
   * the group in the name *is* the subject. `blocks.update` is the exception: it
   * edits a page, authorizes `pages.update` once the row is loaded, and would
   * otherwise demand two permissions with different names for one act.
   */
  readonly subject: string | undefined
  /**
   * Whether this command can honestly be previewed (SPEC.md §73).
   *
   * A dry run undoes the transaction, which undoes rows and nothing else. A handler
   * that writes a file or calls another service half-runs and then reports that
   * nothing changed, so it says so here and `dryRun()` refuses it.
   */
  readonly previewable: boolean
  /**
   * Where this command may be called from (SPEC.md §85).
   *
   * Every generated door — `POST /commands/<name>`, the MCP tool — exists because
   * the bus authorizes before a handler sees anything, and authorization denies by
   * default. A publicly authorized command has no such floor: the checks that make
   * it safe are in the route written for it, and a generated alias would bypass all
   * of them. Such a command says `'its own route'`, and the generators skip it.
   */
  readonly reachableFrom: CommandReach
  handle(input: InferShape<S>, context: CommandContext): Promise<R>
}

/** A command of any shape, as stored by the bus. */
export type AnyCommand = {
  readonly name: string
  readonly description: string | undefined
  readonly input: Schema<unknown>
  readonly subject: string | undefined
  readonly previewable: boolean
  readonly reachableFrom: CommandReach
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

/** One command somebody is proposing, not yet run (SPEC.md §74). */
export type Proposal = {
  readonly command: string
  readonly input: unknown
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
  /** The jobs it would dispatch. None of them were queued. */
  readonly jobs: readonly string[]
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
    /** What it acts on, when the command's own name does not say it. */
    readonly subject?: string
    /** Defaults to true. Say `false` when the handler reaches outside the database. */
    readonly previewable?: boolean
    /**
     * Defaults to `'anywhere'`. Say `'its own route'` when the command is publicly
     * authorized and a route written for it is what makes it safe.
     */
    readonly reachableFrom?: CommandReach
    handle(input: InferShape<S>, context: CommandContext): Promise<R>
  },
): CommandDefinition<S, R> => ({
  name,
  description: definition.description,
  input: object(definition.input),
  subject: definition.subject,
  previewable: definition.previewable ?? true,
  reachableFrom: definition.reachableFrom ?? 'anywhere',
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
  /**
   * Previews several commands as one sequence, and undoes all of them together
   * (SPEC.md §74).
   *
   * They run inside one transaction, so the second sees what the first did — "add a
   * block, then set its title" is one proposal, and previewing the steps separately
   * would leave the second one referring to something that had been rolled back.
   */
  dryRunAll(proposals: readonly Proposal[]): Promise<readonly Preview[]>
  has(name: string): boolean
  names(): readonly string[]
}

export type CommandBusOptions = {
  readonly authorization: AuthorizationPort
  readonly transactions: TransactionPort
  readonly revisions: { record(entries: readonly RevisionEntry[]): Promise<void> }
  readonly audit: AuditPort
  readonly events: EventBus
  /** Where a command's jobs go, once the change they were scheduled for is durable. */
  readonly queue: QueuePort
  readonly registry: SchemaRegistry
  readonly logger: Logger
  /**
   * Where a handler that threw is reported (SPEC.md §88).
   *
   * Defaults to writing the incident to `logger`, because a failure that vanished for
   * want of a registered reporter would be worse than having no reporter at all.
   */
  readonly errors?: ErrorTrackingPort
}

/**
 * Refusals that will answer the same way tomorrow (SPEC.md §83).
 *
 * A queue is allowed to refuse work for two very different reasons, and the log line
 * has to say which: an unreachable Redis is an outage, while a payload it cannot
 * encode, or a job the workers do not have, is a defect nobody will fix by waiting.
 */
const PERMANENT_REFUSALS = new Set(['UNQUEUEABLE_PAYLOAD', 'VALIDATION_ERROR', 'UNKNOWN_JOB'])

export const createCommandBus = (options: CommandBusOptions): CommandBus => {
  const registered = new Map<string, AnyCommand>()

  const reporting: ErrorReporting = {
    errors: options.errors ?? logErrors(options.logger),
    logger: options.logger,
  }

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
     * Hoisted above everything that reads it, because a failure has to be able to say
     * what the command had reached.
     *
     * SPEC.md §87 asks every log entry for `entityType` and `entityId` where they are
     * available, and from the first `revise()` onwards they are — including inside the
     * `catch`, where the pipeline previously knew what had been touched and said
     * nothing about it.
     */
    const revisions: RevisionEntry[] = []

    /** What the command acted on, as far as it got. The first revision names it. */
    const actedOn = (): { entityType: string; entityId: string } | undefined => {
      const first = revisions[0]

      return first === undefined
        ? undefined
        : { entityType: first.entityType, entityId: first.entityId }
    }

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
          kind: 'command',
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
          ...actedOn(),
          reason: error instanceof Error ? error.message : String(error),
        })
      }
    }

    /**
     * Hands the batch to the queue, and never fails the command for it.
     *
     * By the time this runs the transaction has closed, and when the command was
     * inside somebody else's transaction the caller has already returned — there is
     * nobody left to reject to. So the report is the log, and it separates the two
     * things that bring it here, because they call for opposite reactions:
     *
     * - a queue that could not be reached is an outage. The work is lost, the
     *   command was right to commit, and time is what fixes it.
     * - a payload a queue will never accept answers the same way forever, and
     *   calling that an outage points whoever reads the log at Redis rather than at
     *   the payload. `job()` refuses what core knows no queue can carry, so a
     *   command fails at the dispatch that made the mistake and never gets here;
     *   this is the backstop for a rule only the adapter has.
     */
    const handOver = async (jobs: readonly QueuedJob[]): Promise<void> => {
      try {
        await options.queue.push(jobs)
      } catch (error) {
        const permanent = error instanceof AssemoraError && PERMANENT_REFUSALS.has(error.code)

        options.logger.error(
          permanent ? 'A job was refused and will never run' : 'Jobs could not be queued',
          {
            command: definition.name,
            requestId: context.requestId,
            ...actedOn(),
            jobs: jobs.map((job) => job.name),
            reason: error instanceof Error ? error.message : String(error),
          },
        )
      }
    }

    // 1. Validation.
    const parsed = definition.input.parse(rawInput)

    if (!parsed.ok) {
      // Audited and not captured. A caller who sent the wrong shape has been told so;
      // an error tracker fed every 422 is a tracker nobody reads (SPEC.md §88).
      await audit('failed', { reason: 'VALIDATION_ERROR' })
      throw new ValidationError(parsed.issues)
    }

    try {
      // 2. Authorization — before anything is opened or written.
      await options.authorization.authorize({
        command: definition.name,
        ...(definition.subject === undefined ? {} : { subject: definition.subject }),
        input: parsed.value,
        context,
      })

      const queued: { readonly name: string; readonly payload: unknown }[] = []

      /**
       * Every command holds its own jobs, and hands them to the transaction seam.
       *
       * A nested command used to share the caller's array, which meant its jobs
       * outlived its own rollback: the savepoint took the rows, the revisions and
       * the events, and left the jobs sitting in the outer command's batch to be
       * queued when the outer one committed. Jobs were the only stage of the
       * pipeline that survived a rollback (ADR-0023).
       *
       * Nesting is not the whole of it either — two top-level commands inside one
       * `transaction()` are not nested at all, and the first one still must not
       * queue anything the second one's failure will undo. So the batch is handed
       * to `transactions.afterCommit` rather than pushed at step 6, and it is the
       * outermost commit that decides.
       */
      const dispatched: QueuedJob[] = []

      /**
       * Process state a handler changes once its rows are durable.
       *
       * Held here rather than registered with the transaction port as the handler
       * asks, for the reason `dispatched` is: a preview never reaches step 6, so the
       * list is simply dropped, whereas `transactions.afterCommit` would have bound
       * it to the commit of whichever command the preview is running inside
       * (ADR-0023).
       */
      const committed: (() => void | Promise<void>)[] = []

      const commandContext: CommandContext = {
        ...context,
        logger: options.logger.child({ command: definition.name }),
        emit: (name, payload) => {
          queued.push({ name, payload })
        },
        dispatch: (...jobs) => {
          for (const request of jobs) dispatched.push(queuedFrom(request, context))
        },
        afterCommit: (work) => {
          committed.push(work)
        },
        authorize: async (subject, action, record) => {
          await options.authorization.authorizeRecord?.({ subject, action, record, context })
        },
        execute: (name, input) => bus.execute(name, input),
        preview: (proposals) => bus.dryRunAll(proposals),

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
      // In a preview this is a nested transaction — a savepoint — inside the one
      // the caller opened and will undo. A step must not undo itself, or the step
      // after it would not see what it did (SPEC.md §74).
      const result = await collectDispatches(dispatched, () =>
        options.transactions.run(async () => {
          const handled = await (
            definition.handle as (input: unknown, context: CommandContext) => Promise<unknown>
          )(parsed.value, commandContext)

          if (revisions.length > 0) await options.revisions.record(revisions)

          return handled
        }),
      )

      if (preview) {
        // No events, no jobs and no after-commit work: nothing became durable, and a
        // job cannot be un-run any more than a listener can be un-notified or a
        // registry un-changed (SPEC.md §73).
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
          jobs: dispatched.map((job) => job.name),
        } satisfies Preview
      }

      // 6. After-commit work, jobs and events, only once the change is durable —
      // which is the outermost commit and not this command's own `run()`, because
      // that one may be a savepoint somebody else is still free to undo (ADR-0023).
      //
      // All three are one registration, and the order inside it is the order of
      // dependence. The handler's own after-commit work finishes the change — a
      // collection is not really created until it is registered — so it goes first;
      // a job or a listener told about a half-applied change would be told a lie.
      // Then the queue, because it is the durable half and a listener taking its
      // time must not delay work that has to survive this process.
      if (committed.length > 0 || dispatched.length > 0 || queued.length > 0) {
        await options.transactions.afterCommit(async () => {
          for (const work of committed) {
            try {
              await work()
            } catch (error) {
              // The commit already happened and the caller has already returned, so
              // this cannot fail the command — and one registration's failure must
              // not cancel the next one's. Reported the way a job that could not be
              // queued is reported, and for the same reason.
              options.logger.error('After-commit work failed', {
                command: definition.name,
                requestId: context.requestId,
                ...actedOn(),
                reason: error instanceof Error ? error.message : String(error),
              })
            }
          }

          if (dispatched.length > 0) await handOver(dispatched)

          for (const event of queued) {
            await options.events.emit(event.name, event.payload as PayloadOf<string>)
          }
        })
      }

      // 7. Audit. The first revision names what was acted on; a command that touched
      // several says how many.
      await audit(
        'succeeded',
        {
          revisions: revisions.length,
          events: queued.length,
          jobs: dispatched.length,
        },
        actedOn(),
      )

      return result
    } catch (error) {
      await audit('failed', {
        reason: error instanceof Error ? error.message : String(error),
      })

      // 8. Error tracking (SPEC.md §88). After the audit, because the audit is the
      // record of what happened and this is a copy sent to somebody else — and only
      // for what the pipeline could not attribute to the caller: a denial, a stale
      // version and a malformed uuid are all the pipeline doing its job.
      await captureError(reporting, error, {
        kind: 'command',
        name: definition.name,
        ...actedOn(),
        durationMs: performance.now() - startedAt,
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
        // Carried only when it restricts something. The presence of the field is the
        // declaration, so the description of a command that made none is unchanged.
        ...(definition.reachableFrom === 'anywhere'
          ? {}
          : { reachableFrom: definition.reachableFrom }),
      })
    },

    execute(target: AnyCommand | string, input: unknown): Promise<never> {
      return run(resolve(target), input) as Promise<never>
    },

    // `async`, so a refusal is a rejection: a method that promises a Promise must
    // not throw before there is one.
    async dryRun(target: AnyCommand | string, input: unknown): Promise<never> {
      const [only] = await bus.dryRunAll([
        { command: typeof target === 'string' ? target : target.name, input },
      ])

      return only as never
    },

    async dryRunAll(proposals: readonly Proposal[]): Promise<readonly Preview[]> {
      const definitions = proposals.map((proposal) => resolve(proposal.command))

      // Checked before anything opens: a batch that cannot be previewed should say so
      // rather than run half of itself and undo it.
      for (const definition of definitions) {
        /**
         * A preview is not a call through the command's own route.
         *
         * `changesets.propose` previews whatever commands it is handed, which makes
         * it the third generic door beside the generated endpoint and the MCP tool.
         * Previewing a publicly authorized `auth.login` answers differently for a
         * right and a wrong password — and hands back the session token it would
         * have issued — so a caller holding only `changesets.propose` would have a
         * password oracle (SPEC.md §85).
         */
        if (definition.reachableFrom === 'its own route') {
          throw new AssemoraError(
            'UNREACHABLE_COMMAND',
            `"${definition.name}" is reachable only through the route written for it`,
            { status: 422 },
          )
        }

        if (!definition.previewable) {
          throw new AssemoraError(
            'NOT_PREVIEWABLE',
            `"${definition.name}" does something a transaction cannot undo, so it cannot be previewed`,
            { status: 422 },
          )
        }
      }

      const previews: Preview[] = []

      await options.transactions.run(
        async () => {
          for (const [index, definition] of definitions.entries()) {
            previews.push((await run(definition, proposals[index]?.input, true)) as Preview)
          }
        },
        { rollback: true },
      )

      return previews
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
