/**
 * The BullMQ queue adapter (SPEC.md §82).
 *
 * It implements the `QueuePort` that `@assemora/core` declares, and it provides the
 * other half a port cannot: a worker. BullMQ and ioredis are named here and nowhere
 * else in the repository, and `pnpm boundaries` enforces that — nothing of either
 * appears in a signature this file exports (ADR-0023).
 *
 * The whole of the worker is `runJob(envelope)`. Core finds the job, re-validates
 * the payload, restores the context the dispatch happened in and runs the handler;
 * what is left for an adapter is Redis, retries and a graceful stop.
 */
import { createLogger, type Logger, type QueuedJob, type QueuePort, runJob } from '@assemora/core'
import { type ConnectionOptions, type Job, Queue, Worker } from 'bullmq'

import { decodeJob, encodeJob } from './envelope.js'
import { createRedactor, type Redactor, toQueueError, unavailable } from './errors.js'

/**
 * How to reach Redis, described without naming the driver (SPEC.md §10).
 *
 * A `url` says all of it at once and is what a deployment usually has; the separate
 * fields are for a configuration assembled from parts.
 */
export type QueueConnection = {
  readonly url?: string
  readonly host?: string
  readonly port?: number
  readonly username?: string
  readonly password?: string
  readonly db?: number
  /** TLS, for a managed instance that requires it. A `rediss://` url says the same. */
  readonly tls?: boolean
}

export type BullQueueOptions = {
  readonly connection: QueueConnection
  /**
   * The list jobs are pushed onto and workers read from. Both ends must agree, so
   * an application that runs two pools of workers gives each its own queue and its
   * own adapter.
   */
  readonly queue?: string
  /** Namespace for every Redis key, so a shared instance can hold other things. */
  readonly prefix?: string
  /**
   * Where retries, exhaustion and connection trouble are reported.
   *
   * A queue fails between requests, with nobody waiting, so the log is the only
   * place the failure can appear. The application's own logger belongs here; the
   * default writes to the console, because an adapter that swallows the one
   * explanation of a lost job is the thing this package exists to prevent.
   */
  readonly logger?: Logger
  /** The first retry's delay; each further attempt waits twice as long. */
  readonly retryDelayMs?: number
  /**
   * How long to wait for Redis before calling it unavailable.
   *
   * It bounds pushing and starting a worker, and deliberately not stopping one: a
   * graceful stop waits for the job in flight for as long as that job takes.
   */
  readonly timeoutMs?: number
}

export type WorkOptions = {
  /** How many jobs this worker runs at once. One by default. */
  readonly concurrency?: number
  /**
   * How long a job stays locked to a worker that has stopped answering, in
   * milliseconds. 30 000 by default.
   *
   * **A queue delivers at least once**, and this is the number that decides how long
   * "again" takes. A running worker renews the lock as it works, so an ordinary long
   * job is unaffected — but a worker that is killed rather than stopped (`SIGKILL`,
   * an OOM kill, a machine that went away) renews nothing, and the job it was holding
   * is invisible to every other worker until the lock expires. Recovery is a periodic
   * scan on the same interval, so the wait is between one and two of these: with the
   * default, a hard-killed worker leaves its job unavailable for 30 to 60 seconds,
   * and then another worker runs it from the beginning.
   *
   * That happens whatever the job's `retries` says — `retries: 0` means "do not try
   * again after a failure", not "runs at most once". Lower this and a worker that
   * blocks its event loop for longer than the value has its job taken away and run
   * twice; raise it and a crash costs more time before the work is picked up.
   * Neither end removes the duplicate: only an idempotent handler does.
   */
  readonly reclaimAfterMs?: number
}

/** A running worker. The application holds it to stop it (SPEC.md §13). */
export type QueueWorker = {
  /**
   * Stops taking new jobs and resolves once the job in flight has finished.
   *
   * The one it was running is finished, not abandoned: an abandoned job is
   * re-delivered after its lock expires and runs twice.
   */
  stop(): Promise<void>
}

/** A job that failed every attempt it was given, as it sits in the queue. */
export type FailedJob = {
  readonly id?: string
  readonly name: string
  /** The request that scheduled it, so the failure joins the rest of its trail. */
  readonly requestId?: string
  readonly attempts: number
  readonly reason: string
  readonly failedAt?: Date
}

