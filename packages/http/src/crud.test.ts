/**
 * A resource that arrives after the server is listening (SPEC.md §37, §43).
 *
 * `mountResources()` generates five endpoints per resource, and it can only do that for
 * the resources it can see: Fastify takes no route once the instance is ready, and a
 * collection is a row somebody creates in Studio while the process serves. So the same
 * five endpoints are generated once more, parameterised by name, and everything below is
 * about what that pair may and may not answer — because it sits under every unclaimed
 * one- and two-segment address of the API.
 */
import {
  command,
  createApplication,
  createLogger,
  generatedCrudPrefix,
  type LogRecord,
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
import { describeRoute, route } from './route.js'
import { createHttpServer } from './server.js'

/** Declared in TypeScript: it has endpoints of its own from the first mount. */
const Articles: CrudResource = {
  name: 'articles',
  label: 'Articles',
  api: { create: true, read: true, update: true, delete: false },
}

/** The collection, which nothing knows about until somebody makes it. */
const Testimonials: CrudResource = {
  name: 'testimonials',
  label: 'Testimonials',
  api: { create: true, read: true, update: true, delete: true },
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
    const created = { id: `e${rows.length + 1}`, title: data.title }

    stored.set(resource, [...rows, created])

    return created
  },
})

const Delete = command('entries.delete', {
  input: { resource: string(), id: string() },
  handle: async ({ resource, id }) => {
    stored.set(
      resource,
      (stored.get(resource) ?? []).filter((row) => row.id !== id),
    )

    return { id }
  },
})

/**
 * The `resources` section, written the way `@assemora/resources` writes it.
 *
 * That section is declared by a package this one may not depend on (SPEC.md §8), so its
 * name is not in `RegistrySections` here and `crudResources` reads it back off
 * `describe()`, whoever put it there. The writes still have to be the registry's own:
 * registering is what *announces* the change, and this server keeps its descriptions
 * level by listening for it. An array behind a stubbed `describe()` moves what the
 * server would answer and tells it nothing — which is the whole difference between a
 * test that exercises the reconciliation and one that only exercises `settled()`.
 */
const resourceSection = (registry: SchemaRegistry) =>
  registry as unknown as {
    register(section: 'resources', entry: CrudResource): void
    withdraw(section: 'resources', name: string): boolean
  }

/** A collection somebody just made. */
const arrives = (registry: SchemaRegistry, resource: CrudResource): void => {
  resourceSection(registry).register('resources', resource)
}

/** A collection somebody just deleted. */
const leaves = (registry: SchemaRegistry, name: string): void => {
  resourceSection(registry).withdraw('resources', name)
}

/** A collection somebody just changed: two writes, exactly as `collections.update` makes them. */
const changes = (registry: SchemaRegistry, resource: CrudResource): void => {
  leaves(registry, resource.name)
  arrives(registry, resource)
}

let records: LogRecord[] = []

/** Every request line this server wrote, in order (SPEC.md §88). */
const lines = () => records.filter((record) => record.message === 'Request completed')

const application = () =>
  createApplication({
    modules: [module('entries').queries(List, Get).commands(Create, Delete)],
    authorization: permitAll(),
    logger: createLogger(silentWriter),
  })

const build = (resources: readonly CrudResource[], prefix?: string) => {
  const built = application()

  for (const resource of resources) arrives(built.registry, resource)

  return {
    registry: built.registry,
    server: createHttpServer({
      registry: built.registry,
      commands: built.commands,
      queries: built.queries,
      logger: createLogger((record) => records.push(record)),
      ...(prefix === undefined ? {} : { prefix }),
    }),
  }
}

/**
 * A server reading its resources through somebody else's `describe()`, so the array can
 * be edited in place — a section that moves without announcing that it did.
 *
 * The one test below is what this is for; everything else registers for real.
 */
const buildOverMovingSection = (resources: CrudResource[]) => {
  const built = application()

  return {
    registry: built.registry,
    server: createHttpServer({
      registry: {
        ...built.registry,
        describe: () => ({ ...built.registry.describe(), resources }),
      },
      commands: built.commands,
      queries: built.queries,
      logger: createLogger((record) => records.push(record)),
    }),
  }
}

