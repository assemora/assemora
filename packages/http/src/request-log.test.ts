import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  AssemoraError,
  collectErrors,
  createApplication,
  createLogger,
  type LogRecord,
  permitAll,
  silentWriter,
} from '@assemora/core'
import { number, string, uuid } from '@assemora/schema'
import { beforeEach, describe, expect, it } from 'vitest'

import { clearRouteRegistry } from './module.js'
import { requestLogLevel, SLOW_REQUEST_MS } from './request-log.js'
import { route } from './route.js'
import { createHttpServer, type HttpServer } from './server.js'

const ID = '3f2504e0-4f89-41d3-9a0c-0305e82c3301'

const readArticle = route.get('/articles/:id', {
  params: { id: uuid() },
  query: { include: string().optional() },
  response: { id: string(), views: number() },
  handler: async ({ params }) => ({ id: params.id, views: 7 }),
})

const failing = route.get('/failing', {
  handler: async () => {
    throw new Error('the connection string is postgres://ada:hunter2@db/app')
  },
})

/**
 * A 5xx the endpoint means, which is what `/api/ready` answers with while a module
 * that could not start keeps traffic away (ADR-0026).
 */
const unready = route.get('/unready', {
  handler: async () => {
    throw new AssemoraError('NOT_READY', 'This application is not serving', {
      status: 503,
      expected: true,
    })
  },
})

const slow = route.get('/slow', {
  response: { done: string() },
  handler: async () => {
    await new Promise((resolve) => setTimeout(resolve, 20))

    return { done: 'yes' }
  },
})

const slowFailing = route.get('/slow-failing', {
  handler: async () => {
    await new Promise((resolve) => setTimeout(resolve, 20))

    throw new Error('the upstream refused')
  },
})

const signIn = route.post('/auth/login', {
  body: { email: string(), password: string() },
  response: { token: string() },
  handler: async ({ body }) => ({ token: `token-for-${body.email}` }),
})

let records: LogRecord[]
let errors: ReturnType<typeof collectErrors>
let server: HttpServer

/** Everything the request line wrote, in order. */
const lines = () => records.filter((record) => record.message === 'Request completed')

const build = (options: Partial<Parameters<typeof createHttpServer>[0]> = {}) => {
  records = []
  errors = collectErrors()

  const app = createApplication({
    authorization: permitAll(),
    logger: createLogger(silentWriter),
  })

  return createHttpServer({
    registry: app.registry,
    commands: app.commands,
    queries: app.queries,
    logger: createLogger((record) => records.push(record)),
    errors,
    ...options,
  })
}

beforeEach(() => {
  clearRouteRegistry()
  server = build()
})

describe('one line per request (SPEC.md §88)', () => {
  it('writes it without being asked to, because §88 lists it among the minimum', async () => {
    server.mount(readArticle)

    await server.inject({ method: 'GET', url: `/api/articles/${ID}` })

    expect(lines()).toHaveLength(1)
    expect(lines()[0]).toMatchObject({
      level: 'info',
      method: 'GET',
      path: '/api/articles/:id',
      status: 200,
    })
    expect(lines()[0]?.durationMs).toBeTypeOf('number')
  })

  it('writes one line and not two when the request failed', async () => {
    server.mount(failing)

    const response = await server.inject({ method: 'GET', url: '/api/failing' })

    expect(response.statusCode).toBe(500)
    // There used to be a second line here — "Request failed" — which was a second
    // opinion about the same event, with a different shape and no duration.
    expect(lines()).toHaveLength(1)
    expect(records.filter((record) => record.message === 'Request failed')).toHaveLength(0)
  })

  it('carries §87 fields from the context the handler ran in', async () => {
    server = build({ resolveActor: async () => ({ type: 'user', id: 'u-1' }) })
    server.mount(readArticle)

    await server.inject({
      method: 'GET',
      url: `/api/articles/${ID}`,
      headers: { 'x-request-id': 'req-42' },
    })

    // The hook fires after the reply is flushed, which is outside the handler's
    // AsyncLocalStorage scope — so this is what proves the context is stepped back into.
    expect(lines()[0]).toMatchObject({
      requestId: 'req-42',
      source: 'rest',
      actorType: 'user',
      actorId: 'u-1',
    })
  })

  it('says nothing at all when the application asked for no line', async () => {
    server = build({ requestLog: false })
    server.mount(readArticle)

    await server.inject({ method: 'GET', url: `/api/articles/${ID}` })

    expect(records).toHaveLength(0)
  })
})

