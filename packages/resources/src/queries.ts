/**
 * Read operations on resources (SPEC.md §15, §35).
 *
 * They exist so a layer that must not depend on `@assemora/resources` — the HTTP
 * adapter, and MCP after it — can still read content: it dispatches a query by name,
 * exactly as it dispatches a command (SPEC.md §8).
 */
import { ForbiddenError, query } from '@assemora/core'
import { json, number, string, unknown as unknownSchema, uuid } from '@assemora/schema'

import { resourceByName } from './registry.js'

const refuseWhenClosed = (resource: string, allowed: boolean): void => {
  if (!allowed) throw new ForbiddenError(`Entries of "${resource}" cannot be read`)
}

export const ListEntries = query('entries.list', {
  description: 'Lists a page of entries, filtered, searched and sorted',
  input: {
    resource: string(),
    filters: json<Record<string, unknown>>().optional(),
    search: string().optional(),
    sort: string().optional(),
    page: number().optional(),
    perPage: number().optional(),
  },
  handle: async ({ resource, ...rest }) => {
    const target = resourceByName(resource)

    refuseWhenClosed(resource, target.descriptor.api.read)

    return target.list(rest)
  },
})

export const GetEntry = query('entries.get', {
  description: 'Reads one entry of a resource',
  input: { resource: string(), id: uuid() },
  handle: async ({ resource, id }) => {
    const target = resourceByName(resource)

    refuseWhenClosed(resource, target.descriptor.api.read)

    return target.find(id)
  },
})

/** Every read a resource answers. Registered together with the resources. */
export const entryQueries = [ListEntries, GetEntry] as const

export { unknownSchema }
