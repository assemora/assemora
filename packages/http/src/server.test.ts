import { mkdir, mkdtemp, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  AssemoraError,
  command,
  createApplication,
  createLogger,
  module,
  permitAll,
  query,
  silentWriter,
} from '@assemora/core'
import { email, json, number, string, uuid } from '@assemora/schema'
import { beforeEach, describe, expect, it } from 'vitest'

import { bytes } from './bytes.js'
import { commandEndpoints } from './commands.js'
import { clearRouteRegistry } from './module.js'
import { respond } from './respond.js'
import { route } from './route.js'
import { createHttpServer, type HttpServer } from './server.js'

const login = route.post('/auth/login', {
  description: 'Exchanges credentials for a token',
  tags: ['auth'],
  body: { email: email(), password: string().min(8) },
  response: { token: string() },
  errors: [{ code: 'INVALID_CREDENTIALS', status: 401 }],
  handler: async ({ body }) => ({ token: `token-for-${body.email}`, secret: 'never sent' }),
})

const readArticle = route.get('/articles/:id', {
  params: { id: uuid() },
  query: { include: string().optional() },
  response: { id: string(), views: number() },
  handler: async ({ params }) => ({ id: params.id, views: 7 }),
})

const guarded = route.get('/me', {
  auth: true,
  response: { id: string() },
  handler: async ({ actor }) => ({ id: actor?.id ?? 'nobody' }),
})

const download = route.get('/download', {
  description: 'Answers with bytes rather than JSON',
  handler: () =>
    bytes(new Uint8Array([0x89, 0x50, 0x4e, 0x47]), 'image/png', { 'cache-control': 'immutable' }),
})

const signIn = route.post('/session', {
  response: { userId: string() },
  handler: () =>
    respond(
      { userId: 'ada' },
      {
        cookies: [
          { name: 'assemora_session', value: 'ses_abc', httpOnly: true, sameSite: 'strict' },
          { name: 'assemora_csrf', value: 'csrf-1' },
        ],
      },
    ),
})

const broken = route.get('/broken', {
  response: { token: string() },
  handler: async () => ({ token: 42 }),
})

const failing = route.get('/failing', {
  handler: async () => {
    throw new Error('the connection string is postgres://user:hunter2@db/app')
  },
})

const ID = '3f2504e0-4f89-41d3-9a0c-0305e82c3301'

let app: ReturnType<typeof createApplication>
let server: HttpServer

const build = (options: Partial<Parameters<typeof createHttpServer>[0]> = {}) => {
  app = createApplication({ authorization: permitAll(), logger: createLogger(silentWriter) })

  return createHttpServer({
    registry: app.registry,
    commands: app.commands,
    queries: app.queries,
    logger: app.logger,
    ...options,
  })
}

beforeEach(() => {
  clearRouteRegistry()
  server = build()
})

describe('a route serves and documents itself', () => {
  it('validates the body and answers with the declared shape', async () => {
    server.mount(login)

    const response = await server.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'ada@x.io', password: 'longenough' },
    })

    expect(response.statusCode).toBe(201)
    expect(response.json()).toEqual({ token: 'token-for-ada@x.io' })
  })

  it('never sends a field the response schema does not declare', async () => {
    server.mount(login)

    const response = await server.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'ada@x.io', password: 'longenough' },
    })

    expect(response.body).not.toContain('never sent')
  })

  it('reports invalid input by field, as SPEC.md §84 requires', async () => {
    server.mount(login)

    const response = await server.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'nope', password: 'short' },
    })

    expect(response.statusCode).toBe(422)
    expect(response.json()).toMatchObject({
      error: {
        code: 'VALIDATION_ERROR',
        fields: {
          'body.email': ['Invalid email'],
          'body.password': ['Must be at least 8 characters'],
        },
      },
    })
  })

  it('validates path params and query', async () => {
    server.mount(readArticle)

    await expect(
      server.inject({ method: 'GET', url: '/api/articles/not-a-uuid' }).then((r) => r.statusCode),
    ).resolves.toBe(422)

    const ok = await server.inject({ method: 'GET', url: `/api/articles/${ID}?include=author` })

    expect(ok.statusCode).toBe(200)
    expect(ok.json()).toEqual({ id: ID, views: 7 })
  })

  it('describes itself in the Schema Registry (SPEC.md §42)', async () => {
    server.mount(login)

    expect(app.registry.find('routes', 'post /auth/login')).toMatchObject({
      method: 'post',
      path: '/auth/login',
      description: 'Exchanges credentials for a token',
      tags: ['auth'],
      status: 201,
      body: {
        type: 'object',
        properties: {
          email: { type: 'string', format: 'email' },
          password: { type: 'string', minLength: 8 },
        },
        required: ['email', 'password'],
      },
      response: { type: 'object', properties: { token: { type: 'string' } } },
      errors: [{ code: 'INVALID_CREDENTIALS', status: 401 }],
    })
  })
})

