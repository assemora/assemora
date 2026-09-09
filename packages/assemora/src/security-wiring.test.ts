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
import type { AssemoraOptions } from './options.js'

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

/** Whatever an application may say that reaches the HTTP layer's `security` (SPEC.md §85). */
const build = (
  options: Pick<AssemoraOptions, 'origins' | 'thirdParty'>,
): Record<string, unknown> => {
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

  it('passes a third party along one directive at a time, and only when named', () => {
    // Nothing named is nothing asked for. An empty list would widen nothing and still
    // put the key in the object, which reads as a decision somebody made.
    expect(build({}).security).toEqual({ frameAncestors: [] })

    capture.options = []

    const asked = build({
      thirdParty: {
        scripts: ['https://www.googletagmanager.com'],
        connections: ['https://*.google-analytics.com'],
      },
    })

    expect(asked.security).toEqual({
      frameAncestors: [],
      scriptSources: ['https://www.googletagmanager.com'],
      connectSources: ['https://*.google-analytics.com'],
    })
    // The one that was not named is not there: a tag allowed to load and to report has
    // not thereby been allowed to put an image on the page.
    expect(asked.security).not.toHaveProperty('imageSources')
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