describe('how long it took is measured here, not borrowed', () => {
  it('times the failure it reports even when the application asked for no line', async () => {
    // Fastify starts its own clock only when something already asked it to — a logger,
    // an onResponse hook — so `reply.elapsedTime` was 0 for every request of an
    // application that switched the line off, and every report of one said the failure
    // took no time at all. Two options that read as independent were coupled.
    server = build({ requestLog: false })
    server.mount(slowFailing)

    await server.inject({ method: 'GET', url: '/api/slow-failing' })

    expect(errors.reports).toHaveLength(1)
    expect(errors.reports[0]?.operation.durationMs).toBeGreaterThanOrEqual(10)
  })

  it('measures the same thing whether or not the line is written', async () => {
    server.mount(slowFailing)

    await server.inject({ method: 'GET', url: '/api/slow-failing' })

    expect(errors.reports[0]?.operation.durationMs).toBeGreaterThanOrEqual(10)
    expect(lines()[0]?.durationMs).toBeGreaterThanOrEqual(10)
  })
})

describe('§87’s fields are on the line, including for the requests no handler saw', () => {
  it('carries them when nothing matched the URL', async () => {
    await server.ready()

    await server.inject({
      method: 'GET',
      url: '/api/nothing-here',
      headers: { 'x-request-id': 'req-42' },
    })

    // Nothing ever entered a context here: there is no route, so there is no handler
    // to have opened one. The line still has to join to the response the client saw.
    expect(lines()[0]).toMatchObject({ requestId: 'req-42', source: 'rest', status: 404 })
  })

  it('carries them when the rate limit refused the request before the handler ran', async () => {
    server = build({ rateLimit: { max: 1, windowMs: 60_000 } })
    server.mount(readArticle)

    await server.inject({ method: 'GET', url: `/api/articles/${ID}` })

    const refused = await server.inject({
      method: 'GET',
      url: `/api/articles/${ID}`,
      headers: { 'x-request-id': 'req-43' },
    })

    expect(refused.statusCode).toBe(429)
    expect(lines()[1]).toMatchObject({ requestId: 'req-43', source: 'rest', status: 429 })
  })

  it('mints a request id when the caller sent none, because a line joins to something', async () => {
    await server.ready()

    await server.inject({ method: 'GET', url: '/api/nothing-here' })

    expect(lines()[0]?.requestId).toBeTypeOf('string')
  })
})

describe('the path is the route, never the URL', () => {
  it('logs the parameterised path rather than the id that filled it', async () => {
    server.mount(readArticle)

    await server.inject({ method: 'GET', url: `/api/articles/${ID}?include=author` })

    expect(lines()[0]?.path).toBe('/api/articles/:id')
    expect(JSON.stringify(lines()[0])).not.toContain(ID)
  })

  it('logs a wildcard route as its pattern', async () => {
    server.mount(
      route.get('/media/*', {
        handler: async () => ({ ok: true }),
      }),
    )

    await server.inject({ method: 'GET', url: '/api/media/2026/08/invoice-ada.pdf' })

    expect(lines()[0]?.path).toBe('/api/media/*')
    expect(JSON.stringify(lines()[0])).not.toContain('invoice-ada')
  })

  it('names no path when nothing matched, because the URL is not a substitute', async () => {
    await server.ready()

    await server.inject({ method: 'GET', url: `/api/nothing-here/${ID}?token=sekret` })

    expect(lines()).toHaveLength(1)
    expect(lines()[0]).toMatchObject({ method: 'GET', status: 404 })
    expect(lines()[0]).not.toHaveProperty('path')
    expect(JSON.stringify(lines()[0])).not.toContain('sekret')
  })

  it('never writes down a query string, a body, a header or a cookie', async () => {
    server.mount(signIn)

    await server.inject({
      method: 'POST',
      url: '/api/auth/login?redirect=/secret-place',
      payload: { email: 'ada@assemora.dev', password: 'hunter2' },
      headers: {
        authorization: 'Bearer tok_live_abcdef',
        cookie: 'assemora_session=ses_abc',
        'user-agent': 'Mozilla/5.0 (a device somebody owns)',
      },
    })

    const line = JSON.stringify(lines()[0])

    expect(line).not.toContain('hunter2')
    expect(line).not.toContain('tok_live_abcdef')
    expect(line).not.toContain('ses_abc')
    expect(line).not.toContain('secret-place')
    expect(line).not.toContain('ada@assemora.dev')
    expect(line).not.toContain('Mozilla')
  })
})