describe('failures', () => {
  it('refuses an authenticated route without an actor', async () => {
    server.mount(guarded)

    const response = await server.inject({ method: 'GET', url: '/api/me' })

    expect(response.statusCode).toBe(401)
    expect(response.json()).toMatchObject({ error: { code: 'UNAUTHORIZED' } })
  })

  it('lets an actor through once one can be resolved', async () => {
    server = build({
      resolveActor: async (headers) =>
        headers.authorization === 'Bearer good' ? { type: 'user', id: 'u-1' } : undefined,
    })
    server.mount(guarded)

    const response = await server.inject({
      method: 'GET',
      url: '/api/me',
      headers: { authorization: 'Bearer good' },
    })

    expect(response.json()).toEqual({ id: 'u-1' })
  })

  it('refuses to answer with a shape the route did not promise', async () => {
    server.mount(broken)

    const response = await server.inject({ method: 'GET', url: '/api/broken' })

    expect(response.statusCode).toBe(500)
    expect(response.json()).toMatchObject({ error: { code: 'RESPONSE_MISMATCH' } })
  })

  it('never leaks the message of an unexpected failure', async () => {
    server.mount(failing)

    const response = await server.inject({ method: 'GET', url: '/api/failing' })

    expect(response.statusCode).toBe(500)
    expect(response.json()).toMatchObject({ error: { code: 'INTERNAL_ERROR' } })
    expect(response.body).not.toContain('hunter2')
    expect(response.body).not.toContain('postgres://')
  })

  it('answers an Assemora error with its own status and code', async () => {
    server.mount(
      route.get('/missing', {
        handler: async () => {
          throw new AssemoraError('ARTICLE_NOT_FOUND', 'Article was not found', { status: 404 })
        },
      }),
    )

    const response = await server.inject({ method: 'GET', url: '/api/missing' })

    expect(response.statusCode).toBe(404)
    expect(response.json()).toMatchObject({ error: { code: 'ARTICLE_NOT_FOUND' } })
  })
})

describe('request context (SPEC.md §12)', () => {
  it('carries the incoming request id into the answer', async () => {
    server.mount(
      route.get('/echo', {
        response: { requestId: string() },
        handler: async ({ context }) => ({ requestId: context.requestId }),
      }),
    )

    const response = await server.inject({
      method: 'GET',
      url: '/api/echo',
      headers: { 'x-request-id': 'req-42' },
    })

    expect(response.json()).toEqual({ requestId: 'req-42' })
  })

  it('invents one when the caller sent none', async () => {
    server.mount(
      route.get('/echo', {
        response: { requestId: string() },
        handler: async ({ context }) => ({ requestId: context.requestId }),
      }),
    )

    expect(
      (await server.inject({ method: 'GET', url: '/api/echo' })).json<{ requestId: string }>()
        .requestId,
    ).toMatch(/^[0-9a-f-]{36}$/)
  })

  it('reports the request id back with a failure', async () => {
    server.mount(failing)

    const response = await server.inject({
      method: 'GET',
      url: '/api/failing',
      headers: { 'x-request-id': 'req-7' },
    })

    expect(response.json()).toMatchObject({ error: { requestId: 'req-7' } })
  })
})

