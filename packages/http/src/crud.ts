/**
 * REST CRUD generated from resources (SPEC.md §43).
 *
 * This package must not depend on `@assemora/resources` (SPEC.md §8), and it does
 * not: a resource describes itself into the Schema Registry, and what is generated
 * here comes from that description. Writes go to the Command Bus and reads to the
 * Query Bus, so the generated endpoints take the same path as everything else.
 */
import { AssemoraError, type CommandBus, type QueryBus, type SchemaRegistry } from '@assemora/core'
import { json, number, string } from '@assemora/schema'

import { type Route, route } from './route.js'

/** The part of a resource description these endpoints need. */
export type CrudResource = {
  readonly name: string
  readonly label: string
  readonly api: {
    readonly create: boolean
    readonly read: boolean
    readonly update: boolean
    readonly delete: boolean
  }
}

/**
 * One generated endpoint, named the way a caller thinks of it (SPEC.md §43).
 *
 * Finer than the four `api` flags a resource declares: `read` publishes both the
 * listing and the single read, and a version that replaces one of them with a route
 * of its own has to be able to say which (SPEC.md §47).
 */
export type CrudOperation = 'list' | 'get' | 'create' | 'update' | 'delete'

export const CRUD_OPERATIONS: readonly CrudOperation[] = [
  'list',
  'get',
  'create',
  'update',
  'delete',
]

/** What a resource's own `api` flags publish, in the order `crudRoutes` generates them. */
export const publishedOperations = (resource: CrudResource): readonly CrudOperation[] => [
  ...(resource.api.read ? (['list', 'get'] as const) : []),
  ...(resource.api.create ? (['create'] as const) : []),
  ...(resource.api.update ? (['update'] as const) : []),
  ...(resource.api.delete ? (['delete'] as const) : []),
]

/**
 * What a resource is *now*, asked by name.
 *
 * A generated endpoint is a consequence of a resource rather than a declaration of its
 * own, so it has to be able to outlive the snapshot it was generated from: a collection
 * is deleted, or narrows its `api` flags, in a process that is already serving
 * (SPEC.md §37, §43). The server keeps this map in step with the registry — see
 * `HttpServer.mountResources()` — and both ways in ask it the same question.
 */
export type CrudLookup = (name: string) => CrudResource | undefined

/** The path parameter the dispatching pair carries a resource's name in. */
export const RESOURCE_PARAM = 'resource'

/**
 * The resource an address stands for, or the refusal that address has earned.
 *
 * One function for both ways in, because there is one answer. A resource that has gone
 * is `UNKNOWN_RESOURCE` — the code `entries.list` gives for the same condition, so a
 * collection deleted while this process serves answers the same thing whether it kept a
 * dedicated route from boot or was only ever reachable through the dispatching pair.
 * An operation the resource itself switched off is a different condition and keeps a
 * different code: the resource is right there, and this address is not one of the ones
 * it publishes (SPEC.md §43).
 */
const publishing = (current: CrudLookup, name: string, operation: CrudOperation): CrudResource => {
  // The API root is a URL people type, and it arrives here with no name at all.
  if (name === '') {
    throw new AssemoraError('NOT_FOUND', 'There is nothing at this address', { status: 404 })
  }

  const resource = current(name)

  if (resource === undefined) {
    throw new AssemoraError(
      'UNKNOWN_RESOURCE',
      `"${name}" is not a resource this application publishes at this address`,
      { status: 404 },
    )
  }

  if (!publishedOperations(resource).includes(operation)) {
    throw new AssemoraError(
      'NOT_FOUND',
      `"${name}" publishes no ${operation} endpoint — its api option switches that one off (SPEC.md §43)`,
      { status: 404 },
    )
  }

  return resource
}

const RESERVED = new Set(['search', 'sort', 'page', 'perPage'])

/**
 * Query strings carry text. A filter value is turned back into what it looks like,
 * because the field's own schema is what will judge it a moment later.
 */
const coerce = (value: string): unknown => {
  if (value === 'true') return true
  if (value === 'false') return false
  if (value === 'null') return null
  if (value !== '' && !Number.isNaN(Number(value))) return Number(value)

  return value
}

const listQuery = (query: Readonly<Record<string, unknown>>) => {
  const filters: Record<string, unknown> = {}

  for (const [key, value] of Object.entries(query)) {
    if (RESERVED.has(key)) continue
    if (typeof value === 'string') filters[key] = coerce(value)
  }

  return {
    ...(Object.keys(filters).length === 0 ? {} : { filters }),
    ...(typeof query.search === 'string' ? { search: query.search } : {}),
    ...(typeof query.sort === 'string' ? { sort: query.sort } : {}),
    ...(typeof query.page === 'string' ? { page: Number(query.page) } : {}),
    ...(typeof query.perPage === 'string' ? { perPage: Number(query.perPage) } : {}),
  }
}