export type BullQueue = QueuePort & {
  /** Starts consuming, and resolves once Redis has answered. */
  work(options?: WorkOptions): Promise<QueueWorker>
  /**
   * The jobs that exhausted their retries, newest first.
   *
   * They are kept rather than deleted, which is what makes this readable at all: an
   * exhausted job is evidence, and the alternative to keeping it is losing the work
   * and the reason together.
   */
  failed(limit?: number): Promise<readonly FailedJob[]>
  /** Closes every connection this adapter opened, workers included. */
  close(): Promise<void>
}

const DEFAULT_QUEUE = 'assemora'
const DEFAULT_PREFIX = 'assemora'
const DEFAULT_RETRY_DELAY_MS = 1_000
const DEFAULT_TIMEOUT_MS = 5_000
const DEFAULT_FAILED_LIMIT = 50

/**
 * A completed job is a receipt, not a record. Audit already holds what the job's
 * commands did (SPEC.md §67), so a day and a thousand of them is enough for a
 * dashboard to be useful without letting Redis grow without a bound nobody set.
 */
const KEEP_COMPLETED = { age: 86_400, count: 1_000 }

const connectionOf = (connection: QueueConnection): ConnectionOptions => ({
  ...(connection.url === undefined ? {} : { url: connection.url }),
  ...(connection.host === undefined ? {} : { host: connection.host }),
  ...(connection.port === undefined ? {} : { port: connection.port }),
  ...(connection.username === undefined ? {} : { username: connection.username }),
  ...(connection.password === undefined ? {} : { password: connection.password }),
  ...(connection.db === undefined ? {} : { db: connection.db }),
  ...(connection.tls === true ? { tls: {} } : {}),
})

const requestIdOf = (data: unknown): string | undefined => {
  const requestId = (data as { requestId?: unknown } | null)?.requestId

  return typeof requestId === 'string' ? requestId : undefined
}

/**
 * Bounds an operation that would otherwise wait on a socket forever.
 *
 * The work is not cancelled — nothing can un-send a command already on the wire — so
 * a push that times out may still land, and a job may still run. Every job has to be
 * idempotent for that reason anyway: a queue delivers at least once.
 */
const withTimeout = async <T>(work: Promise<T>, ms: number, operation: string): Promise<T> => {
  let timer: NodeJS.Timeout | undefined

  try {
    return await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () =>
            reject(
              unavailable(`The queue did not answer within ${ms}ms`, { operation, timeoutMs: ms }),
            ),
          ms,
        )
        // A pending timer must not be the reason a process refuses to exit.
        timer.unref()
      }),
    ])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}

/**
 * The queue adapter of SPEC.md §82, named the way an application config writes it:
 *
 * ```ts
 * const queue = bullQueue({ connection: { url: process.env.REDIS_URL } })
 * const app = createApplication({ queue, modules, authorization })
 * ```
 */