describe('CORS is configured, never waved through (SPEC.md §85)', () => {
  it('answers only for an origin that was listed', async () => {
    server = build({ cors: { origins: ['https://studio.example'] } })
    server.mount(login)
    await server.ready()

    const allowed = await server.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'ada@x.io', password: 'longenough' },
      headers: { origin: 'https://studio.example' },
    })
    const refused = await server.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'ada@x.io', password: 'longenough' },
      headers: { origin: 'https://evil.example' },
    })

    expect(allowed.headers['access-control-allow-origin']).toBe('https://studio.example')
    expect(refused.headers['access-control-allow-origin']).toBeUndefined()
  })

  it('sends no CORS headers at all when none were configured', async () => {
    server.mount(login)
    await server.ready()

    const response = await server.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'ada@x.io', password: 'longenough' },
      headers: { origin: 'https://anywhere.example' },
    })

    expect(response.headers['access-control-allow-origin']).toBeUndefined()
  })
})

describe('modules register routes without mounting them', () => {
  it('describes a module route in the registry', () => {
    const application = createApplication({
      modules: [module('auth').routes(login)],
      authorization: permitAll(),
      logger: createLogger(silentWriter),
    })

    expect(application.registry.find('routes', 'post /auth/login')).toMatchObject({
      module: 'auth',
      path: '/auth/login',
    })
  })
})

describe('a handler may answer with bytes', () => {
  it('sends the body untouched, with the content type and headers it asked for', async () => {
    server.mount(download)
    await server.ready()

    const response = await server.inject({ method: 'GET', url: '/api/download' })

    expect(response.statusCode).toBe(200)
    expect(response.headers['content-type']).toBe('image/png')
    expect(response.headers['cache-control']).toBe('immutable')
    expect([...response.rawBody]).toEqual([0x89, 0x50, 0x4e, 0x47])
  })
})

describe('commands are reachable over HTTP (SPEC.md §14)', () => {
  const Publish = command('pages.publish', {
    description: 'Makes a page visible',
    input: { id: uuid() },
    handle: async ({ id }) => ({ id, published: true }),
  })

  const start = () => {
    const application = createApplication({
      modules: [module('pages').commands(Publish)],
      authorization: permitAll(),
      logger: createLogger(silentWriter),
    })

    const running = createHttpServer({
      registry: application.registry,
      commands: application.commands,
      queries: application.queries,
      logger: application.logger,
    })

    return { application, server: running }
  }

  it('generates one endpoint per registered command', async () => {
    const { server: running } = start()

    running.mountCommands()
    await running.ready()

    const response = await running.inject({
      method: 'POST',
      url: '/api/commands/pages.publish',
      payload: { id: ID },
    })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({ id: ID, published: true })
  })

  it('documents the command input as the endpoint body', async () => {
    const { application, server: running } = start()

    running.mountCommands()
    await running.ready()

    const described = application.registry.find('routes', 'post /commands/pages.publish')
    const command = application.registry.find('commands', 'pages.publish')

    expect(described?.body).toEqual(command?.input)
    expect(described?.description).toBe('Makes a page visible')
  })

  it('leaves validation to the bus rather than repeating it', async () => {
    const { server: running } = start()

    running.mountCommands()
    await running.ready()

    const response = await running.inject({
      method: 'POST',
      url: '/api/commands/pages.publish',
      payload: { id: 'not a uuid' },
    })

    expect(response.statusCode).toBe(422)
    expect(response.json<{ error: { code: string } }>().error.code).toBe('VALIDATION_ERROR')
  })
})

