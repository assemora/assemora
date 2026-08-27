/**
 * What a version costs this package, which is nothing (SPEC.md §47, §48).
 *
 * A versioned route reaches the generator as an ordinary route whose path opens with
 * `v1`, so two versions of one resource become two methods that differ by name. And a
 * client that wants one version points its base URL at it — a version is a path prefix
 * on the server and a base URL to a caller, which is why nothing here changed.
 *
 * The snapshot is the real one. A hand-typed fixture with `/v1/...` already in its
 * paths exercises `generateSdk` and never the versioning, so this file builds the
 * application, declares the versions through `@assemora/http`, and generates from the
 * Schema Registry the way `assemora sdk:generate` does (SPEC.md §98, §121).
 * `@assemora/http` is a *test* dependency here; the generator itself still depends on
 * nothing but `@assemora/schema`, which is what keeps it safe in a browser bundle — and
 * this package has no Node types at all, which is why the proof that a versioned SDK
 * *compiles* lives in `@assemora/assemora`'s own version test rather than here.
 */
import {
  command,
  createApplication,
  createLogger,
  permitAll,
  query,
  type SchemaRegistry,
  silentWriter,
} from '@assemora/core'
import { clearRouteRegistry, createHttpServer, route } from '@assemora/http'
import { number, string } from '@assemora/schema'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createClient } from './client.js'
import { generateSdk } from './generate.js'

/**
 * A resource as both readers of the `resources` section see one.
 *
 * `@assemora/http` reads `name`, `label` and `api` to generate CRUD; the SDK generator
 * reads `name` and `fields` to emit the record type. One description, two readers —
 * which is the point of the Schema Registry (SPEC.md §42).
 */
const Articles = {
  name: 'articles',
  label: 'Articles',
  api: { create: true, read: true, update: true, delete: true },
  fields: [
    { name: 'title', required: true, schema: { type: 'string' } },
    { name: 'views', required: false, schema: { type: 'number' } },
  ],
}

const listArticlesV2 = route.get('/articles', {
  description: 'Lists Articles, the v2 way',
  response: { people: string(), total: number() },
  handler: () => ({ people: 'the second shape', total: 0 }),
})

const withResources = (registry: SchemaRegistry): SchemaRegistry => ({
  ...registry,
  describe: () => ({ ...registry.describe(), resources: [Articles] }),
})

/** Two versions of one resource, declared the way SPEC.md §47 writes them. */
const twoVersions = (): SchemaRegistry => {
  const application = createApplication({
    modules: [],
    authorization: permitAll(),
    logger: createLogger(silentWriter),
  })

  // The generated CRUD calls these; nothing here sends a request, but the buses have to
  // hold the handlers the routes were generated around.
  application.commands.register(
    command('entries.create', { input: { resource: string() }, handle: async () => null }),
  )
  application.queries.register(
    query('entries.list', { input: { resource: string() }, handle: async () => null }),
  )

  const registry = withResources(application.registry)

  createHttpServer({
    registry,
    commands: application.commands,
    queries: application.queries,
    logger: application.logger,
  })
    .version('v1', (api) => {
      api.resource(Articles)
    })
    .version('v2', (api) => {
      api.resource(Articles, { except: ['list'] }).mount(listArticlesV2)
    })

  return registry
}

beforeEach(() => {
  clearRouteRegistry()
})

describe('the generated SDK can call every version', () => {
  it('names one method per version', () => {
    const source = generateSdk(twoVersions().describe())

    expect(source).toContain('getV1Articles(input: {')
    expect(source).toContain('getV2Articles(): Promise<{')
    expect(source).toContain('getV1ArticlesById(input: {')
    expect(source).toContain('getV2ArticlesById(input: {')
  })

  it('carries each version’s own answer into its own return type', () => {
    const source = generateSdk(twoVersions().describe())

    // v2 replaced the generated listing with a route of its own, and the SDK says so.
    expect(source).toMatch(/getV2Articles\(\): Promise<\{\s+readonly people: string/)
    expect(source).toMatch(/getV1Articles\(input: \{[\s\S]*?readonly lastPage: number/)
  })

  it('still emits the record type once, because a version is not a second resource', () => {
    const source = generateSdk(twoVersions().describe())

    expect(source.match(/export type Articles = \{/g)).toHaveLength(1)
    expect(source).toContain('readonly articles: ResourceClient<Articles>')
  })
})

describe('a version is a base URL to a caller', () => {
  it('reaches the versioned resource with no change to the client', async () => {
    const calls: string[] = []

    const fetch = vi.fn(async (url: string | URL | Request) => {
      calls.push(String(url))

      return new Response(
        JSON.stringify({ data: [], total: 0, page: 1, perPage: 20, lastPage: 1 }),
        {
          status: 200,
          headers: { 'content-type': 'application/json' },
        },
      )
    }) as unknown as typeof globalThis.fetch

    const api = createClient({ url: 'https://api.example/api/v1', fetch })

    await api.resource('articles').list()

    expect(calls[0]).toBe('https://api.example/api/v1/articles')
  })
})

/** Kept honest: the snapshot really did come from the versioning, not from a fixture. */
describe('the snapshot under test', () => {
  it('is the Schema Registry of a two-version application', () => {
    const routes = twoVersions()
      .section('routes')
      .map((descriptor) => descriptor.name)

    expect(routes).toEqual(
      expect.arrayContaining(['get /v1/articles', 'get /v2/articles', 'delete /v2/articles/:id']),
    )
    expect(routes).not.toContain('get /articles')
  })
})