beforeEach(() => {
  clearRouteRegistry()
  stored.clear()
  records = []
})

describe('a resource registered after the server was built', () => {
  it('answers at its own REST paths without a restart', async () => {
    const { registry, server } = build([Articles])

    server.mountResources()
    await server.ready()

    expect((await server.inject({ method: 'GET', url: '/api/testimonials' })).statusCode).toBe(404)

    arrives(registry, Testimonials)

    const listed = await server.inject({ method: 'GET', url: '/api/testimonials' })

    expect(listed.statusCode).toBe(200)
    expect(listed.json<{ total: number }>().total).toBe(0)

    const created = await server.inject({
      method: 'POST',
      url: '/api/testimonials',
      payload: { title: 'It works' },
    })

    expect(created.statusCode).toBe(201)

    const one = await server.inject({ method: 'GET', url: '/api/testimonials/e1' })

    expect(one.json<{ title: string }>().title).toBe('It works')

    expect(
      (await server.inject({ method: 'DELETE', url: '/api/testimonials/e1' })).statusCode,
    ).toBe(200)
  })

  it('is described at those paths, so OpenAPI and the SDK publish them too', async () => {
    const { registry, server } = build([Articles])

    server.mountResources()
    await server.ready()

    arrives(registry, Testimonials)

    // Any request is the moment the description catches up: a resource arrives between
    // two requests and there is nothing else between them.
    await server.inject({ method: 'GET', url: '/api/testimonials' })

    expect(registry.section('routes').map((entry) => entry.name)).toEqual(
      expect.arrayContaining([
        'get /testimonials',
        'get /testimonials/:id',
        'post /testimonials',
        'patch /testimonials/:id',
        'delete /testimonials/:id',
      ]),
    )
  })

  it('takes those descriptions back when the resource goes away', async () => {
    const { registry, server } = build([Articles])

    server.mountResources()
    await server.ready()

    arrives(registry, Testimonials)

    expect((await server.inject({ method: 'GET', url: '/api/testimonials' })).statusCode).toBe(200)

    leaves(registry, Testimonials.name)

    const gone = await server.inject({ method: 'GET', url: '/api/testimonials' })

    expect(gone.statusCode).toBe(404)
    expect(registry.find('routes', 'get /testimonials')).toBeUndefined()
    // The resource that stayed keeps everything it had.
    expect(registry.find('routes', 'get /articles')).toBeDefined()
  })

  it('does not put the endpoint that dispatches into the Schema Registry', async () => {
    const { registry, server } = build([Articles])

    server.mountResources()
    await server.ready()

    // `/api/{resource}` is not an address any caller means. Documenting it would put one
    // endpoint that says nothing in place of the five per resource that say everything.
    expect(registry.section('routes').map((entry) => entry.path)).not.toContain('/:resource')
  })
})

/**
 * The reconciliation runs when the registry changes, and only a socket proves it.
 *
 * `inject()` awaits `settled()`, which reconciles on its own — so every test above
 * reaches the reconciliation through a path a deployed process never takes: there,
 * `settled()` runs once inside `listen()` and nothing calls it again. What keeps the
 * document level with the server for the rest of that process's life is the registry
 * saying that a resource arrived. Gutting that subscription leaves the whole suite
 * green except for what is below.
 */
