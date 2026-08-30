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
import { PERSISTENCE } from './resource.js'

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
export const ListTranslations = query('entries.translations', {
  description: 'Which languages an entry is written in, and which of them are out of date',
  input: { resource: string(), id: uuid() },
  handle: async ({ resource, id }, context) => {
    const target = resourceByName(resource)

    refuseWhenClosed(resource, target.descriptor.api.read)

    // The entry itself decides who may read its history across languages, the way
    // `revisions.list` asks about the entity it is the history of (ADR-0015).
    await context.authorize(resource, 'read', await target[PERSISTENCE].load(id))

    const rows = await target[PERSISTENCE].translations(id)
    const original = rows.find((row) => row.isOriginal)

    return {
      /**
       * Whether a translation was written before the original last changed.
       *
       * The honest definition, and the only one available without a column nobody has
       * declared: `null` where either row carries no timestamp, because "I cannot tell"
       * and "it is current" are different answers and a screen must not print the
       * second when it means the first.
       */
      translations: rows.map((row) => ({
        ...row,
        stale:
          row.isOriginal || original?.updatedAt == null || row.updatedAt == null
            ? null
            : row.updatedAt < original.updatedAt,
      })),
    }
  },
})

export const entryQueries = [ListEntries, GetEntry, ListTranslations] as const

export { unknownSchema }
