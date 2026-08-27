/**
 * What a version costs this package, which is nothing (SPEC.md §47).
 *
 * `@assemora/http` rewrites a route's path before it is described, so a versioned
 * endpoint arrives here as an ordinary route whose path happens to open with `v1`.
 * These are the tests that would fail if that ever stopped being true and OpenAPI or
 * the API Explorer had to learn what a version is.
 *
 * The last one is the guarantee itself: every path this document publishes answers.
 * SPEC.md §98 and §121 make the document current *by construction*, and a version that
 * moved an address while the registry kept describing the old one inverted exactly
 * that — `/api/search` was in the document, in the API Explorer and in the generated
 * SDK, and answered 404.
 */
import {
  command,
  createApplication,
  createLogger,
  module,
  permitAll,
  query,
  type SchemaRegistry,
  silentWriter,
} from '@assemora/core'
import { type CrudResource, clearRouteRegistry, createHttpServer, route } from '@assemora/http'
import { json, string } from '@assemora/schema'
import { beforeEach, describe, expect, it } from 'vitest'

import { buildOpenApiDocument } from './document.js'
import { introspectionRoute, openApiRoute } from './route.js'

const Articles: CrudResource = {
  name: 'articles',
  label: 'Articles',
  api: { create: true, read: true, update: true, delete: true },
}

const search = route.get('/search', {
  description: 'Searches the archive',
  query: { q: string().optional() },
  response: { hits: string() },
  handler: ({ query: parameters }) => ({ hits: parameters.q ?? '' }),
})

/**
 * The `entries.*` handlers the generated CRUD calls, so every documented operation has
 * something real to answer with. Reads go to the Query Bus and writes to the Command
 * Bus exactly as they do in an application (ADR-0014).
 */
const entries = module('entries')
  .queries(
    query('entries.list', {
      input: { resource: string() },
      handle: async () => ({ data: [], total: 0, page: 1, perPage: 20, lastPage: 1 }),
    }),
    query('entries.get', {
      input: { resource: string(), id: string() },
      handle: async ({ id }) => ({ id, title: 'Ada writes' }),
    }),
  )
  .commands(
    command('entries.create', {
      input: { resource: string(), data: json<unknown>() },
      handle: async () => ({ id: 'a1' }),
    }),
    command('entries.update', {
      input: { resource: string(), id: string(), data: json<unknown>() },
      handle: async ({ id }) => ({ id }),
    }),
    command('entries.delete', {
      input: { resource: string(), id: string() },
      handle: async ({ id }) => ({ id }),
    }),
  )

/** The registry as it is once a resource has described itself into it (SPEC.md §42). */
const withResources = (
  registry: SchemaRegistry,
  resources: readonly CrudResource[],
): SchemaRegistry => ({
  ...registry,
  describe: () => ({ ...registry.describe(), resources }),
})

const build = (modules: readonly ReturnType<typeof module>[] = []) => {
  const application = createApplication({
    modules: [entries, ...modules],
    authorization: permitAll(),
    logger: createLogger(silentWriter),
  })

  const registry = withResources(application.registry, [Articles])

  return {
    registry,
    server: createHttpServer({
      registry,
      commands: application.commands,
      queries: application.queries,
      logger: application.logger,
    }),
  }
}

beforeEach(() => {
  clearRouteRegistry()
})

type Operation = { operationId?: string; summary?: string }
type Document = { paths: Record<string, Record<string, Operation>> }

const documentOf = (registry: SchemaRegistry): Document =>
  buildOpenApiDocument(registry, { title: 'Assemora', version: '1.0.0' }) as Document

describe('the OpenAPI document shows the versioned paths', () => {
  it('publishes each version at its own path, and nothing at the bare one', () => {
    const { registry, server } = build()

    server
      .version('v1', (api) => {
        api.resource(Articles)
      })
      .version('v2', (api) => {
        api.resource(Articles)
      })

    const paths = Object.keys(documentOf(registry).paths)

    expect(paths).toEqual(
      expect.arrayContaining([
        '/api/v1/articles',
        '/api/v1/articles/{id}',
        '/api/v2/articles',
        '/api/v2/articles/{id}',
      ]),
    )
    expect(paths).not.toContain('/api/articles')
  })

  it('gives the two versions operations a client can tell apart', () => {
    const { registry, server } = build()

    server
      .version('v1', (api) => {
        api.resource(Articles).mount(search)
      })
      .version('v2', (api) => {
        api.resource(Articles)
      })

    const { paths } = documentOf(registry)

    expect(paths['/api/v1/articles']?.get?.operationId).toBe('get_v1_articles')
    expect(paths['/api/v2/articles']?.get?.operationId).toBe('get_v2_articles')
    expect(paths['/api/v1/search']?.get?.summary).toBe('Searches the archive')
  })
})

describe('the API Explorer shows them too (SPEC.md §45)', () => {
  it('lists the versioned routes and says which version each belongs to', async () => {
    const { registry, server } = build()

    server
      .version('v1', (api) => {
        api.resource(Articles)
      })
      .mount(introspectionRoute(registry, { public: true }))

    await server.ready()

    const response = await server.inject({ method: 'GET', url: '/api/_introspection' })
    const routes = response.json<{ routes?: { name: string; version?: string }[] }>().routes ?? []

    expect(routes.map((entry) => entry.name)).toEqual(
      expect.arrayContaining(['get /v1/articles', 'delete /v1/articles/:id']),
    )
    expect(routes.find((entry) => entry.name === 'get /v1/articles')?.version).toBe('v1')
    expect(routes.find((entry) => entry.name === 'get /_introspection')?.version).toBeUndefined()
  })
})

describe('every path the document publishes answers (SPEC.md §98, §121)', () => {
  /** `/api/v1/articles/{id}` is a template; a request needs a value in it. */
  const addressOf = (path: string): string => path.replace(/\{[^}]+\}/g, 'a1')

  const everyOperation = async (
    server: ReturnType<typeof createHttpServer>,
    document: Document,
  ): Promise<{ address: string; status: number }[]> => {
    const answers: { address: string; status: number }[] = []

    for (const [path, operations] of Object.entries(document.paths)) {
      for (const method of Object.keys(operations)) {
        const response = await server.inject({
          method: method.toUpperCase(),
          url: addressOf(path),
          payload: method === 'get' || method === 'delete' ? undefined : {},
        })

        answers.push({
          address: `${method.toUpperCase()} ${addressOf(path)}`,
          status: response.statusCode,
        })
      }
    }

    return answers
  }

  it('answers on every documented address of a versioned application', async () => {
    const { registry, server } = build([module('blog').routes(search)])

    server
      .mountRegistered()
      .version('v1', (api) => {
        api.resource(Articles).mountRegistered()
      })
      .mount(
        openApiRoute({ registry, info: { title: 'Assemora', version: '1.0.0' } }),
        introspectionRoute(registry, { public: true }),
      )

    await server.ready()

    const answers = await everyOperation(server, documentOf(registry))

    // Every one of them, not a sample: a single documented 404 is the whole failure.
    expect(answers.length).toBeGreaterThan(8)
    expect(answers.filter((answer) => answer.status >= 400)).toEqual([])
  })

  it('refuses to start rather than document an address it does not serve', async () => {
    const { server } = build([module('blog').routes(search)])

    // `/search` was described the moment the application was created (SPEC.md §13).
    // Publishing a copy of it under a version does not withdraw that description, so a
    // server that serves only the copy is a server whose document lies.
    server.version('v1', (api) => {
      api.mount(search)
    })

    await expect(server.ready()).rejects.toThrow(/get \/search/)
  })
})