describe('a command reachable only from its own route (SPEC.md §85)', () => {
  const SignIn = command('auth.login', {
    description: 'Exchanges an email and a password for a session',
    reachableFrom: 'its own route',
    input: { email: email() },
    handle: async () => ({ token: 'ses_secret' }),
  })

  const Publish = command('pages.publish', {
    input: { id: uuid() },
    handle: async ({ id }) => ({ id, published: true }),
  })

  const start = () => {
    const application = createApplication({
      modules: [module('auth').commands(SignIn), module('pages').commands(Publish)],
      authorization: permitAll(),
      logger: createLogger(silentWriter),
    })

    return {
      application,
      server: createHttpServer({
        registry: application.registry,
        commands: application.commands,
        queries: application.queries,
        logger: application.logger,
      }),
    }
  }

  it('is left out of the generated endpoints, and the others are not', () => {
    const { application } = start()
    const names = commandEndpoints(application.registry).map((endpoint) => endpoint.name)

    expect(names).not.toContain('auth.login')
    expect(names).toContain('pages.publish')
  })

  it('has no generic alias once the commands are mounted', async () => {
    const { server: running } = start()

    running.mountCommands()
    await running.ready()

    // `auth.login` is publicly authorized — it has to be, since the caller is nobody
    // yet — so an alias here would hand a session back as readable JSON, exempt from
    // CSRF, with no cookie and no route hardening in front of it.
    const aliased = await running.inject({
      method: 'POST',
      url: '/api/commands/auth.login',
      payload: { email: 'ada@assemora.dev' },
    })

    expect(aliased.statusCode).toBe(404)

    const ordinary = await running.inject({
      method: 'POST',
      url: '/api/commands/pages.publish',
      payload: { id: ID },
    })

    expect(ordinary.statusCode).toBe(200)
  })

  it('is not documented either, because the endpoint is what OpenAPI describes', () => {
    const { application, server: running } = start()

    running.mountCommands()

    expect(application.registry.find('routes', 'post /commands/auth.login')).toBeUndefined()
    expect(application.registry.find('routes', 'post /commands/pages.publish')).toBeDefined()
  })
})

describe('a handler may set cookies and a status of its own (SPEC.md §85)', () => {
  it('serializes each cookie and still checks the body against the response schema', async () => {
    server.mount(signIn)
    await server.ready()

    const response = await server.inject({ method: 'POST', url: '/api/session' })
    const cookies = response.headers['set-cookie'] as string[]

    expect(response.json()).toEqual({ userId: 'ada' })
    expect(cookies[0]).toBe('assemora_session=ses_abc; Path=/; HttpOnly; SameSite=Strict')
    expect(cookies[1]).toBe('assemora_csrf=csrf-1; Path=/; SameSite=Lax')
  })
})

