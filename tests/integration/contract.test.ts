/**
 * The contract of SPEC.md §98 and the Definition of Done of §121.
 *
 * One route declaration, one resource declaration — and no further configuration
 * anywhere — must produce: an entry in the Schema Registry, an operation in
 * `/api/openapi.json`, a row in what the API Explorer reads, and a method in the
 * generated SDK. This test is what turns that promise into something that fails when
 * it stops being true.
 */
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { createApplication, createLogger, module, permitAll, silentWriter } from '@assemora/core'
import {
  boolean as booleanColumn,
  dataTransactions,
  model,
  number as numberColumn,
  string,
  timestamp,
  useAdapter,
  uuid,
} from '@assemora/data'
import { createMemoryAdapter } from '@assemora/database'
import { clearRouteRegistry, createHttpServer, type HttpServer, route } from '@assemora/http'
import { introspectionRoute, openApiRoute } from '@assemora/openapi'
import { clearResourceRegistry, number, resource, select, text, toggle } from '@assemora/resources'
import { email, string as stringSchema } from '@assemora/schema'
import { generateSdk } from '@assemora/sdk'
import { beforeEach, describe, expect, it } from 'vitest'

const Article = model('articles', {
  id: uuid().primary().defaultRandom(),
  title: string(),
  status: string(),
  views: numberColumn().default(0),
  featured: booleanColumn().default(false),
  secretNote: string().nullable(),
  createdAt: timestamp().created(),
})

const Articles = resource(Article, {
  title: text().required().searchable().sortable(),
  status: select('draft', 'published').required().filterable(),
  views: number().sortable().filterable(),
  featured: toggle().filterable(),
  secretNote: text().hidden(),
})

/** The route of SPEC.md §121, written exactly as the specification writes it. */
const login = route.post('/auth/login', {
  description: 'Exchanges credentials for a token',
  tags: ['auth'],
  body: { email: email(), password: stringSchema().min(8) },
  response: { token: stringSchema() },
  errors: [{ code: 'INVALID_CREDENTIALS', status: 401 }],
  handler: async ({ body }) => ({ token: `token-for-${body.email}` }),
})

let app: ReturnType<typeof createApplication>
let server: HttpServer

beforeEach(async () => {
  clearResourceRegistry()
  clearRouteRegistry()
  useAdapter(createMemoryAdapter({ articles: [] }))

  app = createApplication({
    modules: [module('blog').resources(Articles).routes(login)],
    authorization: permitAll(),
    transactions: dataTransactions(),
    logger: createLogger(silentWriter),
  })

  server = createHttpServer({
    registry: app.registry,
    commands: app.commands,
    queries: app.queries,
    logger: app.logger,
  })

  server
    .mountRegistered()
    .mountResources()
    .mount(
      openApiRoute({ registry: app.registry, info: { title: 'Assemora', version: '1.0.0' } }),
      // Open, because this server resolves no actor at all: what is under test is that
      // one declaration reaches the snapshot, not who may read it (that is asserted in
      // `@assemora/openapi` and in `@assemora/assemora`).
      introspectionRoute(app.registry, { public: true }),
    )

  await server.ready()
})

const create = async (data: Record<string, unknown>) =>
  server.inject({ method: 'POST', url: '/api/articles', payload: data })

