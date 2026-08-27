/**
 * Collections, as Studio reads and writes them (SPEC.md §37, §38).
 *
 * A collection is a resource whose schema is a row rather than a source file, so it is
 * the one kind of resource Studio can make. It is made the way everything else is
 * changed: `collections.create`, `collections.update` and `collections.delete` on the
 * Command Bus, which are the same handlers an agent reaches over MCP (SPEC.md §14).
 *
 * The shapes are restated here rather than imported. `@assemora/resources` is a server
 * package — it reaches the database — so no browser bundle can import it, and Studio
 * may not depend on a feature package anyway (SPEC.md §8). `src/api/theme.ts` and
 * `src/api/pages.ts` restate their answers for the same reason.
 */
import { type UseQueryResult, useQuery } from '@tanstack/react-query'

import { api } from './client.ts'
import type { ResourceDescriptor } from './introspection.ts'

/** One field of a stored definition. Declarative data, never anything executable. */
export type FieldSpec = {
  readonly name: string
  readonly kind: string
  readonly label?: string
  readonly help?: string
  readonly required?: boolean
  readonly searchable?: boolean
  readonly sortable?: boolean
  readonly filterable?: boolean
  readonly hidden?: boolean
  readonly readOnly?: boolean
  /** `select` only. */
  readonly options?: readonly string[]
  /** `slug` only: the field it is made from. */
  readonly source?: string
  /** `relation` only: the resource it points at. */
  readonly target?: string
}

/** The editable form of a collection: what `collections.update` takes back. */
export type CollectionDefinition = {
  readonly name: string
  readonly label?: string
  readonly fields: readonly FieldSpec[]
}

export type CollectionSummary = {
  readonly id: string
  readonly name: string
  readonly label: string
  readonly fields: number
  readonly api: {
    readonly create: boolean
    readonly read: boolean
    readonly update: boolean
    readonly delete: boolean
  }
}

export type CollectionList = {
  readonly data: readonly CollectionSummary[]
  /** Every resource name in use, source declarations included. */
  readonly taken: readonly string[]
}

export type CollectionRead = {
  readonly id: string
  /** The rendered resource: what the content screens draw their forms from. */
  readonly resource: ResourceDescriptor
  readonly definition: CollectionDefinition
  /**
   * Field names removed while entries existed. Their values are still stored under
   * those names, so a new field may not take one while the collection holds entries.
   */
  readonly dropped: readonly string[]
  /** Why an edit may be refused: above zero, what a value *is* is frozen. */
  readonly entries: number
}

export type CollectionWritten = {
  readonly id: string
  readonly name: string
  readonly resource: ResourceDescriptor
  readonly dropped?: readonly string[]
  readonly entries?: number
  /**
   * What the application says has just become true — including which half of the API
   * carries the collection now and which half waits for a restart. Shown verbatim:
   * the difference is the application's to explain, not Studio's to restate.
   */
  readonly note: string
}

export type CollectionDeleted = {
  readonly id: string
  readonly name: string
  readonly orphanedEntries: number
  readonly note: string
}

export const useCollections = (enabled = true): UseQueryResult<CollectionList> =>
  useQuery({
    queryKey: ['collections'],
    queryFn: ({ signal }) => api.query<CollectionList>('collections.list', {}, signal),
    enabled,
  })

export const useCollection = (name: string, enabled = true): UseQueryResult<CollectionRead> =>
  useQuery({
    queryKey: ['collections', name],
    queryFn: ({ signal }) => api.query<CollectionRead>('collections.get', { name }, signal),
    enabled,
    // The editor holds the definition while it is being changed, and a refetch under
    // it would throw away what somebody is in the middle of typing. The screen
    // invalidates this itself once a save has answered.
    staleTime: Number.POSITIVE_INFINITY,
  })