describe('CSRF protection for cookie-authenticated mutations (SPEC.md §85)', () => {
  /**
   * Somebody is signed in, because that is the whole subject.
   *
   * A double-submit token protects a mutation performed with an ambient credential.
   * A resolver that answers with an actor is what makes the cookie one; a request the
   * server cannot attribute to anybody has no authority for another site to borrow,
   * and a stale cookie the server no longer honours is exactly that.
   */
  const signedIn = { type: 'user', id: ID } as const

  beforeEach(() => {
    clearRouteRegistry()
    server = build({
      csrf: {},
      resolveActor: async (headers) =>
        headers.authorization !== undefined || headers.cookie?.includes('assemora_session') === true
          ? signedIn
          : undefined,
    })
    server.mount(login)
  })

  it('lets a request with no cookies through: nothing ambient is being spent', async () => {
    await server.ready()

    const response = await server.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'ada@x.io', password: 'longenough' },
    })

    expect(response.statusCode).toBe(201)
  })

  it('lets somebody sign in again with a cookie the server has stopped honouring', async () => {
    await server.ready()

    // The case this exists for: a session cookie outlives the session it names — the
    // process restarted, the row expired, an administrator revoked it — and the
    // browser keeps sending it. Refusing on the *cookie header* locked that person
    // out of the login page itself and told them their password was wrong.
    const response = await server.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'ada@x.io', password: 'longenough' },
      headers: { cookie: 'assemora_stale=ses_fromlastweek' },
    })

    expect(response.statusCode).toBe(201)
  })

  it('refuses a cookie-carrying mutation with no matching header', async () => {
    await server.ready()

    const response = await server.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'ada@x.io', password: 'longenough' },
      headers: { cookie: 'assemora_session=ses_abc; assemora_csrf=secret' },
    })

    expect(response.statusCode).toBe(403)
    expect(response.json<{ error: { code: string } }>().error.code).toBe('CSRF_FAILED')
  })

  it('refuses a header that does not match the cookie', async () => {
    await server.ready()

    const response = await server.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'ada@x.io', password: 'longenough' },
      headers: {
        cookie: 'assemora_session=ses_abc; assemora_csrf=secret',
        'x-csrf-token': 'guessed',
      },
    })

    expect(response.statusCode).toBe(403)
  })

  it('accepts the header the page read back from the cookie', async () => {
    await server.ready()

    const response = await server.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'ada@x.io', password: 'longenough' },
      headers: {
        cookie: 'assemora_session=ses_abc; assemora_csrf=secret',
        'x-csrf-token': 'secret',
      },
    })

    expect(response.statusCode).toBe(201)
  })

  it('leaves a bearer request alone: a token is never sent by the browser on its own', async () => {
    await server.ready()

    const response = await server.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'ada@x.io', password: 'longenough' },
      headers: {
        cookie: 'assemora_session=ses_abc; assemora_csrf=secret',
        authorization: 'Bearer ass_something',
      },
    })

    expect(response.statusCode).toBe(201)
  })

  it('exempts a bearer credential, not the mere presence of the header', async () => {
    await server.ready()

    // The exemption is worth exactly as much as it agrees with how the actor was
    // resolved. `resolveActor` reads a *bearer* token; anything else falls straight
    // through to the session cookie — so a header carrying no bearer credential
    // leaves the request authenticated by the ambient cookie, which is the one case
    // CSRF exists for (SPEC.md §85).
    const codes = await Promise.all(
      [
        'Basic Zm9vOmJhcg==',
        'Bearer',
        'Bearer ',
        'Token ass_something',
        'bearerish ass_something',
      ].map(
        async (authorization) =>
          (
            await server.inject({
              method: 'POST',
              url: '/api/auth/login',
              payload: { email: 'ada@x.io', password: 'longenough' },
              headers: { cookie: 'assemora_session=ses_abc; assemora_csrf=secret', authorization },
            })
          ).statusCode,
      ),
    )

    expect(codes).toEqual([403, 403, 403, 403, 403])
  })

  it('reads the scheme the way every HTTP client writes it', async () => {
    await server.ready()

    // The scheme is case-insensitive on the wire, and a token may hold anything but a
    // space. Refusing either of these would break a client that is holding it right.
    const codes = await Promise.all(
      ['bearer ass_something', 'BEARER ass_something'].map(
        async (authorization) =>
          (
            await server.inject({
              method: 'POST',
              url: '/api/auth/login',
              payload: { email: 'ada@x.io', password: 'longenough' },
              headers: { cookie: 'assemora_csrf=secret', authorization },
            })
          ).statusCode,
      ),
    )

    expect(codes).toEqual([201, 201])
  })
})

describe('queries are reachable over HTTP (SPEC.md §15)', () => {
  const History = query('revisions.list', {
    description: 'The history of one entity',
    input: {
      entityType: string(),
      entityId: uuid(),
      page: number().integer().optional(),
      draft: json<boolean>().optional(),
      filters: json<Record<string, unknown>>().optional(),
    },
    handle: async (input) => ({ asked: input }),
  })

  const start = () => {
    const application = createApplication({
      modules: [module('revisions').queries(History)],
      authorization: permitAll(),
      logger: createLogger(silentWriter),
    })

    return {
      application,
      server: createHttpServer({
        registry: application.registry,
        commands: application.commands,
        queries: application.queries,
        logger: application.logger,
      }),
    }
  }

  it('generates one GET endpoint per registered query', async () => {
    const { server: running } = start()

    running.mountQueries()
    await running.ready()

    const response = await running.inject({
      method: 'GET',
      url: `/api/queries/revisions.list?entityType=pages&entityId=${ID}`,
    })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({ asked: { entityType: 'pages', entityId: ID } })
  })

  it('reads each parameter the way the query said it would be typed', async () => {
    const { server: running } = start()

    running.mountQueries()
    await running.ready()

    const response = await running.inject({
      method: 'GET',
      url:
        `/api/queries/revisions.list?entityType=pages&entityId=${ID}` +
        '&page=3&draft=true&filters=%7B%22status%22%3A%22published%22%7D',
    })

    expect(response.json<{ asked: Record<string, unknown> }>().asked).toEqual({
      entityType: 'pages',
      entityId: ID,
      page: 3,
      draft: true,
      filters: { status: 'published' },
    })
  })

  it('leaves validation to the bus rather than repeating it', async () => {
    const { server: running } = start()

    running.mountQueries()
    await running.ready()

    const response = await running.inject({
      method: 'GET',
      url: '/api/queries/revisions.list?entityType=pages&entityId=not-a-uuid',
    })

    expect(response.statusCode).toBe(422)
    expect(response.json<{ error: { code: string } }>().error.code).toBe('VALIDATION_ERROR')
  })

  it('describes the query in the registry, module and all', () => {
    const { application, server: running } = start()

    running.mountQueries()

    expect(application.registry.find('routes', 'get /queries/revisions.list')).toMatchObject({
      method: 'get',
      tags: ['revisions'],
      description: 'The history of one entity',
    })
  })
})