describe('a server that is actually listening (SPEC.md §37, §42)', () => {
  it('describes a resource the instant it is registered, with no request at all', async () => {
    const { registry, server } = build([Articles])

    server.mountResources()

    const address = await server.listen(0)

    try {
      arrives(registry, Testimonials)

      // Now, not by the time somebody asks. `assemora routes`, the API Explorer's own
      // snapshot and an SDK generated straight after `collections.create` all read the
      // registry without sending a request through this server, and used to read it a
      // request behind.
      expect(registry.find('routes', 'get /testimonials')).toBeDefined()
      expect((await fetch(`${address}/api/testimonials`)).status).toBe(200)

      leaves(registry, Testimonials.name)

      expect(registry.find('routes', 'get /testimonials')).toBeUndefined()
      expect((await fetch(`${address}/api/testimonials`)).status).toBe(404)
    } finally {
      await server.close()
    }
  })

  it('stops watching a registry it no longer serves', async () => {
    const { registry, server } = build([Articles])

    server.mountResources()

    await server.listen(0)
    await server.close()

    arrives(registry, Testimonials)

    // The registry usually outlives the server watching it — a test file builds several,
    // the CLI boots an application and never listens — and descriptions of addresses a
    // closed server would have answered on are exactly the ones `settled()` refuses to
    // start with.
    expect(registry.find('routes', 'get /testimonials')).toBeUndefined()
  })
})

/**
 * The gap check, once the dispatching pair is standing in for described addresses.
 *
 * One route may stand for many descriptions, so `undocumentedGap` has to tolerate a
 * resource that is described and not separately mounted — and only that. Tolerating
 * every gap on any server that ever called `mountResources()`, which is every Assemora
 * application, left the entire suite green.
 */
describe('what the server refuses to start with (SPEC.md §98, §121)', () => {
  const handWritten = (path: string, description: string) =>
    route.get(path, {
      description,
      response: { of: string() },
      handler: () => ({ of: 'hand-written' }),
    })

  it('refuses a described address the dispatching pair does not answer on', async () => {
    const { registry, server } = build([Articles])

    // A module described `/reports` with `.routes()` and nobody mounted it. The
    // parameterised pair sits under that address and refuses it, so the document would
    // publish an endpoint that answers 404.
    registry.register('routes', describeRoute(handWritten('/reports', 'Reports')))

    server.mountResources()

    await expect(server.ready()).rejects.toThrow(/does not serve.*get \/reports/s)
  })

  it('refuses a description at a resource’s address that is not the generated one', async () => {
    const { registry, server } = build([Articles])

    server.mountResources()
    await server.ready()

    // The address a collection is about to generate, described by hand and never
    // mounted. What would answer there is the generated listing, not this handler, so
    // the pair does not stand for this description however well the paths match.
    registry.register('routes', describeRoute(handWritten('/testimonials', 'Hand-written')))
    arrives(registry, Testimonials)

    await expect(server.ready()).rejects.toThrow(/does not serve.*get \/testimonials/s)
  })
})

describe('what the dispatching pair refuses', () => {
  it('refuses a name no resource answers to', async () => {
    const { server } = build([Articles])

    server.mountResources()
    await server.ready()

    const missing = await server.inject({ method: 'GET', url: '/api/nothing-here' })

    expect(missing.statusCode).toBe(404)
    expect(missing.json<{ error: { message: string } }>().error.message).toContain('"nothing-here"')
    // The code `entries.list` gives for the same condition. One condition, one code:
    // whether a name has a dedicated route decides nothing about what it means.
    expect(missing.json<{ error: { code: string } }>().error.code).toBe('UNKNOWN_RESOURCE')
  })

  it('refuses the API root, which arrives here carrying no name at all', async () => {
    const { server } = build([Articles])

    server.mountResources()
    await server.ready()

    // A parametric segment matches the empty string, so `/api/` and `/api//e1` are the
    // dispatching pair's — the API prefix is a URL people type, and a trailing slash is
    // how they type it. Handed on as a name, the answer became `"" is not a resource
    // this application publishes at this address`: a sentence about a name nobody
    // wrote, at an address that never named a resource in the first place.
    for (const url of ['/api/', '/api//', '/api//e1']) {
      const response = await server.inject({ method: 'GET', url })

      expect(response.statusCode).toBe(404)
      expect(response.json<{ error: { code: string; message: string } }>().error).toMatchObject({
        code: 'NOT_FOUND',
        message: 'There is nothing at this address',
      })
    }
  })

  it('refuses an operation the resource itself switched off (SPEC.md §43)', async () => {
    const { server } = build([Articles])

    server.mountResources()
    await server.ready()

    // `articles` has endpoints of its own for four operations and none for `delete`,
    // because its own `api` flags say so. The pair below them may not reopen that door.
    const refused = await server.inject({ method: 'DELETE', url: '/api/articles/e1' })

    expect(refused.statusCode).toBe(404)
    // A different condition from "no such resource", and it keeps a code of its own:
    // the resource is right there and this is not one of the addresses it publishes.
    expect(refused.json<{ error: { code: string } }>().error.code).toBe('NOT_FOUND')
  })

  it('leaves a route written by hand at the same address serving it', async () => {
    const { registry, server } = build([Articles])

    server
      .mount(
        route.get('/reports', {
          response: { of: string() },
          handler: () => ({ of: 'hand-written' }),
        }),
      )
      .mountResources()

    await server.ready()

    // A static segment beats a parametric one in `find-my-way` whatever the order of
    // registration, so a resource of that name could never take this address over.
    arrives(registry, { ...Testimonials, name: 'reports' })

    const answered = await server.inject({ method: 'GET', url: '/api/reports' })

    expect(answered.json<{ of: string }>().of).toBe('hand-written')
  })
})

