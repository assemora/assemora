/**
 * The three things about this adapter that only a real Redis can prove.
 *
 * `decodeJob` and the error mapping are unit-tested beside their own files. What
 * those tests cannot say is whether the *worker* uses them: the envelope guard, the
 * readiness guard and the redelivery a lock expiry causes all live inside `work()`,
 * where no caller can see them. Each was removable without turning this package red
 * until these tests existed.
 *
 * The suite skips itself when no Redis is reachable, exactly as the integration
 * suite does, so a checkout without one still passes.
 */
import { randomUUID } from 'node:crypto'
import { createServer } from 'node:net'

import {
  clearJobBus,
  createApplication,
  createLogger,
  job,
  type LogRecord,
  module,
  permitAll,
  type QueuedJob,
} from '@assemora/core'
import { integer, uuid } from '@assemora/schema'
import { Queue } from 'bullmq'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'

import { type BullQueue, bullQueue } from './queue.js'

const url = process.env.ASSEMORA_TEST_REDIS_URL ?? 'redis://127.0.0.1:6379'

/** As in the integration suite: set it, and an unreachable instance is a failure. */
const required = process.env.ASSEMORA_REQUIRE_REDIS === '1'

const address = new URL(url)

const connection = {
  host: address.hostname,
  port: address.port === '' ? 6379 : Number(address.port),
  ...(address.password === '' ? {} : { password: decodeURIComponent(address.password) }),
}

const QUEUE = 'jobs'

/**
 * Every namespace this file has ever opened, so that the last thing it does is
 * delete them. CI shares one instance with every other suite, and a key left behind
 * is indistinguishable from a leak in the code under test.
 */
const prefixes: string[] = []

const namespace = (): string => {
  const prefix = `assemora-test:${randomUUID()}`

  prefixes.push(prefix)

  return prefix
}

/**
 * BullMQ's own `Queue` is what probes, forges and tidies up.
 *
 * Forging is the point of the first test: the threat the envelope guard exists for
 * is that anything holding the connection string can write to that list (SPEC.md
 * §85), and this is that writer. What is under test is `work()`, which none of it
 * touches.
 */
const raw = (prefix: string): Queue => {
  const queue = new Queue(QUEUE, { connection, prefix })

  // An emitter with no listener for `error` is one Node treats as fatal, and an
  // unreachable instance is exactly what the probe below is asking about.
  queue.on('error', () => undefined)

  return queue
}

const reachable = await (async () => {
  const probe = raw(namespace())

  try {
    await probe.waitUntilReady()

    return true
  } catch (error) {
    if (required) {
      throw new Error(
        `ASSEMORA_REQUIRE_REDIS is set but ${url} is unreachable: ${
          error instanceof Error ? error.message : String(error)
        }`,
      )
    }

    console.warn(`[queue-bullmq] skipped: ${url} is unreachable`)

    return false
  } finally {
    await probe.close().catch(() => undefined)
  }
})()

/** A port nothing listens on: bound to learn the number, then handed straight back. */
const closedPort = async (): Promise<number> =>
  new Promise((resolve, reject) => {
    const server = createServer()

    server.on('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const found = server.address()

      if (found === null || typeof found === 'string') {
        reject(new Error('the operating system gave no port'))
        return
      }

      server.close(() => resolve(found.port))
    })
  })

// --- the application under test ----------------------------------------------

const ran: string[] = []

const Envelope = job('test.envelope', {
  input: { pageId: uuid() },
  retries: 0,
  handle: async () => {
    ran.push('test.envelope')
  },
})

/**
 * Blocks the event loop the first time it runs, which is what a hard-killed worker
 * looks like from Redis: nothing renews the lock, and it expires under the job.
 */
const Blocking = job('test.blocking', {
  input: { blockMs: integer() },
  retries: 0,
  handle: async ({ blockMs }) => {
    ran.push('test.blocking')

    if (ran.filter((name) => name === 'test.blocking').length > 1) return

    const until = Date.now() + blockMs

    while (Date.now() < until) {
      // Deliberately synchronous. An `await` here would let BullMQ renew the lock,
      // and renewing the lock is precisely what a killed process cannot do.
    }
  },
})

const logs: LogRecord[] = []
const logger = createLogger((record) => {
  logs.push(record)
})

/**
 * No `queue` option, because nothing here dispatches: each test pushes onto the
 * adapter it built for itself. What the application is for is the job bus `runJob`
 * reads, which is process-wide (SPEC.md §82).
 */
const app = createApplication({
  modules: [module('testing').jobs(Envelope, Blocking)],
  authorization: permitAll(),
  logger,
})

const opened: { readonly queue: BullQueue; readonly prefix: string }[] = []