describe('the headers every response carries (SPEC.md §85)', () => {
  it('refuses to be framed, and refuses to be sniffed', async () => {
    server.mount(login)
    await server.ready()

    const response = await server.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'ada@x.io', password: 'longenough' },
    })

    expect(response.headers['content-security-policy']).toContain("frame-ancestors 'none'")
    expect(response.headers['content-security-policy']).toContain("object-src 'none'")
    expect(response.headers['x-content-type-options']).toBe('nosniff')
    expect(response.headers['referrer-policy']).toBe('no-referrer')
  })

  it('lets exactly the editor frame the page it edits (SPEC.md §59)', async () => {
    clearRouteRegistry()

    const running = build({ security: { frameAncestors: ['http://localhost:5173'] } })

    running.mount(login)
    await running.ready()

    const response = await running.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'ada@x.io', password: 'longenough' },
    })

    expect(response.headers['content-security-policy']).toContain(
      'frame-ancestors http://localhost:5173',
    )
  })

  it('lets the bucket that holds the files be the source of the images (SPEC.md §63)', async () => {
    clearRouteRegistry()

    const running = build({ security: { mediaSources: ['https://cdn.example.com'] } })

    running.mount(login)
    await running.ready()

    const response = await running.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'ada@x.io', password: 'longenough' },
    })
    const policy = String(response.headers['content-security-policy'])

    // S3-compatible storage is mandatory in v1, and its URLs are not this origin. A
    // policy that blocks every image the media library hands out is not a policy an
    // application can deploy.
    expect(policy).toContain("img-src 'self' data: blob: https://cdn.example.com")
    expect(policy).toContain("media-src 'self' https://cdn.example.com")
    // …and it widens nothing else. A media origin is not a script origin.
    expect(policy).toContain("script-src 'self'")
    expect(policy).toContain("connect-src 'self'")
    expect(policy).toContain("default-src 'self'")
    expect(policy).not.toContain("script-src 'self' https://cdn.example.com")
  })

  it('sends the narrow policy when no other origin serves the files', async () => {
    server.mount(login)
    await server.ready()

    const response = await server.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'ada@x.io', password: 'longenough' },
    })
    const policy = String(response.headers['content-security-policy'])

    expect(policy).toContain("img-src 'self' data: blob:;")
    expect(policy).not.toContain('media-src')
  })

  it('takes a policy an application wrote itself', async () => {
    clearRouteRegistry()

    const running = build({ security: { contentSecurityPolicy: "default-src 'none'" } })

    running.mount(login)
    await running.ready()

    const response = await running.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'ada@x.io', password: 'longenough' },
    })

    expect(response.headers['content-security-policy']).toBe("default-src 'none'")
  })
})