/**
 * An endpoint is a consequence of a resource, so it may not outlive one (SPEC.md §43).
 *
 * A collection read out of the database at boot gets endpoints of its own, and Fastify
 * unmounts nothing — so without a lookup at request time those endpoints went on
 * answering after the collection had been deleted, or after it had switched the
 * operation off, until somebody deployed.
 */
describe('a resource that changes after its own endpoints were mounted', () => {
  it('stops answering an operation it stopped publishing', async () => {
    const { registry, server } = build([{ ...Testimonials }])

    server.mountResources()
    await server.ready()

    expect(
      (await server.inject({ method: 'DELETE', url: '/api/testimonials/e1' })).statusCode,
    ).toBe(200)

    changes(registry, { ...Testimonials, api: { ...Testimonials.api, delete: false } })

    const refused = await server.inject({ method: 'DELETE', url: '/api/testimonials/e1' })

    expect(refused.statusCode).toBe(404)
    expect(refused.json<{ error: { code: string } }>().error.code).toBe('NOT_FOUND')
    // The four it kept are untouched.
    expect((await server.inject({ method: 'GET', url: '/api/testimonials' })).statusCode).toBe(200)
  })

  it('stops describing that operation at the same moment', async () => {
    const { registry, server } = build([{ ...Testimonials }])

    server.mountResources()
    await server.ready()

    expect(registry.find('routes', 'delete /testimonials/:id')).toBeDefined()

    changes(registry, { ...Testimonials, api: { ...Testimonials.api, delete: false } })

    // Out of the document at the moment it goes out of service. An address
    // `/api/openapi.json`, the API Explorer and the generated SDK still carried would be
    // a method a generated client can call and this server answers 404 to (SPEC.md §121).
    expect(registry.find('routes', 'delete /testimonials/:id')).toBeUndefined()
    expect(registry.find('routes', 'get /testimonials')).toBeDefined()
  })

  it('answers the same 404 the dispatching pair would once it has gone', async () => {
    const { registry, server } = build([Testimonials])

    server.mountResources()
    await server.ready()

    leaves(registry, Testimonials.name)

    const gone = await server.inject({ method: 'GET', url: '/api/testimonials' })

    expect(gone.statusCode).toBe(404)
    // From here, not from inside `entries.list`. A collection deleted while this
    // process serves answers one thing whether or not it kept a route from boot.
    expect(gone.json<{ error: { code: string } }>().error.code).toBe('UNKNOWN_RESOURCE')
  })
})

/**
 * What the request line and the incident report call the address (SPEC.md §87, §88).
 *
 * The same collection used to be reported under `/api/:resource` while the process that
 * made it ran and under `/api/notes` after the next restart — so per-endpoint latency
 * was bucketed by deploy history rather than by endpoint.
 */
