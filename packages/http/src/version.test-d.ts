import { createApplication, createLogger, permitAll, silentWriter } from '@assemora/core'
import { string } from '@assemora/schema'
import { describe, expectTypeOf, it } from 'vitest'

import { route } from './route.js'
import { createHttpServer, type HttpServer } from './server.js'
import type { ApiVersion, NamedResource } from './version.js'

const application = createApplication({
  authorization: permitAll(),
  logger: createLogger(silentWriter),
})

const server = createHttpServer({
  registry: application.registry,
  commands: application.commands,
  queries: application.queries,
  logger: application.logger,
})

/**
 * A resource as `api.resource()` sees one.
 *
 * The real thing comes from `@assemora/resources`, which this package may not depend
 * on (SPEC.md §8) — and does not have to, because a name is the whole address of the
 * description the registry already holds.
 */
const Articles = { name: 'articles', label: 'Articles' }

const search = route.get('/search', {
  query: { q: string() },
  response: { hits: string() },
  handler: ({ query }) => ({ hits: query.q }),
})

describe('the shape of a version (SPEC.md §47)', () => {
  it('chains off the server and answers with the server', () => {
    expectTypeOf(
      server.version('v1', (api) => {
        api.resource(Articles)
        api.mount(search)
      }),
    ).toEqualTypeOf<HttpServer>()
  })

  it('chains inside the version too', () => {
    server.version('v1', (api) => {
      expectTypeOf(api.resource(Articles)).toEqualTypeOf<ApiVersion>()
      expectTypeOf(api.mount(search)).toEqualTypeOf<ApiVersion>()
    })
  })

  it('takes a resource structurally, name and nothing more', () => {
    expectTypeOf(Articles).toMatchTypeOf<NamedResource>()
  })
})

describe('what a version will not let you write', () => {
  it('publishes routes and resources, and nothing else', () => {
    server.version('v1', (api) => {
      // @ts-expect-error a command belongs to the application, not to a shape of its
      // REST surface, so there is no versioned copy of it (SPEC.md §14)
      api.mountCommands()
      // @ts-expect-error the same is true of a query
      api.mountQueries()
      // @ts-expect-error `mountResources()` publishes everything; a version names what
      // it publishes
      api.mountResources()
      // @ts-expect-error a stylesheet is not an endpoint, and never a versioned one
      api.mountAssets({ directory: 'public', path: '/studio' })
    })
  })

  it('does not nest', () => {
    server.version('v1', (api) => {
      // @ts-expect-error `/v2/v1/articles` is not a path anybody means
      api.version('v2', () => {})
    })
  })

  it('needs a name on the resource it publishes', () => {
    server.version('v1', (api) => {
      // @ts-expect-error a resource is addressed by the name it registered under
      api.resource({})
      // @ts-expect-error and that name is a string
      api.resource({ name: 1 })
    })
  })

  it('mounts route declarations, not paths', () => {
    server.version('v1', (api) => {
      // @ts-expect-error a path is not a route: a route says what it validates and returns
      api.mount('/articles')
    })
  })
})

describe('a version is declared synchronously (SPEC.md §47)', () => {
  it('refuses an async callback, which would publish nothing at all', () => {
    // @ts-expect-error `=> void` accepts any return, so this used to compile and then
    // collect an empty array: everything after the first await runs once the version
    // has already been mounted
    server.version('v1', async (api) => {
      await Promise.resolve()
      api.resource(Articles)
    })
  })

  it('still accepts the chain a concise callback answers with', () => {
    expectTypeOf(server.version('v1', (api) => api.resource(Articles))).toEqualTypeOf<HttpServer>()
  })
})

describe('naming the endpoints a version publishes', () => {
  it('takes the five generated operations by name', () => {
    server.version('v2', (api) => {
      expectTypeOf(api.resource(Articles, { except: ['list'] })).toEqualTypeOf<ApiVersion>()
      expectTypeOf(api.resource(Articles, { only: ['get', 'delete'] })).toEqualTypeOf<ApiVersion>()
    })
  })

  it('refuses an operation that is not one of them', () => {
    server.version('v2', (api) => {
      // @ts-expect-error there is no `patch` endpoint; the update one is called `update`
      api.resource(Articles, { except: ['patch'] })
    })
  })
})
