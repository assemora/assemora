import {
  command,
  createApplication,
  createLogger,
  type ModuleBuilder,
  module,
  permitAll,
  query,
  type SchemaRegistry,
  silentWriter,
} from '@assemora/core'
import { json, string } from '@assemora/schema'
import { beforeEach, describe, expect, it } from 'vitest'

import type { CrudResource } from './crud.js'
import { clearRouteRegistry } from './module.js'
import { route } from './route.js'
import { createHttpServer } from './server.js'
import { versionedRoute, versionRoutes } from './version.js'

const Articles: CrudResource = {
  name: 'articles',
  label: 'Articles',
  api: { create: true, read: true, update: false, delete: false },
}

/** All five endpoints, for the version that wants four of them and one of its own. */
const Authors: CrudResource = {
  name: 'authors',
  label: 'Authors',
  api: { create: true, read: true, update: true, delete: true },
}

/** A resource that publishes no REST at all (SPEC.md §43). */
const Locked: CrudResource = {
  name: 'locked',
  label: 'Locked',
  api: { create: false, read: false, update: false, delete: false },
}

const stored = new Map<string, { id: string; title: string }[]>()

const List = query('entries.list', {
  input: { resource: string() },
  handle: async ({ resource }) => {
    const rows = stored.get(resource) ?? []

    return { data: rows, total: rows.length, page: 1, perPage: 20, lastPage: 1 }
  },
})

const Get = query('entries.get', {
  input: { resource: string(), id: string() },
  handle: async ({ resource, id }) =>
    (stored.get(resource) ?? []).find((row) => row.id === id) ?? null,
})

const Create = command('entries.create', {
  input: { resource: string(), data: json<{ title: string }>() },
  handle: async ({ resource, data }) => {
    const rows = stored.get(resource) ?? []
    const created = { id: `a${rows.length + 1}`, title: data.title }

    stored.set(resource, [...rows, created])

    return created
  },
})

/**
 * The registry as it is once a resource has described itself.
 *
 * `resources` is a section `@assemora/resources` declares, and this package may not
 * depend on it (SPEC.md §8) — so the test supplies the description the way
 * `crudResources` reads it back: off the snapshot, whoever put it there.
 */
const withResources = (
  registry: SchemaRegistry,
  resources: readonly CrudResource[],
): SchemaRegistry => ({
  ...registry,
  describe: () => ({ ...registry.describe(), resources }),
})

const build = (
  resources: readonly CrudResource[] = [Articles],
  modules: readonly ModuleBuilder[] = [],
) => {
  const application = createApplication({
    modules: [module('entries').queries(List, Get).commands(Create), ...modules],
    authorization: permitAll(),
    logger: createLogger(silentWriter),
  })

  return {
    application,
    server: createHttpServer({
      registry: withResources(application.registry, resources),
      commands: application.commands,
      queries: application.queries,
      logger: application.logger,
    }),
  }
}

const summary = (body: string) =>
  route.get('/summary', {
    response: { of: string() },
    handler: () => ({ of: body }),
  })

beforeEach(() => {
  clearRouteRegistry()
  stored.clear()
})

describe('a version publishes a resource under its own path (SPEC.md §47)', () => {
  it('answers at /api/v1/articles, and not at /api/articles', async () => {
    const { server } = build()

    server.version('v1', (api) => {
      api.resource(Articles)
    })

    await server.ready()

    const versioned = await server.inject({ method: 'GET', url: '/api/v1/articles' })
    const bare = await server.inject({ method: 'GET', url: '/api/articles' })

    expect(versioned.statusCode).toBe(200)
    expect(versioned.json<{ total: number }>().total).toBe(0)
    expect(bare.statusCode).toBe(404)
  })

  it('carries the whole generated surface into the version', async () => {
    const { server } = build()

    server.version('v1', (api) => {
      api.resource(Articles)
    })

    await server.ready()

    const created = await server.inject({
      method: 'POST',
      url: '/api/v1/articles',
      payload: { title: 'Ada writes' },
    })

    expect(created.statusCode).toBe(201)

    const read = await server.inject({ method: 'GET', url: '/api/v1/articles/a1' })

    expect(read.json<{ title: string }>().title).toBe('Ada writes')
  })

  it('mounts an ordinary route inside a version too', async () => {
    const { server } = build()

    server.version('v1', (api) => {
      api.mount(summary('one'))
    })

    await server.ready()

    const response = await server.inject({ method: 'GET', url: '/api/v1/summary' })

    expect(response.json()).toEqual({ of: 'one' })
  })

  it('names the version on the descriptor, so a reader need not parse the path', () => {
    const { application, server } = build()

    server.version('v1', (api) => {
      api.resource(Articles)
    })

    expect(application.registry.find('routes', 'get /v1/articles')).toMatchObject({
      method: 'get',
      path: '/v1/articles',
      version: 'v1',
      tags: ['articles'],
    })
  })
})