describe('the level follows the outcome', () => {
  it('warns about a request the caller was refused and reports it to nobody', async () => {
    server.mount(readArticle)

    const response = await server.inject({ method: 'GET', url: '/api/articles/not-a-uuid' })

    expect(response.statusCode).toBe(422)
    expect(lines()[0]).toMatchObject({ level: 'warn', status: 422 })
    // A malformed uuid is this layer working, not an incident (SPEC.md §88).
    expect(errors.reports).toHaveLength(0)
  })

  it('errors on a failure the server owns, and reports that one', async () => {
    server.mount(failing)

    await server.inject({ method: 'GET', url: '/api/failing' })

    expect(lines()[0]).toMatchObject({ level: 'error', status: 500 })
    expect(errors.reports).toHaveLength(1)
    expect(errors.reports[0]?.operation).toMatchObject({
      kind: 'request',
      name: 'GET /api/failing',
    })
  })

  it('writes a 5xx the endpoint meant at the rung a refusal takes, and reports it to nobody', async () => {
    server.mount(unready)

    // Three, because the point of this is a readiness probe: one line is a rolling
    // deploy, and the same line every five seconds for a day is what an `error` rung
    // would bury the real one under.
    for (const _ of [1, 2, 3]) await server.inject({ method: 'GET', url: '/api/unready' })

    expect(lines()).toHaveLength(3)
    for (const line of lines()) expect(line).toMatchObject({ level: 'warn', status: 503 })
    expect(errors.reports).toHaveLength(0)
  })

  it('sends the reporter the route and not the URL, and no connection string', async () => {
    server.mount(failing)

    await server.inject({ method: 'GET', url: '/api/failing?why=because' })

    const report = errors.reports[0]

    expect(report?.operation.name).toBe('GET /api/failing')
    expect(report?.operation.durationMs).toBeTypeOf('number')
    expect(report?.error.message).not.toContain('hunter2')
  })

  it('raises the level of a request that took too long', async () => {
    server = build({ requestLog: { slowMs: 5 } })
    server.mount(slow)

    await server.inject({ method: 'GET', url: '/api/slow' })

    expect(lines()[0]).toMatchObject({ level: 'warn', status: 200 })
    expect(lines()[0]?.durationMs).toBeGreaterThanOrEqual(5)
  })

  it('leaves the same request at info under the default threshold', async () => {
    server.mount(slow)

    await server.inject({ method: 'GET', url: '/api/slow' })

    expect(SLOW_REQUEST_MS).toBe(1_000)
    expect(lines()[0]?.level).toBe('info')
  })

  it('rounds the duration, because the digits below a tenth are noise', async () => {
    server.mount(readArticle)

    await server.inject({ method: 'GET', url: `/api/articles/${ID}` })

    const durationMs = lines()[0]?.durationMs

    expect(typeof durationMs === 'number' && durationMs * 10).toBe(
      Math.round((durationMs as number) * 10),
    )
  })
})

describe('the level rule itself', () => {
  const cases: readonly [string, Parameters<typeof requestLogLevel>[0], string | undefined][] = [
    ['a server failure', { method: 'GET', status: 500, durationMs: 1 }, 'error'],
    ['a refusal', { method: 'GET', status: 403, durationMs: 1 }, 'warn'],
    ['a slow answer', { method: 'GET', status: 200, durationMs: 999 }, 'warn'],
    ['an ordinary answer', { method: 'GET', status: 200, durationMs: 1 }, 'info'],
    ['a file served', { method: 'GET', status: 200, durationMs: 9_999, asset: true }, undefined],
    ['a file refused', { method: 'GET', status: 404, durationMs: 1, asset: true }, 'warn'],
    ['a file that failed', { method: 'GET', status: 500, durationMs: 1, asset: true }, 'error'],
    // A readiness probe against an application that will never be ready answers this
    // one every few seconds for as long as the deployment is unfinished. At `error` it
    // is the loudest thing in the log and none of it is a failure.
    [
      'a 5xx the endpoint meant',
      { method: 'GET', status: 503, durationMs: 1, expected: true },
      'warn',
    ],
    ['a 5xx nobody meant', { method: 'GET', status: 503, durationMs: 1 }, 'error'],
  ]

  for (const [what, served, expected] of cases) {
    it(`calls ${what} ${expected ?? 'nothing worth a line'}`, () => {
      expect(requestLogLevel(served, 500)).toBe(expected)
    })
  }
})

