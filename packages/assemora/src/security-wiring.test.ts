/**
 * The switches the umbrella hands the HTTP layer (SPEC.md §85, ADR-0022).
 *
 * CORS, CSRF, the content security policy and the cookies are asserted through real
 * requests in `assemora.test.ts`, and so is the ceiling: `createHttpServer` sequences
 * `@fastify/rate-limit` ahead of the routes it mounts, so a request past the limit is
 * refused rather than counted by nobody. The behavioural half of that lives at the
 * bottom of this file — an earlier version of this comment said the limit was not
 * enforced, and used that to justify asserting only that a number had been passed.
 *
 * What the rest of the file watches is the other seam: the options `serve()` hands
 * `createHttpServer`. A default that stops being asked for is a default that is gone,
 * and the mock only records the call and delegates to the real server.
 */
import { createMemoryAdapter } from '@assemora/database'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { type AssemoraApplication, assemora } from './assemora.js'

const capture = vi.hoisted(() => ({ options: [] as Record<string, unknown>[] }))

vi.mock('@assemora/http', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>()
  const create = actual.createHttpServer as (options: Record<string, unknown>) => unknown

  return {
    ...actual,
    createHttpServer: (options: Record<string, unknown>) => {
      capture.options.push(options)

      return create(options)
    },
  }
})

let running: AssemoraApplication[] = []

const build = (options: { readonly origins?: readonly string[] }): Record<string, unknown> => {
  const built = assemora({ ...options, database: createMemoryAdapter() })

  running.push(built)

  const asked = capture.options[0]

  if (asked === undefined) throw new Error('no HTTP server was built')

  return asked
}

beforeEach(() => {
  capture.options = []
})

afterEach(async () => {
  for (const built of running) await built.shutdown()

  running = []
})

describe('what the umbrella asks the HTTP layer for (SPEC.md §85)', () => {
  it('asks for a ceiling, a CSRF cookie and a content security policy', () => {
    const asked = build({})

    // 600 a minute. Deleting the line leaves an API with no ceiling at all, and
    // SPEC.md §85 lists rate limiting among the mandatory requirements.
    expect(asked.rateLimit).toEqual({ max: 600, windowMs: 60_000 })
    // Optional in `createHttpServer`, and leaving it out turns CSRF off entirely.
    expect(asked.csrf).toEqual({ cookie: 'assemora_csrf' })
    expect(asked.security).toEqual({ frameAncestors: [] })
  })

  it('asks for CORS only when an origin was allowed, and never as a wildcard', () => {
    expect(build({}).cors).toBeUndefined()

    capture.options = []

    expect(build({ origins: ['https://studio.example'] }).cors).toEqual({
      origins: ['https://studio.example'],
      credentials: true,
    })
  })
})

describe('and the ceiling it asked for is one requests are counted against', () => {
  it('refuses the request past the limit, on a route this package mounted', async () => {
    const built = assemora({
      database: createMemoryAdapter(),
      api: { rateLimit: { max: 2, windowMs: 60_000 } },
    })

    running.push(built)

    await built.boot()

    const server = built.server

    if (server === undefined) throw new Error('this application was built without an API')

    const codes: number[] = []

    for (let attempt = 0; attempt < 4; attempt += 1) {
      codes.push((await server.inject({ method: 'GET', url: '/api/health' })).statusCode)
    }

    // Every route here is mounted by `serve()`, which is exactly the case an
    // unsequenced plugin registration would have left uncounted.
    expect(codes).toEqual([200, 200, 429, 429])
  })
})