describe('two versions of one resource coexist', () => {
  it('routes each independently', async () => {
    const { server } = build()

    server
      .version('v1', (api) => {
        api.resource(Articles).mount(summary('the first shape'))
      })
      .version('v2', (api) => {
        api.resource(Articles).mount(summary('the second shape'))
      })

    await server.ready()

    const first = await server.inject({ method: 'GET', url: '/api/v1/summary' })
    const second = await server.inject({ method: 'GET', url: '/api/v2/summary' })

    expect(first.json()).toEqual({ of: 'the first shape' })
    expect(second.json()).toEqual({ of: 'the second shape' })
  })

  it('describes both, because the version is part of the name the registry keys on', () => {
    const { application, server } = build()

    server
      .version('v1', (api) => {
        api.resource(Articles)
      })
      .version('v2', (api) => {
        api.resource(Articles)
      })

    expect(application.registry.find('routes', 'get /v1/articles')?.version).toBe('v1')
    expect(application.registry.find('routes', 'get /v2/articles')?.version).toBe('v2')
  })

  it('does not answer a version it was never published in', async () => {
    const { server } = build()

    server
      .version('v1', (api) => {
        api.mount(summary('only here'))
      })
      .version('v2', (api) => {
        api.resource(Articles)
      })

    await server.ready()

    const response = await server.inject({ method: 'GET', url: '/api/v2/summary' })

    expect(response.statusCode).toBe(404)
  })

  it('leaves the declaration itself unversioned, so one route can serve both', async () => {
    const shared = summary('shared')
    const { server } = build()

    server
      .version('v1', (api) => {
        api.mount(shared)
      })
      .version('v2', (api) => {
        api.mount(shared)
      })

    await server.ready()

    expect(shared.version).toBeUndefined()
    expect((await server.inject({ method: 'GET', url: '/api/v1/summary' })).statusCode).toBe(200)
    expect((await server.inject({ method: 'GET', url: '/api/v2/summary' })).statusCode).toBe(200)
  })
})

describe('a version is a namespace, not a declaration', () => {
  it('may be opened more than once', async () => {
    const { server } = build()

    server
      .version('v1', (api) => {
        api.resource(Articles)
      })
      .version('v1', (api) => {
        api.mount(summary('added later'))
      })

    await server.ready()

    expect((await server.inject({ method: 'GET', url: '/api/v1/articles' })).statusCode).toBe(200)
    expect((await server.inject({ method: 'GET', url: '/api/v1/summary' })).json()).toEqual({
      of: 'added later',
    })
  })

  it('still refuses to publish one path twice inside it', () => {
    const { server } = build()

    // What makes reopening a version safe: the mistake a stricter rule would have
    // caught — the same endpoint published twice — is caught regardless, and now where
    // it was written rather than as a Fastify string at `ready()`.
    expect(() =>
      server.version('v1', (api) => {
        api.resource(Articles).resource(Articles)
      }),
    ).toThrow(/Version v1 publishes "get \/v1\/articles" twice/)
  })
})

describe('an application that never versions does not change', () => {
  it('mounts unversioned CRUD exactly where it always did, and says no version', async () => {
    const { application, server } = build()

    server.mountResources()
    await server.ready()

    expect((await server.inject({ method: 'GET', url: '/api/articles' })).statusCode).toBe(200)
    expect(application.registry.find('routes', 'get /articles')).not.toHaveProperty('version')
  })
})

