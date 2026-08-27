/**
 * Jobs (SPEC.md §82).
 *
 * The third member of the family beside `command()` and `query()`, declared the same
 * way. An event is fire-and-forget in this process and must never carry critical
 * logic (SPEC.md §81); a command is the mutation itself; a job is work that must
 * happen, must survive a restart, and must not happen inside the request.
 *
 * Core declares jobs and hands them to a `QueuePort`. What Redis is, what backoff
 * means and where an exhausted job goes belong to the adapter (ADR-0023).
 */
import { AsyncLocalStorage } from 'node:async_hooks'

import { type InferShape, type Issue, object, type Schema, type Shape } from '@assemora/schema'

import type { CommandBus } from './commands.js'
import type { Container } from './container.js'
import { type AssemoraContext, contextOrInternal, createContext, runInContext } from './context.js'
import { ConfigurationError, UnknownJobError, ValidationError } from './errors.js'
import type { EventBus } from './events.js'
import type { Logger } from './logger.js'
import type { QueuedJob, QueuePort, TransactionPort } from './ports.js'
import type { QueryBus } from './queries.js'
import type { SchemaRegistry } from './registry.js'

/**
 * What a handler receives in addition to its validated payload.
 *
 * A job runs long after the request that scheduled it has gone, so everything it
 * needs has to be here. The buses are what make it useful: a job that changes
 * anything does it by executing a command, which is the only mutation path there is
 * (SPEC.md §14) — so its writes pass the same validation, authorization, revisions
 * and audit a click passes, as the actor whose action scheduled the work.
 *
 * There is deliberately no `revise` and no `authorize`. A job is not a mutation; the
 * commands it runs are, and they already carry both.
 */
export type JobContext = AssemoraContext & {
  readonly logger: Logger
  readonly commands: CommandBus
  readonly queries: QueryBus
  readonly events: EventBus
  /** The application's services, for a job that needs one — a storage driver, a clock. */
  readonly container: Container
}

/**
 * A job with its payload already checked, on its way to a queue (SPEC.md §82).
 *
 * `GenerateSitemap({ pageId })` produces one of these and runs nothing. Calling the
 * definition is where a wrong payload is refused, so the mistake is a
 * `ValidationError` at the call site rather than a red row in a dashboard tomorrow
 * morning — which is most of what declaring a job buys.
 */
export type JobRequest = {
  readonly name: string
  readonly payload: unknown
  readonly retries: number
}

export type JobDefinition<S extends Shape> = {
  /** Validates the payload and answers with what `dispatch` takes. Runs nothing. */
  (payload: InferShape<S>): JobRequest
  readonly name: string
  readonly description: string | undefined
  readonly input: Schema<InferShape<S>>
  readonly retries: number
  handle(payload: InferShape<S>, context: JobContext): Promise<unknown>
}

/** A job of any shape, as stored by the bus. */
export type AnyJob = {
  readonly name: string
  readonly description: string | undefined
  readonly input: Schema<unknown>
  readonly retries: number
  handle(payload: never, context: JobContext): Promise<unknown>
}

/** How a job describes itself in the Schema Registry. */
export type JobDescriptor = {
  readonly name: string
  readonly description?: string
  readonly input: ReturnType<Schema<unknown>['toJsonSchema']>
  readonly retries: number
  readonly module?: string
}

declare module './registry.js' {
  interface RegistrySections {
    jobs: JobDescriptor
  }
}

/**
 * Where a payload holds something no queue could carry, or `undefined` if it is safe.
 *
 * A queue is a serializer. The payload is written by one process and read by another
 * that shares no heap with it, so `undefined` — which is not a value any wire format
 * has, only the absence of one — and a function or a symbol, which are references
 * into this heap, cannot make the trip whatever the adapter encodes with.
 *
 * `object().parse` keeps an explicitly-undefined optional key, so a payload spread
 * from a wider type arrives here holding one and TypeScript never saw it. Refusing
 * it in the queue instead would refuse it after the command had committed, where
 * the stack no longer says who made the mistake — which is most of what declaring a
 * job buys.
 *
 * Everything richer is the adapter's to judge: a Date crosses the BullMQ queue as an
 * ISO string, and core would only be guessing about a codec it does not own.
 */
const unqueueableAt = (
  value: unknown,
  path: readonly (string | number)[],
  seen: WeakSet<object>,
): Issue | undefined => {
  if (value === undefined || typeof value === 'function' || typeof value === 'symbol') {
    return {
      path,
      code: 'unqueueable',
      message: `A queue cannot carry ${value === undefined ? 'undefined' : `a ${typeof value}`}`,
    }
  }

  if (value === null || typeof value !== 'object') return undefined

  // A cycle is not refused — `structuredClone` carries one and an adapter may too —
  // but it must not be walked twice, or this recurses until the stack gives out.
  if (seen.has(value)) return undefined

  seen.add(value)

  if (Array.isArray(value)) {
    for (const [index, item] of value.entries()) {
      const issue = unqueueableAt(item, [...path, index], seen)
      if (issue !== undefined) return issue
    }

    return undefined
  }

  if (value instanceof Date) return undefined

  for (const [key, item] of Object.entries(value)) {
    const issue = unqueueableAt(item, [...path, key], seen)
    if (issue !== undefined) return issue
  }

  return undefined
}