/**
 * A namespace of its own for every test, and not only because CI shares one Redis.
 *
 * BullMQ guards the stalled-job scan with a key that expires after one
 * `stalledInterval`, so a worker started with the default interval suppresses that
 * scan across the whole queue for thirty seconds — long enough to make the
 * redelivery below depend on which test ran before it.
 */
const freshQueue = (): { readonly queue: BullQueue; readonly prefix: string } => {
  const prefix = namespace()
  const queue = bullQueue({ connection: { url }, queue: QUEUE, prefix, logger, timeoutMs: 3_000 })
  const entry = { queue, prefix }

  opened.push(entry)

  return entry
}

describe.skipIf(!reachable)('the worker', () => {
  let running: Awaited<ReturnType<BullQueue['work']>> | undefined

  beforeAll(async () => {
    await app.boot()
  })

  afterEach(async () => {
    await running?.stop()
    running = undefined
    ran.length = 0
    logs.length = 0
  })

  afterAll(async () => {
    await app.shutdown()
    clearJobBus()

    for (const { queue } of opened) await queue.close().catch(() => undefined)

    // Every namespace this file opened, the probe's included — the failed jobs it
    // left on purpose go with them. `force` because a queue that ever had a worker
    // refuses otherwise. Only the namespaces this file made: another suite may be
    // running against the same instance.
    for (const prefix of prefixes) {
      const cleaner = raw(prefix)

      await cleaner.obliterate({ force: true }).catch(() => undefined)
      await cleaner.close()
    }
  })

  /**
   * `runJob` re-validates the *payload* against the job's own input schema, and
   * nothing else. The envelope around it is what the worker restores a context
   * from — who the actor is, where the work came from — and it arrives off a list
   * anything holding the connection string can write to. Without `decodeJob` in the
   * worker, this forged actor is the actor the job's commands would run as.
   */
  it('refuses an envelope the queue handed back, before any handler sees it', async () => {
    const { queue, prefix } = freshQueue()
    const writer = raw(prefix)

    try {
      await writer.add(
        'test.envelope',
        {
          name: 'test.envelope',
          // Valid against the job's input schema: the payload is not what is wrong.
          payload: { pageId: randomUUID() },
          retries: 0,
          requestId: randomUUID(),
          actor: { type: 'root', id: 'nobody' },
          dispatchedFrom: 'nowhere',
        } as unknown as QueuedJob,
        { attempts: 1, removeOnFail: false },
      )
    } finally {
      await writer.close()
    }

    running = await queue.work()

    await expect
      .poll(() => queue.failed().then((failed) => failed.length), { timeout: 10_000 })
      .toBe(1)

    expect(ran).toEqual([])

    const failed = await queue.failed()

    expect(failed[0]?.reason).toContain('The queue handed back something that is not a job')
  })

  /**
   * A worker that cannot reach Redis has to say so at startup. Without the
   * `waitUntilReady()` guard, `work()` answers with a worker that consumes nothing
   * and the process reports itself healthy while the queue fills up behind it.
   */
  it('fails to start when the queue is not there, rather than consuming nothing', async () => {
    const offline = bullQueue({
      connection: { url: `redis://127.0.0.1:${await closedPort()}` },
      queue: QUEUE,
      prefix: namespace(),
      logger,
      timeoutMs: 500,
    })

    try {
      await expect(offline.work()).rejects.toMatchObject({
        code: 'QUEUE_UNAVAILABLE',
        status: 503,
      })
    } finally {
      // Nothing was ever written under that prefix, so there is nothing to delete.
      await offline.close()
    }
  })

  /**
   * `retries: 0` means "do not try again after a failure". It does not mean "runs
   * once": a queue delivers at least once, and stall recovery is independent of
   * `attempts`. This measures that claim rather than restating it — the worker stops
   * renewing its lock, the lock expires, and the job runs a second time from the
   * beginning while declaring no retries at all.
   *
   * It is also what proves `reclaimAfterMs` reaches BullMQ: at the default lock of
   * thirty seconds nothing here expires, and the job runs exactly once.
   */
  it('delivers a job again when the lock under it expires, whatever retries says', {
    timeout: 30_000,
  }, async () => {
    const { queue } = freshQueue()

    await queue.push([
      {
        name: 'test.blocking',
        payload: { blockMs: 900 },
        retries: 0,
        requestId: randomUUID(),
        dispatchedFrom: 'cli',
      },
    ])

    running = await queue.work({ reclaimAfterMs: 300 })

    await expect
      .poll(() => ran.filter((name) => name === 'test.blocking').length, { timeout: 20_000 })
      .toBe(2)
  })
})
