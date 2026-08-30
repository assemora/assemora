import { createApplication, createLogger, permitAll, silentWriter } from '@assemora/core'
import { createHttpServer, route } from '@assemora/http'
import { email, number, string, uuid } from '@assemora/schema'
import { beforeEach, describe, expect, it } from 'vitest'

import { buildOpenApiDocument, toOpenApiPath } from './document.js'
import { introspectionRoute, openApiRoute } from './route.js'

const login = route.post('/auth/login', {
  description: 'Exchanges credentials for a token',
  tags: ['auth'],
  body: { email: email(), password: string().min(8) },
  response: { token: string() },
  errors: [{ code: 'INVALID_CREDENTIALS', status: 401, description: 'Wrong email or password' }],
  handler: async () => ({ token: 'x' }),
})

const readArticle = route.get('/articles/:id', {
  auth: true,
  params: { id: uuid() },
  query: { include: string().optional(), page: number().optional() },
  response: { id: string() },
  handler: async ({ params }) => ({ id: params.id }),
})

let app: ReturnType<typeof createApplication>
let server: ReturnType<typeof createHttpServer>

beforeEach(() => {
  extraResources = []
  app = createApplication({ authorization: permitAll(), logger: createLogger(silentWriter) })
  server = createHttpServer({
    registry: app.registry,
    commands: app.commands,
    queries: app.queries,
    logger: app.logger,
  })
})

type Document = {
  openapi: string
  paths: Record<string, Record<string, Record<string, unknown>>>
  components: {
    schemas: Record<string, Record<string, unknown>>
    securitySchemes: Record<string, unknown>
  }
  tags: { name: string }[]
}

let extraResources: Readonly<Record<string, unknown>>[] = []

const document = (): Document =>
  buildOpenApiDocument(
    { ...app.registry.describe(), resources: extraResources },
    { title: 'Assemora', version: '1.0.0' },
  ) as Document

describe('paths', () => {
  it('spells a parameter the way OpenAPI does', () => {
    expect(toOpenApiPath('/articles/:id')).toBe('/articles/{id}')
    expect(toOpenApiPath('/a/:one/b/:two')).toBe('/a/{one}/b/{two}')
    expect(toOpenApiPath('/plain')).toBe('/plain')
  })

  it('documents a route the moment it is registered, with no annotation anywhere', () => {
    server.mount(login)

    const operation = document().paths['/auth/login']?.post

    expect(operation).toMatchObject({
      operationId: 'post_auth_login',
      summary: 'Exchanges credentials for a token',
      tags: ['auth'],
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: { type: 'object', required: ['email', 'password'] },
          },
        },
      },
    })
  })

  it('turns declared errors into documented responses (SPEC.md §46)', () => {
    server.mount(login)

    const responses = document().paths['/auth/login']?.post?.responses as Record<string, unknown>

    expect(Object.keys(responses).sort()).toEqual(['201', '401', '422'])
    expect(responses['401']).toMatchObject({ description: 'Wrong email or password' })
  })

  it('separates path parameters from query parameters', () => {
    server.mount(readArticle)

    const operation = document().paths['/articles/{id}']?.get
    const parameters = (operation?.parameters ?? []) as {
      name: string
      in: string
      required: boolean
    }[]

    expect(parameters).toEqual([
      { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
      { name: 'include', in: 'query', required: false, schema: { type: 'string' } },
      { name: 'page', in: 'query', required: false, schema: { type: 'number' } },
    ])
  })

  it('marks an authenticated route as such', () => {
    server.mount(readArticle)

    const operation = document().paths['/articles/{id}']?.get

    const responses = (operation?.responses ?? {}) as Record<string, unknown>

    expect(operation?.security).toEqual([{ bearerAuth: [] }])
    expect(responses['401']).toBeDefined()
  })

  it('collects the tags it saw', () => {
    server.mount(login, readArticle)

    expect(document().tags).toEqual([{ name: 'auth' }])
  })
})