const refuseUnqueueable = (name: string, payload: unknown): void => {
  const issue = unqueueableAt(payload, [], new WeakSet<object>())

  if (issue !== undefined) {
    throw new ValidationError([issue], `"${name}" cannot be dispatched with this payload`)
  }
}

/**
 * ```ts
 * export const GenerateSitemap = job('sitemap.generate', {
 *   description: 'Rebuilds the sitemap after a page changes',
 *   input: { pageId: uuid() },
 *   retries: 3,
 *   handle: async ({ pageId }, ctx) => { ... },
 * })
 * ```
 */
export const job = <S extends Shape>(
  name: string,
  definition: {
    readonly input: S
    readonly description?: string
    /**
     * How many times the queue may try again *after a failure*. Three by default,
     * because a job exists to survive a hiccup.
     *
     * `0` is not "runs once". A queue delivers at least once, and a worker killed
     * mid-job has its work handed to another one 30 to 60 seconds later — recovery
     * from a stalled worker is a separate mechanism from retrying a failure, and
     * this number does not govern it. What makes a job run once is a handler that
     * can run twice.
     */
    readonly retries?: number
    /**
     * Nothing reads what a handler answers — by the time a job runs, whoever
     * scheduled it has gone. The type is `unknown` rather than `void` so that a
     * one-line handler forwarding to a command needs no block around it.
     */
    handle(payload: InferShape<S>, context: JobContext): Promise<unknown>
  },
): JobDefinition<S> => {
  const input = object(definition.input)
  const retries = definition.retries ?? 3

  const request = (payload: InferShape<S>): JobRequest => {
    const parsed = input.parse(payload)

    if (!parsed.ok) {
      throw new ValidationError(parsed.issues, `"${name}" cannot be dispatched with this payload`)
    }

    refuseUnqueueable(name, parsed.value)

    return { name, payload: parsed.value, retries }
  }

  const built = Object.assign(request, {
    description: definition.description,
    input,
    retries,
    handle: definition.handle,
  }) as JobDefinition<S>

  // A function's own `name` is not writable, so `Object.assign` would throw on it.
  Object.defineProperty(built, 'name', { enumerable: true, value: name })

  return built
}

/**
 * The batch a command is holding, while it is holding one.
 *
 * A job dispatched inside a command must not reach a queue before the transaction
 * commits, or a worker runs against a world that was rolled back (ADR-0023). The
 * ambient context is how a free function finds that batch, exactly as it is how a
 * logger finds the request id (SPEC.md §12).
 */
const held = new AsyncLocalStorage<QueuedJob[]>()

/**
 * Collects everything dispatched inside `operation` instead of handing it over.
 *
 * Each command opens its own, nested ones included: a batch shared with the caller
 * would outlive the savepoint that undid the command holding it.
 */
export const collectDispatches = <T>(into: QueuedJob[], operation: () => Promise<T>): Promise<T> =>
  held.run(into, operation)

/** Seals a request into the envelope a worker will reopen. */
export const queuedFrom = (request: JobRequest, context: AssemoraContext): QueuedJob => ({
  name: request.name,
  payload: request.payload,
  retries: request.retries,
  requestId: context.requestId,
  ...(context.actor === undefined ? {} : { actor: context.actor }),
  dispatchedFrom: context.source,
})

/**
 * Schedules durable work (SPEC.md §82).
 *
 * ```ts
 * await dispatch(GenerateSitemap({ pageId }))
 * ```
 *
 * Inside a command the job is held until the outermost transaction commits, so a
 * command that rolls back — or that ran inside a transaction somebody else rolled
 * back — queues nothing. In a dry run it is held and then dropped: a job cannot be
 * un-run any more than a listener can be un-notified (SPEC.md §73).
 *
 * Outside a command it is handed over immediately, because there is normally no
 * transaction to wait for and deferring it would silently drop work nothing will
 * ever flush. When there is one — a script that wrapped its work in `transaction()`
 * — it waits for that commit, by the same rule and for the same reason.
 */
export const dispatch = async (...requests: readonly JobRequest[]): Promise<void> => {
  if (requests.length === 0) return

  const context = contextOrInternal()
  const queued = requests.map((request) => queuedFrom(request, context))
  const batch = held.getStore()

  if (batch !== undefined) {
    batch.push(...queued)
    return
  }

  await currentJobBus().push(queued)
}