describe('what a version refuses', () => {
  it('refuses a name that is not one path segment', () => {
    const { server } = build()

    for (const name of ['', '../', 'v1/beta', '/v1', '.', 'v 1', '..', 'a..', 'v1..', 'v1.']) {
      expect(() => server.version(name, () => {})).toThrow(/is not an API version/)
    }
  })

  it('accepts the names a version is actually given', () => {
    const { server } = build()

    for (const name of ['v1', 'v2', 'beta', '2024-01-01', 'v1.1', 'v1_1', '1']) {
      expect(() =>
        server.version(name, (api) => {
          api.mount(summary(name))
        }),
      ).not.toThrow()
    }
  })

  it('refuses a resource nothing describes, rather than publishing nothing for it', () => {
    const { server } = build()

    expect(() =>
      server.version('v1', (api) => {
        api.resource({ name: 'authors' })
      }),
    ).toThrow(/No resource named "authors" is registered/)
  })

  it('refuses to publish one route under two versions at once', () => {
    expect(() => versionedRoute(versionedRoute(summary('x'), 'v1'), 'v2')).toThrow(
      /already published as version v1/,
    )
  })
})

describe('versionRoutes on its own', () => {
  const buses = {
    commands: { execute: async () => null } as never,
    queries: { execute: async () => null } as never,
  }

  it('rewrites every generated path and answers with plain routes', () => {
    const routes = versionRoutes({ name: 'v1', resources: [Articles], buses }, (api) => {
      api.resource(Articles)
    })

    expect(routes.map((definition) => `${definition.method} ${definition.path}`)).toEqual([
      'get /v1/articles',
      'get /v1/articles/:id',
      'post /v1/articles',
    ])
    expect(routes.every((definition) => definition.version === 'v1')).toBe(true)
  })
})

describe('a version and the routes a module declared (SPEC.md §13, §47)', () => {
  /** `/search`, declared the documented way and registered on a module. */
  const search = route.get('/search', {
    description: 'Searches the archive',
    query: { q: string() },
    response: { hits: string() },
    handler: ({ query }) => ({ hits: query.q }),
  })

  it('refuses to start when a version leaves the module’s own address unserved', async () => {
    const { server } = build([Articles], [module('blog').routes(search)])

    // The mistake this catches: `/search` was described when the application was
    // created, `version()` published a copy at `/v1/search`, and nothing mounted the
    // original — so `/api/search` was in OpenAPI, in the API Explorer and in the
    // generated SDK, and answered 404 (SPEC.md §98, §121).
    server.version('v1', (api) => {
      api.mount(search)
    })

    await expect(server.ready()).rejects.toThrow(
      /describes a route this server does not serve.*get \/search/s,
    )
  })

  it('publishes them under the version beside the address their declaration gave them', async () => {
    const { server } = build([Articles], [module('blog').routes(search)])

    server.mountRegistered().version('v1', (api) => {
      api.mountRegistered()
    })

    await server.ready()

    const bare = await server.inject({ method: 'GET', url: '/api/search?q=ada' })
    const versioned = await server.inject({ method: 'GET', url: '/api/v1/search?q=ada' })

    expect(bare.json()).toEqual({ hits: 'ada' })
    expect(versioned.json()).toEqual({ hits: 'ada' })
  })

  it('names the version on the copy and leaves the declaration’s own description alone', () => {
    const { application, server } = build([Articles], [module('blog').routes(search)])

    server.mountRegistered().version('v1', (api) => {
      api.mountRegistered()
    })

    expect(application.registry.find('routes', 'get /search')).toMatchObject({
      module: 'blog',
      description: 'Searches the archive',
    })
    expect(application.registry.find('routes', 'get /search')).not.toHaveProperty('version')
    expect(application.registry.find('routes', 'get /v1/search')?.version).toBe('v1')
  })

  it('refuses to serve one declaration where another is already described', () => {
    const { server } = build([Articles], [module('blog').routes(search)])
    const impostor = route.get('/search', {
      description: 'Something else entirely',
      response: { hits: string() },
      handler: () => ({ hits: '' }),
    })

    // The registry keeps one entry per name, so without this the document would carry
    // the module's description and the server would answer with this handler.
    expect(() => server.mount(impostor)).toThrow(
      /already described in the Schema Registry by a different declaration, registered by module "blog"/,
    )
  })

  it('refuses to start when a described route was never mounted at all', async () => {
    const { server } = build([Articles], [module('blog').routes(search)])

    // Nothing to do with versions: a route described and not served is a documented
    // 404 whoever left it that way.
    await expect(server.ready()).rejects.toThrow(/get \/search/)
  })
})

