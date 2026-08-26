/**
 * What the application says about itself (SPEC.md §42, §121).
 *
 * Studio has no list of collections and no hand-written form for any of them. It
 * asks the Schema Registry what exists and renders that, which is why a new
 * `resource()` in an application appears here without a line of Studio code.
 */
import { type UseQueryResult, useQuery } from '@tanstack/react-query'

import { api } from './client.ts'

export type FieldKind =
  | 'text'
  | 'textarea'
  | 'richText'
  | 'number'
  | 'boolean'
  | 'date'
  | 'datetime'
  | 'select'
  | 'json'
  | 'slug'
  | 'url'
  | 'email'
  | 'media'
  | 'relation'
  | 'object'
  | 'array'

export type FieldDescriptor = {
  readonly name: string
  readonly kind: FieldKind
  readonly required: boolean
  readonly searchable: boolean
  readonly sortable: boolean
  readonly filterable: boolean
  readonly hidden: boolean
  readonly readOnly: boolean
  readonly label?: string
  readonly help?: string
  readonly placeholder?: string
  readonly options?: readonly { readonly value: string; readonly label: string }[]
  readonly source?: string
  readonly target?: string
  readonly schema?: Readonly<Record<string, unknown>>
}

export type ResourceDescriptor = {
  readonly name: string
  readonly label: string
  readonly kind: 'static' | 'dynamic'
  readonly model: string
  readonly primaryKey: string
  readonly fields: readonly FieldDescriptor[]
  readonly api: {
    readonly create: boolean
    readonly read: boolean
    readonly update: boolean
    readonly delete: boolean
  }
  readonly defaultSort?: string
  readonly perPage: number
}

export type RouteDescriptor = {
  readonly name: string
  readonly method: 'get' | 'post' | 'put' | 'patch' | 'delete'
  readonly path: string
  readonly description?: string
  readonly tags: readonly string[]
  readonly auth: boolean
  readonly status: number
  readonly params?: Readonly<Record<string, unknown>>
  readonly query?: Readonly<Record<string, unknown>>
  readonly body?: Readonly<Record<string, unknown>>
  readonly response?: Readonly<Record<string, unknown>>
  readonly errors: readonly { readonly code: string; readonly status: number }[]
  readonly module?: string
}

export type CommandDescriptor = {
  readonly name: string
  readonly description?: string
  readonly input: Readonly<Record<string, unknown>>
  readonly module?: string
}

export type BlockDescriptor = {
  /** The block's type. The registry calls it `name`; the tree calls it `type`. */
  readonly name: string
  readonly label: string
  readonly description?: string
  readonly fields: readonly FieldDescriptor[]
  readonly acceptsChildren: boolean
  /** Empty means anything, once children are accepted at all (SPEC.md §56). */
  readonly allowedChildren: readonly string[]
  readonly maxChildren?: number
  readonly module?: string
}

export type ModelDescriptor = {
  readonly name: string
  readonly module?: string
}

export type Introspection = {
  readonly resources?: readonly ResourceDescriptor[]
  readonly routes?: readonly RouteDescriptor[]
  readonly commands?: readonly CommandDescriptor[]
  /** A query describes itself exactly as a command does (SPEC.md §15). */
  readonly queries?: readonly CommandDescriptor[]
  readonly blocks?: readonly BlockDescriptor[]
  readonly models?: readonly ModelDescriptor[]
}

export const useIntrospection = (): UseQueryResult<Introspection> =>
  useQuery({
    queryKey: ['introspection'],
    queryFn: ({ signal }) => api.get<Introspection>('/_introspection', signal),
    // The registry only changes when the application restarts.
    staleTime: 5 * 60 * 1000,
  })

export const labelOf = (field: FieldDescriptor): string => field.label ?? field.name

/** The fields a table shows: never a hidden one, and never the whole record. */
export const columnFields = (resource: ResourceDescriptor): FieldDescriptor[] =>
  resource.fields.filter((field) => !field.hidden && field.kind !== 'richText').slice(0, 5)

export const editableFields = (resource: ResourceDescriptor): FieldDescriptor[] =>
  resource.fields.filter((field) => !field.hidden && !field.readOnly)

export const blockByName = (
  introspection: Introspection | undefined,
  name: string,
): BlockDescriptor | undefined => introspection?.blocks?.find((block) => block.name === name)

/** Whether a block may hold another of this type (SPEC.md §56). */
export const accepts = (parent: BlockDescriptor, childType: string): boolean =>
  parent.acceptsChildren &&
  (parent.allowedChildren.length === 0 || parent.allowedChildren.includes(childType))