export type JobBus = {
  register(definition: AnyJob, module?: string): void
  /**
   * Hands jobs to the queue once the outermost transaction commits. What `dispatch()`
   * reaches outside a command.
   *
   * With no transaction open that is immediately, which is the ordinary case and what
   * ADR-0023 describes. Inside one — a script that wrapped its work in
   * `transaction()` — the same rule holds as for a command: work that a rollback can
   * still undo must not be running yet.
   */
  push(jobs: readonly QueuedJob[]): Promise<void>
  /**
   * Runs one job that came back off a queue, and rejects when the job does.
   *
   * A worker reaches this through `runJob`, which is the whole of what an adapter
   * has to do with a payload.
   */
  run(job: QueuedJob): Promise<void>
  has(name: string): boolean
  names(): readonly string[]
}

export type JobBusOptions = {
  /**
   * The buses a handler is given. A job that changes anything runs a command, and a
   * job that reads anything runs a query — there is no third way in (SPEC.md §14).
   */
  readonly commands: CommandBus
  readonly queries: QueryBus
  readonly events: EventBus
  readonly container: Container
  readonly registry: SchemaRegistry
  readonly logger: Logger
  readonly queue: QueuePort
  /** Where "after the commit" is decided, for a dispatch that is not inside a command. */
  readonly transactions: TransactionPort
}

export const createJobBus = (options: JobBusOptions): JobBus => {
  const registered = new Map<string, AnyJob>()

  const bus: JobBus = {
    register(definition, module) {
      registered.set(definition.name, definition)

      options.registry.register('jobs', {
        name: definition.name,
        ...(definition.description === undefined ? {} : { description: definition.description }),
        input: definition.input.toJsonSchema(),
        retries: definition.retries,
        ...(module === undefined ? {} : { module }),
      })
    },

    push(jobs) {
      return options.transactions.afterCommit(() => options.queue.push(jobs))
    },

    async run(queued) {
      const definition = registered.get(queued.name)

      if (definition === undefined) throw new UnknownJobError(queued.name)

      // Checked again on the way out. It was checked when the job was dispatched,
      // but between then and now it crossed a serializer and sat in a queue that
      // anything holding the connection string can write to (SPEC.md §85).
      const parsed = definition.input.parse(queued.payload)

      if (!parsed.ok) {
        throw new ValidationError(
          parsed.issues,
          `"${queued.name}" was queued with a payload it cannot accept`,
        )
      }

      const context = createContext({
        // Not the source that dispatched it. A row this job writes was written by a
        // worker, and an audit entry claiming the studio click that scheduled it
        // would be a lie. The request id is kept, so the whole chain — the click, the
        // command, the job, the commands the job runs — traces back to one id.
        source: 'job',
        requestId: queued.requestId,
        ...(queued.actor === undefined ? {} : { actor: queued.actor }),
      })

      const logger = options.logger.child({
        job: queued.name,
        dispatchedFrom: queued.dispatchedFrom,
      })

      const startedAt = performance.now()

      await runInContext(context, async () => {
        try {
          await (definition.handle as (payload: unknown, context: JobContext) => Promise<unknown>)(
            parsed.value,
            {
              ...context,
              logger,
              commands: options.commands,
              queries: options.queries,
              events: options.events,
              container: options.container,
            },
          )

          logger.info('Job finished', { durationMs: performance.now() - startedAt })
        } catch (error) {
          // Loud, and then rethrown. A job that fails quietly is worse than no job,
          // and the adapter is what decides whether to try again — which it can only
          // decide if the failure reaches it (ADR-0023).
          logger.error('Job failed', {
            durationMs: performance.now() - startedAt,
            reason: error instanceof Error ? error.message : String(error),
          })

          throw error
        }
      })
    },

    has: (name) => registered.has(name),
    names: () => [...registered.keys()],
  }

  return bus
}

let inUse: JobBus | undefined

/**
 * Where `dispatch()` and `runJob()` find the application's jobs.
 *
 * A free function has no application in scope — SPEC.md §82 writes
 * `await dispatch(GenerateSitemap({ pageId }))` and nothing else — and the ambient
 * context is established by `runInContext`, which core keeps innocent of queues. So
 * the seam is a process-wide slot, the way an entity's restorer is. One process runs
 * one application; a second one takes over, which is the trade the restorer registry
 * already makes.
 */
export const registerJobBus = (bus: JobBus): void => {
  inUse = bus
}

/** Exposed for tests; an application has no reason to unregister its own jobs. */
export const clearJobBus = (): void => {
  inUse = undefined
}

const currentJobBus = (): JobBus => {
  if (inUse === undefined) {
    throw new ConfigurationError(
      'No application is running, so there is nowhere to put a job. Create one with createApplication().',
    )
  }

  return inUse
}

/**
 * Runs one job that came back off a queue (SPEC.md §82).
 *
 * The whole of what an adapter does with a payload: this finds the definition,
 * re-validates what the queue handed back, restores the context that dispatched it,
 * runs the handler and reports. A worker is
 * `new Worker(name, ({ data }) => runJob(data))`.
 *
 * It rejects when the job throws, because the adapter is what decides whether to try
 * again and it can only decide that if the failure reaches it.
 */
export const runJob = (queued: QueuedJob): Promise<void> => currentJobBus().run(queued)