describe('the path a request is reported under', () => {
  it('is the resource’s own, whether or not it has an endpoint of its own', async () => {
    const { registry, server } = build([Articles])

    server.mountResources()
    await server.ready()

    arrives(registry, Testimonials)

    await server.inject({ method: 'GET', url: '/api/articles' })
    await server.inject({ method: 'GET', url: '/api/testimonials' })
    await server.inject({ method: 'GET', url: '/api/testimonials/e1' })

    expect(lines().map((record) => record.path)).toEqual([
      '/api/articles',
      '/api/testimonials',
      '/api/testimonials/:id',
    ])
  })

  it('stays the pattern for a name nothing answers to', async () => {
    const { server } = build([Articles])

    server.mountResources()
    await server.ready()

    await server.inject({ method: 'GET', url: '/api/nothing-here' })

    // A log key and an incident group. Substituting whatever arrived would let anybody
    // walking `/api/<word>` mint an unbounded number of both.
    expect(lines()[0]?.path).toBe('/api/:resource')
  })
})

describe('an application whose resources never change', () => {
  it('serves and describes exactly what it always did', async () => {
    const { registry, server } = build([Articles])

    server.mountResources()
    await server.ready()

    const listed = await server.inject({ method: 'GET', url: '/api/articles' })

    expect(listed.statusCode).toBe(200)
    expect(registry.find('routes', 'get /articles')).toMatchObject({ path: '/articles' })
    // `ready()` refuses to start when the registry describes an address this server does
    // not serve (SPEC.md §98). Nothing above may have made that check quietly untrue.
    await expect(server.ready()).resolves.toBeUndefined()
  })
})

/**
 * What a package below this one can find out about the addresses it describes.
 *
 * `collections.create` answers a person in Studio and an agent over MCP with the REST
 * addresses of a collection that did not exist a moment ago, and `@assemora/resources`
 * may not depend on this package to find out whether this application serves any of them
 * (SPEC.md §8, §43). Built from the collection's own `api` flags, that sentence promised
 * five addresses that answered 404 in every application built with `api: { crud: false }`.
 */
describe('where generated CRUD says it answers', () => {
  it('is the prefix it was mounted under', async () => {
    const { server } = build([Articles])

    server.mountResources()
    await server.ready()

    expect(generatedCrudPrefix()).toBe('/api')
  })

  it('follows the prefix this server was given', async () => {
    const { server } = build([Articles], '/v2')

    server.mountResources()
    await server.ready()

    expect(generatedCrudPrefix()).toBe('/v2')
  })

  it('is nothing at all for a server that never mounts resources', async () => {
    // `api: { crud: false }` is exactly this, and it is a supported answer — the option
    // recommends itself for resources that should answer only under a version. A
    // collection then has no REST address at all, and a note that names five is one an
    // agent acts on.
    const { server } = build([Articles])

    await server.ready()

    expect(generatedCrudPrefix()).toBeUndefined()
  })
})

/**
 * The reconciliation `settled()` asks for, over a section that moved without saying so.
 *
 * Nothing a real registry does produces this: replacing a description is `withdraw` then
 * `register` (SPEC.md §42) and both announce themselves, so a narrowed collection arrives
 * here as "gone, and then back". But `resources` is a section this package may not depend
 * on and therefore reads through `describe()`, whoever supplies it — and an address that
 * is described and no longer served is the one thing this mechanism exists to prevent
 * (SPEC.md §98, §121).
 */
describe('a resources section that moved without announcing it', () => {
  it('loses the description of an operation the resource stopped publishing', async () => {
    const resources: CrudResource[] = [{ ...Testimonials }]
    const { registry, server } = buildOverMovingSection(resources)

    server.mountResources()
    await server.ready()

    expect(registry.find('routes', 'delete /testimonials/:id')).toBeDefined()

    resources[0] = { ...Testimonials, api: { ...Testimonials.api, delete: false } }

    // `ready()` settles, and settling reconciles: it is the belt this layer keeps for a
    // registry it was not told about.
    await server.ready()

    expect(registry.find('routes', 'delete /testimonials/:id')).toBeUndefined()
    expect(registry.find('routes', 'get /testimonials')).toBeDefined()
  })
})