export type CrudBuses = {
  readonly commands: CommandBus
  readonly queries: QueryBus
}

/**
 * The five operations as calls on the buses, without a route around them.
 *
 * Named separately because they are performed from two places now: the endpoint
 * generated for a resource that was there when the server was built, and the
 * parameterised endpoint that stands in for the resources which were not (SPEC.md §37).
 * One resource reachable through two handlers that had drifted apart is exactly the
 * second-class collection this exists to abolish.
 */
const listEntries = (
  buses: CrudBuses,
  resource: CrudResource,
  query: Readonly<Record<string, unknown>>,
): Promise<unknown> =>
  buses.queries.execute('entries.list', { resource: resource.name, ...listQuery(query) })

const getEntry = async (buses: CrudBuses, resource: CrudResource, id: string): Promise<unknown> => {
  const found = await buses.queries.execute('entries.get', { resource: resource.name, id })

  if (found === null) {
    throw new AssemoraError('ENTRY_NOT_FOUND', `${resource.label} ${id} was not found`, {
      status: 404,
    })
  }

  return found
}

const createEntry = (buses: CrudBuses, resource: CrudResource, body: unknown): Promise<unknown> =>
  buses.commands.execute('entries.create', { resource: resource.name, data: body ?? {} })

const updateEntry = (
  buses: CrudBuses,
  resource: CrudResource,
  id: string,
  body: unknown,
): Promise<unknown> =>
  buses.commands.execute('entries.update', { resource: resource.name, id, data: body ?? {} })

const deleteEntry = (
  buses: CrudBuses,
  resource: CrudResource,
  id: string,
): Promise<{ id: string }> =>
  buses.commands.execute('entries.delete', { resource: resource.name, id }) as Promise<{
    id: string
  }>

/** The response shapes, written once so both ways in document and serialize the same. */
const LISTING = {
  data: json<readonly unknown[]>(),
  total: number(),
  page: number(),
  perPage: number(),
  lastPage: number(),
}

const bodyOf = (request: unknown): unknown => (request as { body?: unknown }).body ?? {}

const queryOf = (request: unknown): Readonly<Record<string, unknown>> =>
  (request as { query?: Record<string, unknown> }).query ?? {}

const isCrudResource = (entry: unknown): entry is CrudResource => {
  const candidate = entry as CrudResource

  return typeof candidate?.name === 'string' && typeof candidate.api?.read === 'boolean'
}

/** Reads the resource descriptions out of the registry, whoever put them there. */
export const crudResources = (registry: SchemaRegistry): CrudResource[] =>
  (registry.describe().resources ?? []).filter(isCrudResource)

export type CrudRouteOptions = {
  /**
   * Which of the five to generate. Every one the resource's own `api` flags allow,
   * unless a caller narrows it — which is what lets a version publish four generated
   * endpoints and a fifth of its own (SPEC.md §47).
   */
  readonly operations?: readonly CrudOperation[]
  /**
   * Where the endpoints look their resource up when they are asked, rather than
   * trusting the description they were generated from.
   *
   * A resource declared in TypeScript never changes, and a version is a snapshot by
   * design — so this is left out for both. A collection is neither: it is deleted, and
   * it narrows its `api` flags, while this process serves (SPEC.md §37, §43). Its
   * endpoints were mounted at boot and Fastify unmounts nothing, so without this a
   * collection went on answering at an address it had just stopped publishing, and a
   * deleted one answered from deep inside `entries.list` instead of from here.
   */
  readonly current?: CrudLookup
}

