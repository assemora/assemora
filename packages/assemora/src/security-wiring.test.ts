/**
 * The switches the umbrella hands the HTTP layer (SPEC.md §85, ADR-0022).
 *
 * CORS, CSRF, the content security policy and the cookies are asserted through real
 * requests in `assemora.test.ts`, because they can be. The rate limit cannot be:
 * `createHttpServer` registers `@fastify/rate-limit` from a promise nothing awaits
 * before routes are added, and `@fastify/rate-limit` attaches itself to routes
 * through an `onRoute` hook — so every route this package mounts is defined before
 * the plugin has loaded and is never counted, whatever limit is passed. That is a
 * defect in `@assemora/http`, which owns Fastify; until it is fixed, the honest thing
 * this package can prove is that it asked for a ceiling and never stopped asking.
 *
 * So this file watches one seam: the options `serve()` hands `createHttpServer`. The
 * server underneath is the real one — the mock only records the call and delegates.
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