describe('one declaration reaches every subsystem (SPEC.md §98)', () => {
  it('appears in the Schema Registry', () => {
    expect(app.registry.find('routes', 'post /auth/login')).toMatchObject({
      module: 'blog',
      method: 'post',
      path: '/auth/login',
    })
    expect(app.registry.find('resources', 'articles')?.label).toBe('Articles')
  })

  it('appears in /api/openapi.json', async () => {
    const response = await server.inject({ method: 'GET', url: '/api/openapi.json' })
    const document = response.json<{
      paths: Record<string, Record<string, { summary?: string }>>
      components: { schemas: Record<string, { properties: Record<string, unknown> }> }
    }>()

    expect(document.paths['/auth/login']?.post?.summary).toBe('Exchanges credentials for a token')
    expect(Object.keys(document.paths)).toEqual(
      expect.arrayContaining(['/articles', '/articles/{id}']),
    )
    expect(Object.keys(document.components.schemas.articles?.properties ?? {})).not.toContain(
      'secretNote',
    )
  })

  it('appears in what the API Explorer reads (SPEC.md §45)', async () => {
    const response = await server.inject({ method: 'GET', url: '/api/_introspection' })
    const snapshot = response.json<Record<string, { name: string }[]>>()
    const names = (section: string) => (snapshot[section] ?? []).map((entry) => entry.name)

    expect(names('routes')).toEqual(
      expect.arrayContaining(['post /auth/login', 'get /articles', 'delete /articles/:id']),
    )
    expect(names('resources')).toContain('articles')
    expect(names('commands')).toContain('entries.create')
    expect(names('queries')).toContain('entries.list')
  })

  it('appears in the generated SDK', () => {
    const source = generateSdk(app.registry.describe())

    expect(source).toContain('readonly articles: ResourceClient<Articles>')
    expect(source).toContain('postAuthLogin(input: {')
    expect(source).toContain('readonly token: string')
    expect(source).not.toContain('secretNote')
  })

  it('and the generated SDK actually compiles (SPEC.md §92)', () => {
    const directory = mkdtempSync(join(tmpdir(), 'assemora-sdk-'))
    const file = join(directory, 'client.ts')

    writeFileSync(
      file,
      generateSdk(app.registry.describe(), {
        clientModule: join(process.cwd(), 'packages/sdk/dist/index.js').replace(/\.js$/, '.js'),
      }),
      'utf8',
    )

    writeFileSync(
      join(directory, 'tsconfig.json'),
      JSON.stringify({
        compilerOptions: {
          strict: true,
          noEmit: true,
          module: 'nodenext',
          moduleResolution: 'nodenext',
          target: 'es2023',
          lib: ['es2023', 'dom'],
          skipLibCheck: true,
          types: [],
        },
        include: ['client.ts'],
      }),
      'utf8',
    )

    // No assertion needed beyond "it did not throw": tsc exits non-zero on an error.
    execFileSync(join(process.cwd(), 'node_modules/.bin/tsc'), ['-p', directory], {
      encoding: 'utf8',
      stdio: 'pipe',
    })
  }, 60_000)
})

describe('generated REST CRUD (SPEC.md §43)', () => {
  it('creates, reads, updates and deletes over HTTP', async () => {
    const created = await create({ title: 'Ada writes', status: 'draft' })

    expect(created.statusCode).toBe(201)

    const id = created.json<{ id: string }>().id

    const listed = await server.inject({ method: 'GET', url: '/api/articles' })
    expect(listed.json<{ total: number }>().total).toBe(1)

    const read = await server.inject({ method: 'GET', url: `/api/articles/${id}` })
    expect(read.json<{ title: string }>().title).toBe('Ada writes')

    const updated = await server.inject({
      method: 'PATCH',
      url: `/api/articles/${id}`,
      payload: { status: 'published' },
    })
    expect(updated.statusCode).toBe(200)

    const removed = await server.inject({ method: 'DELETE', url: `/api/articles/${id}` })
    expect(removed.statusCode).toBe(200)

    expect(
      (await server.inject({ method: 'GET', url: '/api/articles' })).json<{ total: number }>()
        .total,
    ).toBe(0)
  })

  it('filters, searches, sorts and paginates from the query string', async () => {
    await create({ title: 'Ada writes', status: 'published', views: 500 })
    await create({ title: 'Alan thinks', status: 'draft', views: 50 })
    await create({ title: 'Grace compiles', status: 'published', views: 200 })

    const published = await server.inject({ method: 'GET', url: '/api/articles?status=published' })
    expect(published.json<{ total: number }>().total).toBe(2)

    const searched = await server.inject({ method: 'GET', url: '/api/articles?search=Grace' })
    expect(searched.json<{ data: { title: string }[] }>().data[0]?.title).toBe('Grace compiles')

    const sorted = await server.inject({
      method: 'GET',
      url: '/api/articles?sort=views&perPage=10',
    })
    expect(sorted.json<{ data: { views: number }[] }>().data.map((entry) => entry.views)).toEqual([
      50, 200, 500,
    ])

    const paged = await server.inject({ method: 'GET', url: '/api/articles?perPage=2&page=2' })
    expect(paged.json<{ page: number; lastPage: number }>()).toMatchObject({ page: 2, lastPage: 2 })
  })

  it('answers a bad payload with the validation shape of SPEC.md §84', async () => {
    const response = await create({ status: 'nonsense' })

    expect(response.statusCode).toBe(422)
    expect(response.json()).toMatchObject({
      error: {
        code: 'VALIDATION_ERROR',
        fields: {
          title: ['This field is required'],
          status: ['Expected one of: draft, published'],
        },
      },
    })
  })

  it('never serves a hidden field', async () => {
    const created = await create({ title: 'Ada writes', status: 'draft' })
    const id = created.json<{ id: string }>().id

    const read = await server.inject({ method: 'GET', url: `/api/articles/${id}` })

    expect(read.body).not.toContain('secretNote')
  })

  it('answers 404 for an entry that is not there', async () => {
    const response = await server.inject({
      method: 'GET',
      url: '/api/articles/3f2504e0-4f89-41d3-9a0c-0305e82c3301',
    })

    expect(response.statusCode).toBe(404)
    expect(response.json()).toMatchObject({ error: { code: 'ENTRY_NOT_FOUND' } })
  })
})