describe('a version is declared synchronously', () => {
  it('refuses an async callback rather than publishing nothing', () => {
    const { application, server } = build()

    // TypeScript refuses this too (`version.test-d.ts`); the runtime check is what
    // catches the same callback arriving from JavaScript, or through an `any`.
    expect(() =>
      server.version('v1', (async (api: { resource: (r: CrudResource) => unknown }) => {
        await Promise.resolve()
        api.resource(Articles)
      }) as never),
    ).toThrow(/callback for version v1 is asynchronous/)

    expect(application.registry.find('routes', 'get /v1/articles')).toBeUndefined()
  })

  it('refuses an api kept past the callback that was given it', () => {
    const { server } = build()
    let escaped: { mount(...routes: never[]): unknown } | undefined

    server.version('v1', (api) => {
      escaped = api as never
      api.resource(Articles)
    })

    expect(() => escaped?.mount(summary('too late') as never)).toThrow(
      /api\.mount\(\) was called after version v1 was declared/,
    )
  })
})

describe('a version changes one endpoint of a resource', () => {
  const listAuthorsV2 = route.get('/authors', {
    description: 'Lists Authors, the v2 way',
    response: { people: string() },
    handler: () => ({ people: 'the second shape' }),
  })

  it('leaves the generated one out and mounts its own', async () => {
    const { server } = build([Authors])

    server
      .version('v1', (api) => {
        api.resource(Authors)
      })
      .version('v2', (api) => {
        api.resource(Authors, { except: ['list'] }).mount(listAuthorsV2)
      })

    await server.ready()

    const first = await server.inject({ method: 'GET', url: '/api/v1/authors' })
    const second = await server.inject({ method: 'GET', url: '/api/v2/authors' })

    expect(first.json<{ total: number }>().total).toBe(0)
    expect(second.json()).toEqual({ people: 'the second shape' })
    // The four it kept are still generated, so a version says what changed and nothing
    // more.
    expect((await server.inject({ method: 'GET', url: '/api/v2/authors/a1' })).statusCode).toBe(404)
  })

  it('describes the route that actually mounted, not the one it replaced', () => {
    const { application, server } = build([Authors])

    server.version('v2', (api) => {
      api.resource(Authors, { except: ['list'] }).mount(listAuthorsV2)
    })

    expect(application.registry.find('routes', 'get /v2/authors')?.description).toBe(
      'Lists Authors, the v2 way',
    )
  })

  it('publishes only what `only` names', () => {
    const { application, server } = build([Authors])

    server.version('v3', (api) => {
      api.resource(Authors, { only: ['get'] })
    })

    expect(application.registry.find('routes', 'get /v3/authors/:id')).toBeDefined()
    expect(application.registry.find('routes', 'get /v3/authors')).toBeUndefined()
  })

  it('says what to do when two declarations still want one address', () => {
    const { server } = build([Authors])

    expect(() =>
      server.version('v2', (api) => {
        api.resource(Authors).mount(listAuthorsV2)
      }),
    ).toThrow(/Version v2 publishes "get \/v2\/authors" twice.*except/s)
  })

  it('will not widen what the resource itself switched off', () => {
    const { application, server } = build([Articles])

    server.version('v1', (api) => {
      api.resource(Articles, { only: ['list', 'delete'] })
    })

    expect(application.registry.find('routes', 'get /v1/articles')).toBeDefined()
    expect(application.registry.find('routes', 'delete /v1/articles/:id')).toBeUndefined()
  })

  it('refuses "only" and "except" together', () => {
    const { server } = build([Authors])

    expect(() =>
      server.version('v2', (api) => {
        api.resource(Authors, { only: ['get'], except: ['list'] })
      }),
    ).toThrow(/both "only" and "except"/)
  })
})

describe('a version that would publish nothing', () => {
  it('refuses a resource whose REST is switched off', () => {
    const { server } = build([Locked])

    expect(() =>
      server.version('v1', (api) => {
        api.resource(Locked)
      }),
    ).toThrow(/publishes no REST endpoints of its own/)
  })

  it('refuses a filter that keeps none of the endpoints', () => {
    const { server } = build([Articles])

    expect(() =>
      server.version('v1', (api) => {
        api.resource(Articles, { except: ['list', 'get', 'create'] })
      }),
    ).toThrow(/publishes nothing: the resource offers list, get, create/)
  })
})