export const crudRoutes = (
  resources: readonly CrudResource[],
  buses: CrudBuses,
  options: CrudRouteOptions = {},
): Route[] => {
  const routes: Route[] = []
  const wanted = new Set(options.operations ?? CRUD_OPERATIONS)

  for (const resource of resources) {
    const base = `/${resource.name}`
    const tags = [resource.name]

    /**
     * The resource this endpoint stands for, at the moment it is asked.
     *
     * Without a lookup it is the description the route was generated from, which is the
     * whole truth for anything that cannot change.
     */
    const stands = (operation: CrudOperation): CrudResource =>
      options.current === undefined
        ? resource
        : publishing(options.current, resource.name, operation)

    if (resource.api.read && wanted.has('list')) {
      routes.push(
        route.get(base, {
          description: `Lists ${resource.label}`,
          tags,
          query: { search: string().optional(), sort: string().optional() },
          response: LISTING,
          handler: ({ request }) => listEntries(buses, stands('list'), queryOf(request)),
        }),
      )
    }

    if (resource.api.read && wanted.has('get')) {
      routes.push(
        route.get(`${base}/:id`, {
          description: `Reads one of ${resource.label}`,
          tags,
          params: { id: string() },
          response: json<unknown>(),
          handler: ({ params }) => getEntry(buses, stands('get'), params.id),
        }),
      )
    }

    if (resource.api.create && wanted.has('create')) {
      routes.push(
        route.post(base, {
          description: `Creates ${resource.label}`,
          tags,
          body: {},
          response: json<unknown>(),
          status: 201,
          handler: ({ request }) => createEntry(buses, stands('create'), bodyOf(request)),
        }),
      )
    }

    if (resource.api.update && wanted.has('update')) {
      routes.push(
        route.patch(`${base}/:id`, {
          description: `Updates ${resource.label}`,
          tags,
          params: { id: string() },
          body: {},
          response: json<unknown>(),
          handler: ({ params, request }) =>
            updateEntry(buses, stands('update'), params.id, bodyOf(request)),
        }),
      )
    }

    if (resource.api.delete && wanted.has('delete')) {
      routes.push(
        route.delete(`${base}/:id`, {
          description: `Deletes ${resource.label}`,
          tags,
          params: { id: string() },
          response: { id: string() },
          handler: ({ params }) => deleteEntry(buses, stands('delete'), params.id),
        }),
      )
    }
  }

  return routes
}

/**
 * The one address a resource that arrives later can be reached at (SPEC.md §37, §43).
 *
 * A collection is a row. It is made in Studio or by an agent while the process is
 * running, and Fastify will not take a new route once the instance is listening — so the
 * endpoint generated per resource above cannot exist for it, and `/api/testimonials`
 * answered 404 for as long as that process lived. That is the whole of what made a
 * collection a second-class resource: everything else about it — the commands, the
 * policies, the field permissions, the revisions, the audit log, Studio, MCP, the
 * component schemas — was already the same as a resource declared in TypeScript.
 *
 * So the five endpoints are generated once more, parameterised by the resource's name
 * instead of carrying it, and they dispatch through the same five functions the
 * per-resource endpoints call. `find-my-way` prefers a static segment to a parametric
 * one whatever the order of registration, so a resource that *does* have endpoints of
 * its own keeps them and nothing about it changes.
 *
 * A name the registry does not describe is refused here rather than handed to the buses:
 * this pair sits under every unclaimed one- and two-segment address below the API
 * prefix, and "there is nothing here" has to keep meaning that. A resource that switched
 * an operation off is refused for the same reason — `api: { create: false }` is not a
 * door this may quietly reopen. Both refusals are `publishing`'s, which is also what the
 * per-resource endpoints ask, so one condition has one answer wherever it is met.
 *
 * These routes describe *themselves* to nobody: `/api/{resource}` is not an address a
 * caller means, and putting it in OpenAPI, the API Explorer and the generated SDK would
 * replace five documented endpoints with one that documents nothing. What is described
 * is each resource's own paths, which `HttpServer.mountResources()` keeps in step with
 * the registry — which is also why this is not part of the package's public API. Half of
 * this mechanism is the description, and mounting the pair without it would serve
 * addresses nothing documents.
 */
export const crudDispatchRoutes = (current: CrudLookup, buses: CrudBuses): Route[] => {
  const dispatch = (name: string, operation: CrudOperation): CrudResource =>
    publishing(current, name, operation)

  const named = { resource: string() }
  const addressed = { resource: string(), id: string() }

  return [
    route.get(`/:${RESOURCE_PARAM}`, {
      params: named,
      query: { search: string().optional(), sort: string().optional() },
      response: LISTING,
      handler: ({ params, request }) =>
        listEntries(buses, dispatch(params.resource, 'list'), queryOf(request)),
    }),

    route.get(`/:${RESOURCE_PARAM}/:id`, {
      params: addressed,
      response: json<unknown>(),
      handler: ({ params }) => getEntry(buses, dispatch(params.resource, 'get'), params.id),
    }),

    route.post(`/:${RESOURCE_PARAM}`, {
      params: named,
      body: {},
      response: json<unknown>(),
      status: 201,
      handler: ({ params, request }) =>
        createEntry(buses, dispatch(params.resource, 'create'), bodyOf(request)),
    }),

    route.patch(`/:${RESOURCE_PARAM}/:id`, {
      params: addressed,
      body: {},
      response: json<unknown>(),
      handler: ({ params, request }) =>
        updateEntry(buses, dispatch(params.resource, 'update'), params.id, bodyOf(request)),
    }),

    route.delete(`/:${RESOURCE_PARAM}/:id`, {
      params: addressed,
      response: { id: string() },
      handler: ({ params }) => deleteEntry(buses, dispatch(params.resource, 'delete'), params.id),
    }),
  ]
}