describe('a single-page application lives beside the API, not inside it', () => {
  let root: string

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'assemora-studio-'))

    await writeFile(join(root, 'index.html'), '<!doctype html><title>Studio</title>')
    await mkdir(join(root, 'assets'), { recursive: true })
    await writeFile(join(root, 'assets', 'main-8f3a1c2b.js'), 'console.log(1)')

    server.mountAssets({ path: '/studio', root })
  })

  it('serves the entry document at the mount itself', async () => {
    const answered = await server.inject({ method: 'GET', url: '/studio' })

    expect(answered.statusCode).toBe(200)
    expect(answered.headers['content-type']).toBe('text/html; charset=utf-8')
    expect(answered.body).toContain('Studio')
  })

  it('serves it at the trailing slash too, because a browser sends both', async () => {
    expect((await server.inject({ method: 'GET', url: '/studio/' })).statusCode).toBe(200)
  })

  it('serves an asset with the caching a fingerprint earns', async () => {
    const answered = await server.inject({
      method: 'GET',
      url: '/studio/assets/main-8f3a1c2b.js',
    })

    expect(answered.statusCode).toBe(200)
    expect(answered.headers['cache-control']).toBe('public, max-age=31536000, immutable')
  })

  it('hands an unknown path to the router in the browser', async () => {
    const answered = await server.inject({ method: 'GET', url: '/studio/pages/42/history' })

    expect(answered.statusCode).toBe(200)
    expect(answered.body).toContain('Studio')
  })

  it('is not below the API prefix, and is not an endpoint anybody documented', async () => {
    expect((await server.inject({ method: 'GET', url: '/api/studio' })).statusCode).toBe(404)
    expect(app.registry.section('routes').map((entry) => entry.name)).toEqual([])
  })

  it('refuses a path that climbs out of the directory', async () => {
    const answered = await server.inject({
      method: 'GET',
      url: '/studio/..%2f..%2f..%2fetc%2fpasswd',
    })

    expect(answered.statusCode).toBe(404)
  })

  it('refuses a symlink out of the directory, and the dotfile beside the bundle', async () => {
    // `mountAssets({ root })` is public API, and `studio: { root }` / `frontend: { root }`
    // point it at a directory an application chose. One `ln -s` in a `public/` folder
    // — or a pnpm `node_modules`, which is a farm of them — must not turn the mount
    // into a reader for the whole disk (SPEC.md §85).
    const outside = await mkdtemp(join(tmpdir(), 'assemora-outside-'))
    const bundle = join(outside, 'bundle')

    await mkdir(bundle, { recursive: true })
    await writeFile(join(bundle, 'index.html'), '<!doctype html><title>Preview</title>')
    await writeFile(join(bundle, '.env'), 'DATABASE_URL=postgres://u:p@h/db')
    await writeFile(join(outside, 'secret.txt'), 'SUPER SECRET OUTSIDE ROOT')
    await symlink(join(outside, 'secret.txt'), join(bundle, 'link.txt'))
    await symlink(outside, join(bundle, 'up'))

    // `fallback: false`, so a refusal is visible as a 404 rather than as the entry
    // document a single-page mount would answer an unknown path with.
    server.mountAssets({ path: '/preview', root: bundle, fallback: false })
    await server.ready()

    const codes = await Promise.all(
      [
        '/preview/index.html',
        '/preview/link.txt',
        '/preview/up/secret.txt',
        '/preview/.env',
        '/preview/up/bundle/.env',
      ].map(async (url) => (await server.inject({ method: 'GET', url })).statusCode),
    )

    expect(codes).toEqual([200, 404, 404, 404, 404])
  })
})

describe('the ceiling of SPEC.md §85 is a ceiling', () => {
  it('counts requests and refuses the ones past the limit', async () => {
    const limited = build({ rateLimit: { max: 2, windowMs: 60_000 } })

    limited.mount(
      route.get('/ping', {
        response: { status: string() },
        handler: async () => ({ status: 'ok' }),
      }),
    )

    const codes: number[] = []

    for (let attempt = 0; attempt < 4; attempt += 1) {
      codes.push((await limited.inject({ method: 'GET', url: '/api/ping' })).statusCode)
    }

    // A route mounted before the plugin finished registering is never counted, which
    // is what this asserts is no longer possible.
    expect(codes).toEqual([200, 200, 429, 429])
  })

  it('leaves an application that asked for no limit alone', async () => {
    server.mount(
      route.get('/ping', {
        response: { status: string() },
        handler: async () => ({ status: 'ok' }),
      }),
    )

    for (let attempt = 0; attempt < 4; attempt += 1) {
      expect((await server.inject({ method: 'GET', url: '/api/ping' })).statusCode).toBe(200)
    }
  })
})