describe('a directory of files is not an endpoint', () => {
  let root: string

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'assemora-request-log-'))

    await writeFile(join(root, 'index.html'), '<!doctype html><title>Studio</title>')
    await writeFile(join(root, '.env'), 'DATABASE_URL=postgres://u:p@h/db')
    await mkdir(join(root, 'assets'), { recursive: true })

    for (const name of ['main-8f3a1c2b.js', 'main-8f3a1c2b.css', 'logo-1a2b3c4d.svg']) {
      await writeFile(join(root, 'assets', name), '/* built */')
    }

    server.mountAssets({ path: '/studio', root })
  })

  it('does not write a line per file, because a page load is dozens of them', async () => {
    for (const url of [
      '/studio',
      '/studio/assets/main-8f3a1c2b.js',
      '/studio/assets/main-8f3a1c2b.css',
      '/studio/assets/logo-1a2b3c4d.svg',
    ]) {
      expect((await server.inject({ method: 'GET', url })).statusCode).toBe(200)
    }

    expect(lines()).toHaveLength(0)
  })

  it('still says so when a file was refused, and names the mount rather than the path', async () => {
    const refused = await server.inject({ method: 'GET', url: '/studio/.env' })

    expect(refused.statusCode).toBe(404)
    expect(lines()).toHaveLength(1)
    expect(lines()[0]).toMatchObject({ level: 'warn', path: '/studio/*', status: 404 })
    expect(JSON.stringify(lines()[0])).not.toContain('.env')
  })

  it('joins that line to the request, because a probe nobody can correlate is half a line', async () => {
    await server.inject({
      method: 'GET',
      url: '/studio/.env',
      headers: { 'x-request-id': 'req-42' },
    })

    // The one asset line the level rule keeps is a traversal attempt or a broken
    // deploy. Without §87's fields it names neither the client nor the response it
    // belongs to, which is the half of the evidence worth having (SPEC.md §87).
    expect(lines()[0]).toMatchObject({ requestId: 'req-42', source: 'rest' })
  })

  it('leaves the endpoints visible among them', async () => {
    server.mount(readArticle)
    await server.inject({ method: 'GET', url: '/studio/assets/main-8f3a1c2b.js' })
    await server.inject({ method: 'GET', url: `/api/articles/${ID}` })

    expect(lines().map((line) => line.path)).toEqual(['/api/articles/:id'])
  })
})

describe('a resolver that throws is a failure of this deployment, not of the caller', () => {
  beforeEach(() => {
    server = build({
      resolveActor: async () => {
        throw new Error('sessions table is unreachable at postgres://ada:hunter2@db/app')
      },
    })
  })

  it('answers with the redacted payload rather than Fastify’s own', async () => {
    server.mount(readArticle)

    const response = await server.inject({ method: 'GET', url: `/api/articles/${ID}` })

    expect(response.statusCode).toBe(500)
    expect(response.json()).toMatchObject({ error: { code: 'INTERNAL_ERROR' } })
    expect(response.body).not.toContain('hunter2')
  })

  it('reports it and logs it once, instead of vanishing', async () => {
    server.mount(readArticle)

    await server.inject({ method: 'GET', url: `/api/articles/${ID}` })

    expect(lines()).toHaveLength(1)
    expect(lines()[0]).toMatchObject({ level: 'error', path: '/api/articles/:id', status: 500 })
    expect(errors.reports).toHaveLength(1)
    expect(errors.reports[0]?.error.message).not.toContain('hunter2')
  })

  it('does not call it an unauthenticated request, which would blame the caller', async () => {
    server.mount(
      route.get('/me', {
        auth: true,
        response: { id: string() },
        handler: async () => ({ id: 'x' }),
      }),
    )

    const response = await server.inject({ method: 'GET', url: '/api/me' })

    expect(response.statusCode).toBe(500)
  })
})
