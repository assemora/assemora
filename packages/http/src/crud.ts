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

const isCrudResource = (entry: unknown): entry is CrudResource => {
  const candidate = entry as CrudResource

  return typeof candidate?.name === 'string' && typeof candidate.api?.read === 'boolean'
}

/** Reads the resource descriptions out of the registry, whoever put them there. */
export const crudResources = (registry: SchemaRegistry): CrudResource[] =>
  (registry.describe().resources ?? []).filter(isCrudResource)

export const crudRoutes = (resources: readonly CrudResource[], buses: CrudBuses): Route[] => {
  const routes: Route[] = []

  for (const resource of resources) {
    const base = `/${resource.name}`
    const tags = [resource.name]

    if (resource.api.read) {
      routes.push(
        route.get(base, {
          description: `Lists ${resource.label}`,
          tags,
          query: { search: string().optional(), sort: string().optional() },
          response: {
            data: json<readonly unknown[]>(),
            total: number(),
            page: number(),
            perPage: number(),
            lastPage: number(),
          },
          handler: ({ request }) =>
            buses.queries.execute('entries.list', {
              resource: resource.name,
              ...listQuery((request as { query?: Record<string, unknown> }).query ?? {}),
            }),
        }),
        route.get(`${base}/:id`, {
          description: `Reads one of ${resource.label}`,
          tags,
          params: { id: string() },
          response: json<unknown>(),
          handler: async ({ params }) => {
            const found = await buses.queries.execute('entries.get', {
              resource: resource.name,
              id: params.id,
            })

            if (found === null) {
              throw new AssemoraError(
                'ENTRY_NOT_FOUND',
                `${resource.label} ${params.id} was not found`,
                {
                  status: 404,
                },
              )
            }

            return found
          },
        }),
      )
    }

    if (resource.api.create) {
      routes.push(
        route.post(base, {
          description: `Creates ${resource.label}`,
          tags,
          body: {},
          response: json<unknown>(),
          status: 201,
          handler: ({ request }) =>
            buses.commands.execute('entries.create', {
              resource: resource.name,
              data: (request as { body?: unknown }).body ?? {},
            }),
        }),
      )
    }

    if (resource.api.update) {
      routes.push(
        route.patch(`${base}/:id`, {
          description: `Updates ${resource.label}`,
          tags,
          params: { id: string() },
          body: {},
          response: json<unknown>(),
          handler: ({ params, request }) =>
            buses.commands.execute('entries.update', {
              resource: resource.name,
              id: params.id,
              data: (request as { body?: unknown }).body ?? {},
            }),
        }),
      )
    }

    if (resource.api.delete) {
      routes.push(
        route.delete(`${base}/:id`, {
          description: `Deletes ${resource.label}`,
          tags,
          params: { id: string() },
          response: { id: string() },
          handler: ({ params }) =>
            buses.commands.execute('entries.delete', {
              resource: resource.name,
              id: params.id,
            }) as Promise<{ id: string }>,
        }),
      )
    }
  }

  return routes
}