describe('a body larger than the endpoint accepts (SPEC.md §85)', () => {
  const upload = (bodyLimit?: number) =>
    route.post('/upload', {
      ...(bodyLimit === undefined ? {} : { bodyLimit }),
      body: { data: string() },
      response: { size: number() },
      handler: async ({ body }) => ({ size: body.data.length }),
    })

  /** A payload whose JSON is comfortably larger than `bytes`. */
  const payload = (bytes: number) => ({ data: 'x'.repeat(bytes) })

  it('refuses it, and says how large the endpoint is', async () => {
    const small = build({ bodyLimit: 1024 })

    small.mount(upload())

    const response = await small.inject({
      method: 'POST',
      url: '/api/upload',
      payload: payload(4096),
    })

    expect(response.statusCode).toBe(413)

    const answer = response.json<{ error: { code: string; message: string } }>()

    // The §46 envelope, like every other refusal: a caller that reads `error.code`
    // must not have to read Fastify's shape for this one.
    expect(answer.error.code).toBe('PAYLOAD_TOO_LARGE')
    expect(answer.error.message).toContain('1024')
  })

  it('lets the route that takes an upload have a ceiling of its own', async () => {
    const small = build({ bodyLimit: 1024 })

    small.mount(upload(64 * 1024))

    const response = await small.inject({
      method: 'POST',
      url: '/api/upload',
      payload: payload(4096),
    })

    expect(response.statusCode).toBe(201)
    expect(response.json<{ size: number }>().size).toBe(4096)
  })

  it('leaves every other address at the ceiling the server set', async () => {
    const small = build({ bodyLimit: 1024 })

    small.mount(upload(64 * 1024), login)

    const refused = await small.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'ada@x.io', password: 'longenough'.repeat(400) },
    })

    expect(refused.statusCode).toBe(413)
  })

  it('describes the ceiling, so a generated client is not promised what is refused', () => {
    const small = build({ bodyLimit: 1024 })

    small.mount(upload(64 * 1024))

    expect(app.registry.find('routes', 'post /upload')?.bodyLimit).toBe(64 * 1024)
  })

  it('describes nothing when the route keeps what the server set', () => {
    server.mount(upload())

    expect(app.registry.find('routes', 'post /upload')?.bodyLimit).toBeUndefined()
  })
})

describe('a language is a path segment (SPEC.md §131)', () => {
  const speaking = route.get('/spoken', {
    response: { locale: string(), fallback: string() },
    handler: async ({ context }) => ({
      locale: context.locale ?? 'none',
      fallback: context.locales?.defaultLocale ?? 'none',
    }),
  })

  const served = () => {
    const running = build({ locales: { locales: ['uk', 'en', 'ru'], defaultLocale: 'uk' } })

    running.mount(speaking)

    return running
  }

  it('reads the language off the address and routes to the one description', async () => {
    const response = await served().inject({ method: 'GET', url: '/api/ru/spoken' })

    expect(response.json()).toEqual({ locale: 'ru', fallback: 'uk' })
  })

  it('serves the default language at the bare address', async () => {
    const response = await served().inject({ method: 'GET', url: '/api/spoken' })

    expect(response.json()).toEqual({ locale: 'uk', fallback: 'uk' })
  })

  it('leaves a first segment that is not a language alone', async () => {
    // `/api/v1/spoken` is a version and always was: nothing is stripped, so the route
    // is simply not there. A locale prefix that swallowed it would have made every
    // versioned address unreachable.
    expect((await served().inject({ method: 'GET', url: '/api/v1/spoken' })).statusCode).toBe(404)
  })

  it('describes one path, not one per language', () => {
    served()

    // Three languages would otherwise treble every endpoint in the document whose
    // whole purpose is to be read.
    expect(app.registry.section('routes').map((entry) => entry.path)).toEqual(['/spoken'])
  })

  it('says nothing about a language in an application that serves one', async () => {
    const running = build()

    running.mount(speaking)

    expect((await running.inject({ method: 'GET', url: '/api/spoken' })).json()).toEqual({
      locale: 'none',
      fallback: 'none',
    })
  })
})
