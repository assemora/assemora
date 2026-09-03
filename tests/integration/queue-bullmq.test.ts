/**
 * BullMQ queue adapter integration tests (SPEC.md §82, §95).
 *
 * They run the whole of what a job is — `dispatch()` → the port → Redis → a worker
 * → `runJob` → the handler — against a real instance, because an adapter tested
 * against a fake is an adapter nobody has run (ADR-0023). The suite skips itself
 * when no Redis is reachable, so a checkout without one still passes `pnpm verify`.
 */
import { randomUUID } from 'node:crypto'
import { connect } from 'node:net'
import {
  clearJobBus,
  createApplication,
  createLogger,
  dispatch,
  job,
  type LogRecord,
  module,
  permitAll,
} from '@assemora/core'
import { bullQueue } from '@assemora/queue-bullmq'
import { integer, json, string, timestamp, uuid } from '@assemora/schema'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'

import { realInfrastructure } from './budget.ts'

realInfrastructure()

const url = process.env.ASSEMORA_TEST_REDIS_URL ?? 'redis://127.0.0.1:6379'

/**
 * A suite that skips itself is a suite that can be green while proving nothing.
 * Set `ASSEMORA_REQUIRE_REDIS=1` — in CI, or before a release — and an unreachable
 * instance becomes a failure instead of a silent pass.
 */
const required = process.env.ASSEMORA_REQUIRE_REDIS === '1'

// --- just enough of the Redis protocol to probe and to tidy up ---------------

/**
 * The suite talks to Redis directly rather than through the adapter it is testing.
 *
 * Cleaning up with the thing under test cannot tell a leak from a lie, and CI shares
 * one instance with every other suite — so the keys this file creates are deleted by
 * something that has no stake in the outcome. Four verbs is all that takes.
 */
type Reply = string | number | null | Reply[]

const encodeCommand = (parts: readonly string[]): string =>
  `*${parts.length}\r\n${parts
    .map((part) => `$${Buffer.byteLength(part)}\r\n${part}\r\n`)
    .join('')}`

const parseReply = (buffer: Buffer, at: number): { value: Reply; next: number } | undefined => {
  const end = buffer.indexOf('\r\n', at)

  if (end === -1) return undefined

  const marker = buffer.toString('utf8', at, at + 1)
  const head = buffer.toString('utf8', at + 1, end)
  const after = end + 2

  switch (marker) {
    case '+':
      return { value: head, next: after }
    case '-':
      throw new Error(head)
    case ':':
      return { value: Number(head), next: after }
    case '$': {
      const length = Number(head)

      if (length === -1) return { value: null, next: after }
      if (buffer.length < after + length + 2) return undefined

      return { value: buffer.toString('utf8', after, after + length), next: after + length + 2 }
    }
    case '*': {
      const count = Number(head)

      if (count === -1) return { value: null, next: after }

      const values: Reply[] = []
      let cursor = after

      for (let index = 0; index < count; index += 1) {
        const item = parseReply(buffer, cursor)

        if (item === undefined) return undefined

        values.push(item.value)
        cursor = item.next
      }

      return { value: values, next: cursor }
    }
    default:
      throw new Error(`Unexpected Redis reply "${marker}"`)
  }
}

const address = new URL(url)

const redis = (...command: readonly string[]): Promise<Reply> =>
  new Promise((resolve, reject) => {
    const socket = connect({
      host: address.hostname,
      port: address.port === '' ? 6379 : Number(address.port),
    })
    let buffer = Buffer.alloc(0)

    socket.setTimeout(1_500, () => socket.destroy(new Error('Redis did not answer in time')))
    socket.on('error', reject)
    socket.on('connect', () => {
      if (address.password !== '') {
        socket.write(encodeCommand(['AUTH', decodeURIComponent(address.password)]))
      }

      socket.write(encodeCommand(command))
    })
    socket.on('data', (chunk) => {
      buffer = Buffer.concat([buffer, chunk])

      try {
        // With AUTH in front, the reply we want is the second one; both are parsed
        // and the last complete one wins.
        let cursor = 0
        let last: Reply | undefined

        for (;;) {
          const reply = parseReply(buffer, cursor)

          if (reply === undefined) break

          last = reply.value
          cursor = reply.next
        }

        if (last === undefined || (address.password !== '' && cursor < buffer.length)) return

        socket.end()
        resolve(last)
      } catch (error) {
        socket.end()
        reject(error)
      }
    })
  })

const reachable = await (async () => {
  try {
    await redis('PING')
    return true
  } catch (error) {
    if (required) {
      throw new Error(
        `ASSEMORA_REQUIRE_REDIS is set but ${url} is unreachable: ${
          error instanceof Error ? error.message : String(error)
        }`,
      )
    }

    console.warn(`[integration] skipped: ${url} is unreachable`)

    return false
  }
})()

// --- the application under test ----------------------------------------------

/** Every run gets its own namespace, because CI shares one instance. */
const prefix = `assemora-test:${randomUUID()}`

type Run = {
  readonly payload: unknown
  readonly source: string
  readonly requestId: string
  readonly actorId: string | undefined
}

const runs: Run[] = []
let failedAttempts = 0
let slowFinished = false
let slowStarted: () => void = () => undefined

const RecordVisit = job('test.record', {
  description: 'Remembers what it was handed and the context it ran in',
  input: { pageId: uuid(), at: timestamp() },
  retries: 0,
  handle: async (payload, context) => {
    runs.push({
      payload,
      source: context.source,
      requestId: context.requestId,
      actorId: context.actor?.id,
    })
  },
})

const AlwaysFails = job('test.fails', {
  input: { reason: string() },
  retries: 1,
  handle: async ({ reason }) => {
    failedAttempts += 1
    throw new Error(reason)
  },
})