export const bullQueue = (options: BullQueueOptions): BullQueue => {
  const name = options.queue ?? DEFAULT_QUEUE
  const prefix = options.prefix ?? DEFAULT_PREFIX
  const retryDelayMs = options.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const logger = (options.logger ?? createLogger()).child({ queue: name })
  const redact: Redactor = createRedactor([options.connection.url, options.connection.password])
  const connection = connectionOf(options.connection)

  /**
   * A connection that drops reports itself and nothing else does. Both the producer
   * and every worker get this listener, because an emitter with no listener for
   * `error` is one Node treats as fatal — and because a queue that has quietly
   * stopped answering is the failure an operator most needs to hear about
   * (SPEC.md §88).
   */
  const reportConnectionFailure = (error: Error): void => {
    logger.error('The queue connection failed', { reason: redact(error.message) })
  }

  // Created on first use rather than here, so that describing a queue in a config
  // file opens no socket — and so a worker-only process never opens a producer's.
  let producer: Queue<QueuedJob, void, string> | undefined

  const queue = (): Queue<QueuedJob, void, string> => {
    if (producer === undefined) {
      producer = new Queue<QueuedJob, void, string>(name, { connection, prefix })
      producer.on('error', reportConnectionFailure)
    }

    return producer
  }

  const workers = new Set<Worker<unknown, void, string>>()

  const guard = async <T>(operation: string, run: () => Promise<T>): Promise<T> => {
    try {
      return await withTimeout(run(), timeoutMs, operation)
    } catch (error) {
      throw toQueueError(error, redact)
    }
  }

  /**
   * `retries` is how many times a job may be tried *again* after it fails, so the
   * total is one more. Backoff is exponential from `retryDelayMs`, with half of each
   * delay randomised: a queue drains a hundred jobs that all failed on the same
   * outage, and without jitter all hundred retry in the same millisecond.
   *
   * It is not a delivery count. `retries: 0` bounds what happens after a *failure*
   * and says nothing about a worker that died holding the job: stall recovery is
   * independent of `attempts`, and the job is delivered again once the lock expires
   * (see `WorkOptions.reclaimAfterMs`). A queue delivers at least once, so a handler
   * that must not happen twice has to make sure of that itself.
   */
  const optionsFor = (job: QueuedJob) => ({
    attempts: job.retries + 1,
    backoff: { type: 'exponential' as const, delay: retryDelayMs, jitter: 0.5 },
    removeOnComplete: KEEP_COMPLETED,
    // An exhausted job stays in the failed set. That is where it goes, and it is
    // deliberate: dropping it would leave the application believing work happened.
    removeOnFail: false,
  })

  const onFailed = (job: Job<unknown, void, string> | undefined, error: Error): void => {
    const attempts = job?.opts.attempts ?? 1
    const made = job?.attemptsMade ?? 0
    const requestId = requestIdOf(job?.data)
    const fields = {
      job: job?.name ?? 'unknown',
      ...(job?.id === undefined ? {} : { jobId: job.id }),
      ...(requestId === undefined ? {} : { requestId }),
      attempt: made,
      attempts,
      reason: redact(error.message),
    }

    if (made < attempts) {
      logger.warn('Job failed, the queue will try again', fields)
      return
    }

    // The last word on a job nobody is waiting for. Everything needed to find it
    // again is in this line, because there will be no other.
    logger.error('Job exhausted its retries and stays in the failed set', fields)
  }

  const push: QueuePort['push'] = async (jobs) => {
    if (jobs.length === 0) return

    // Before anything is written: a payload that cannot survive JSON is refused
    // here, where the caller still has a stack, rather than in a worker tomorrow.
    const entries = jobs.map(encodeJob)

    await guard('push', () =>
      queue().addBulk(entries.map((job) => ({ name: job.name, data: job, opts: optionsFor(job) }))),
    )
  }

  return {
    push,

    async work(pool = {}) {
      const worker = new Worker<unknown, void, string>(
        name,
        async (job) => {
          await runJob(decodeJob(job.data))
        },
        {
          connection,
          prefix,
          ...(pool.concurrency === undefined ? {} : { concurrency: pool.concurrency }),
          // Both, together. The lock is how long a dead worker keeps the job, and
          // the stalled scan is what finds it afterwards — setting only the first
          // would leave recovery waiting on a thirty-second sweep it never asked
          // for, which is not what anybody setting this means.
          ...(pool.reclaimAfterMs === undefined
            ? {}
            : { lockDuration: pool.reclaimAfterMs, stalledInterval: pool.reclaimAfterMs }),
        },
      )

      worker.on('failed', onFailed)
      worker.on('error', reportConnectionFailure)

      try {
        await guard('work', async () => {
          await worker.waitUntilReady()
        })
      } catch (error) {
        // A worker that never became ready is still holding a socket open.
        await worker.close().catch(() => undefined)
        throw error
      }

      workers.add(worker)
      logger.info('Worker started', { concurrency: pool.concurrency ?? 1 })

      return {
        async stop() {
          // No timeout: `close()` waits for the job in flight, and cutting that
          // short is what turns a graceful stop into a job that runs twice.
          await worker.close()
          workers.delete(worker)
          logger.info('Worker stopped')
        },
      }
    },

    async failed(limit = DEFAULT_FAILED_LIMIT) {
      const found = await guard('failed', () => queue().getFailed(0, Math.max(limit - 1, 0)))

      return found.map((job) => {
        const requestId = requestIdOf(job.data)

        return {
          ...(job.id === undefined ? {} : { id: job.id }),
          name: job.name,
          ...(requestId === undefined ? {} : { requestId }),
          attempts: job.attemptsMade,
          reason: redact(job.failedReason ?? ''),
          ...(job.finishedOn === undefined ? {} : { failedAt: new Date(job.finishedOn) }),
        }
      })
    },

    async close() {
      const closing = [...workers].map((worker) => worker.close())
      workers.clear()

      const open = producer
      producer = undefined

      try {
        await Promise.all(open === undefined ? closing : [...closing, open.close()])
      } catch (error) {
        throw toQueueError(error, redact)
      }
    },
  }
}