describe('components', () => {
  it('always carries the error shape of SPEC.md §83', () => {
    expect(document().components.schemas.Error).toMatchObject({
      type: 'object',
      required: ['error'],
    })
  })

  it('describes a resource, without the fields it hides (SPEC.md §85)', () => {
    extraResources = [
      {
        name: 'articles',
        label: 'Articles',
        kind: 'static',
        model: 'articles',
        primaryKey: 'id',
        perPage: 20,
        api: { create: true, read: true, update: true, delete: true },
        fields: [
          {
            name: 'title',
            kind: 'text',
            required: true,
            searchable: false,
            sortable: false,
            filterable: false,
            hidden: false,
            readOnly: false,
            label: 'Title',
            agent: { read: true, write: true },
            schema: { type: 'string' },
          },
          {
            name: 'passwordHash',
            kind: 'text',
            required: false,
            searchable: false,
            sortable: false,
            filterable: false,
            hidden: true,
            readOnly: false,
            label: 'Password hash',
            agent: { read: false, write: false },
            schema: { type: 'string' },
          },
        ],
      },
    ]

    const schema = document().components.schemas.articles

    expect(Object.keys(schema?.properties as Record<string, unknown>)).toEqual(['title'])
    expect(JSON.stringify(schema)).not.toContain('passwordHash')
  })

  it('declares how a token is sent', () => {
    expect(document().components.securitySchemes).toEqual({
      bearerAuth: { type: 'http', scheme: 'bearer' },
    })
  })
})

describe('the document is served by the API it describes', () => {
  it('answers on /api/openapi.json (SPEC.md §44)', async () => {
    server.mount(
      login,
      openApiRoute({ registry: app.registry, info: { title: 'Assemora', version: '1.0.0' } }),
    )

    const response = await server.inject({ method: 'GET', url: '/api/openapi.json' })
    const body = response.json<{ openapi: string; paths: Record<string, unknown> }>()

    expect(response.statusCode).toBe(200)
    expect(body.openapi).toBe('3.1.0')
    expect(Object.keys(body.paths)).toContain('/auth/login')
  })

  it('exposes what the API Explorer shows, to somebody it recognises (SPEC.md §45)', async () => {
    const identified = createHttpServer({
      registry: app.registry,
      commands: app.commands,
      queries: app.queries,
      logger: app.logger,
      resolveActor: async (headers) =>
        headers.authorization === 'Bearer good' ? { type: 'user', id: 'u-1' } : undefined,
    })

    identified.mount(login, introspectionRoute(app.registry))

    const response = await identified.inject({
      method: 'GET',
      url: '/api/_introspection',
      headers: { authorization: 'Bearer good' },
    })
    const body = response.json<{ routes: { path: string }[] }>()

    expect(response.statusCode).toBe(200)
    expect(body.routes.map((entry) => entry.path)).toContain('/auth/login')
  })

  it('does not hand the whole registry to somebody it does not (SPEC.md §85)', async () => {
    server.mount(login, introspectionRoute(app.registry))

    // Every table and column of the auth schema is in here, beside every command,
    // query and route. Studio reads it *after* signing in, and every other read on
    // this surface denies by default; this one used to be the exception.
    const response = await server.inject({ method: 'GET', url: '/api/_introspection' })

    expect(response.statusCode).toBe(401)
    expect(response.body).not.toContain('passwordHash')
  })

  it('is anonymous only for an application that says so out loud', async () => {
    server.mount(login, introspectionRoute(app.registry, { public: true }))

    const response = await server.inject({ method: 'GET', url: '/api/_introspection' })

    expect(response.statusCode).toBe(200)
    expect(app.registry.find('routes', 'get /_introspection')).toMatchObject({ auth: false })
  })
})

describe('the languages a deployment serves (SPEC.md §131)', () => {
  const withLocales = () =>
    buildOpenApiDocument(
      {
        routes: [{ name: 'get /articles', method: 'get', path: '/articles' }],
        locales: [
          { name: 'uk', default: true },
          { name: 'en', default: false },
          { name: 'ru', default: false },
        ],
      },
      { title: 'Assemora', version: '1.0.0' },
    ) as { servers: readonly Record<string, unknown>[]; paths: Record<string, unknown> }

  it('carries the prefix as a server, so a path can be relative to more than one', () => {
    // The whole reason the prefix left the path: `/api/articles` cannot be relative to
    // both `/api` and `/api/ru`, and a locale is exactly a second base.
    expect(Object.keys(withLocales().paths)).toEqual(['/articles'])
    expect(withLocales().servers[0]).toMatchObject({ url: '/api' })
  })

  it('offers the same API one segment further along, with the languages as a variable', () => {
    expect(withLocales().servers[1]).toMatchObject({
      url: '/api/{locale}',
      variables: { locale: { enum: ['uk', 'en', 'ru'], default: 'uk' } },
    })
  })

  it('offers one server in an application that serves one language', () => {
    const document = buildOpenApiDocument(
      { routes: [{ name: 'get /articles', method: 'get', path: '/articles' }] },
      { title: 'Assemora', version: '1.0.0' },
    ) as { servers: readonly Record<string, unknown>[] }

    expect(document.servers).toEqual([{ url: '/api' }])
  })
})