const Slow = job('test.slow', {
  input: { ms: integer() },
  retries: 0,
  handle: async ({ ms }) => {
    slowStarted()
    await new Promise((resolve) => setTimeout(resolve, ms))
    slowFinished = true
  },
})

const Unqueueable = job('test.unqueueable', {
  input: { settings: json<Record<string, unknown>>() },
  retries: 0,
  handle: async () => undefined,
})

const logs: LogRecord[] = []
const logger = createLogger((record) => {
  logs.push(record)
})

const queue = bullQueue({
  connection: { url },
  queue: 'jobs',
  prefix,
  logger,
  // Short enough that a retry is a test rather than a wait.
  retryDelayMs: 50,
  timeoutMs: 3_000,
})

const app = createApplication({
  modules: [module('testing').jobs(RecordVisit, AlwaysFails, Slow, Unqueueable)],
  authorization: permitAll(),
  queue,
  logger,
})

const wrote = (message: string): boolean => logs.some((record) => record.message === message)

describe.skipIf(!reachable)('the BullMQ queue adapter', () => {
  let running: Awaited<ReturnType<typeof queue.work>> | undefined

  beforeAll(async () => {
    await app.boot()
  })

  afterEach(async () => {
    await running?.stop()
    running = undefined
    runs.length = 0
    logs.length = 0
  })

  afterAll(async () => {
    await queue.close()
    await app.shutdown()
    clearJobBus()

    const keys = await redis('KEYS', `${prefix}:*`)

    if (Array.isArray(keys) && keys.length > 0) {
      await redis('DEL', ...keys.map(String))
    }
  })

  it('runs a job it was handed, in the context that dispatched it', async () => {
    const requestId = randomUUID()
    const pageId = randomUUID()
    const at = new Date('2026-08-27T09:00:00.000Z')

    await app.run({ source: 'studio', requestId, actor: { type: 'user', id: 'ada' } }, async () => {
      await dispatch(RecordVisit({ pageId, at }))
    })

    running = await queue.work()

    await expect.poll(() => runs.length, { timeout: 10_000 }).toBe(1)

    // The actor and the request id survived Redis, so the job's own commands are
    // authorized as the person whose action scheduled them and the audit log says
    // who. The source did not: a row this worker writes was not written by a click.
    expect(runs[0]).toEqual({
      payload: { pageId, at },
      source: 'job',
      requestId,
      actorId: 'ada',
    })

    // A Date crossed a queue that only carries JSON and arrived a Date, because it
    // travelled as the ISO string `timestamp()` already declares as its wire form.
    expect(runs[0]?.payload).toHaveProperty('at', at)

    expect(
      logs.some(
        (record) => record.message === 'Job finished' && record.dispatchedFrom === 'studio',
      ),
    ).toBe(true)
  })

  it('retries a failure as many times as the job asked for, and then stops', async () => {
    await app.run({ source: 'cli' }, async () => {
      await dispatch(AlwaysFails({ reason: 'the sitemap service is down' }))
    })

    running = await queue.work()

    // `retries: 1` is one attempt and one retry.
    await expect.poll(() => failedAttempts, { timeout: 10_000 }).toBe(2)

    await new Promise((resolve) => setTimeout(resolve, 500))

    expect(failedAttempts).toBe(2)
    expect(wrote('Job failed, the queue will try again')).toBe(true)
    expect(wrote('Job exhausted its retries and stays in the failed set')).toBe(true)

    // Where an exhausted job goes: the failed set, kept, with the reason on it.
    const failed = await queue.failed()

    expect(failed).toHaveLength(1)
    expect(failed[0]).toMatchObject({ name: 'test.fails', attempts: 2 })
    expect(failed[0]?.reason).toContain('the sitemap service is down')
    expect(failed[0]?.failedAt).toBeInstanceOf(Date)
  })

  it('finishes the job it is running when it is stopped', async () => {
    const started = new Promise<void>((resolve) => {
      slowStarted = resolve
    })

    await app.run({ source: 'cli' }, async () => {
      await dispatch(Slow({ ms: 400 }))
    })

    const worker = await queue.work()

    await started

    expect(slowFinished).toBe(false)

    await worker.stop()

    expect(slowFinished).toBe(true)
  })

  it('refuses a payload the queue could not hand back unchanged', async () => {
    await expect(
      app.run({ source: 'cli' }, async () => {
        await dispatch(Unqueueable({ settings: { seen: new Map() } }))
      }),
    ).rejects.toThrow(/cannot be queued: it carries a Map at payload\.settings\.seen/)
  })

  it('reports an unreachable queue without repeating the connection string', async () => {
    const offline = bullQueue({
      // Nothing listens here, and the password is the point of the test.
      connection: { url: 'redis://assemora:s3cret@127.0.0.1:6399' },
      queue: 'jobs',
      prefix,
      logger,
      timeoutMs: 500,
    })

    try {
      await offline.push([
        {
          name: 'test.record',
          payload: { pageId: randomUUID(), at: new Date().toISOString() },
          retries: 0,
          requestId: randomUUID(),
          dispatchedFrom: 'cli',
        },
      ])
      expect.unreachable('pushing to a queue that is not there has to fail')
    } catch (error) {
      const failure = error as { code?: string; status?: number; message: string; cause?: unknown }

      expect(failure.code).toBe('QUEUE_UNAVAILABLE')
      expect(failure.status).toBe(503)
      expect(failure.message).not.toContain('s3cret')
      expect(
        `${failure.message} ${failure.cause instanceof Error ? failure.cause.message : ''}`,
      ).not.toContain('s3cret')
    } finally {
      await offline.close()
    }
  })
})
