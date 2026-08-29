/**
 * How a resource describes itself (SPEC.md §35, §42).
 *
 * The descriptor is plain data. Studio builds its forms from it, OpenAPI and the SDK
 * are generated from it, and MCP tells an agent what exists by reading it — all from
 * this one declaration, never from a second copy (SPEC.md §3.4, §125.9).
 */
import type { JsonSchema } from '@assemora/schema'

import {
  type AgentPermissions,
  type AnyField,
  ELEMENT_NAME,
  type FieldKind,
  type SelectOption,
} from './fields.js'

export type ResourceFieldDescriptor = {
  readonly name: string
  readonly kind: FieldKind
  readonly required: boolean
  readonly searchable: boolean
  readonly sortable: boolean
  readonly filterable: boolean
  readonly hidden: boolean
  readonly readOnly: boolean
  readonly label: string
  readonly help?: string
  readonly placeholder?: string
  readonly options?: readonly SelectOption[]
  readonly source?: string
  readonly target?: string
  /** `media`: the media types its picker offers. */
  readonly accept?: readonly string[]
  /** `array`: the field one item is. */
  readonly element?: ResourceFieldDescriptor
  /** `object`: the fields it groups, in declaration order. */
  readonly fields?: readonly ResourceFieldDescriptor[]
  readonly agent: AgentPermissions
  /** The same schema validation, OpenAPI and MCP all read. */
  readonly schema: JsonSchema
}

/** Which of the generated CRUD endpoints exist (SPEC.md §43). */
export type ApiExposure = {
  readonly create: boolean
  readonly read: boolean
  readonly update: boolean
  readonly delete: boolean
}

export type ResourceDescriptor = {
  readonly name: string
  readonly label: string
  readonly kind: 'static' | 'dynamic'
  /** The table behind the resource. */
  readonly model: string
  readonly primaryKey: string
  readonly fields: readonly ResourceFieldDescriptor[]
  readonly api: ApiExposure
  readonly defaultSort?: string
  /**
   * The field that names an entry, wherever one has to be shown as a line of text
   * (SPEC.md §35, §58).
   *
   * A picker, a relation, a breadcrumb and a list all need one string for a row, and
   * without this they guess: the first declared field that happens to hold text. That
   * is a guess about *declaration order*, so declaring `articleNumber` before `name`
   * makes every list in Studio read `091`, `001`, `144`.
   */
  readonly titleField?: string
  readonly perPage: number
}

declare module '@assemora/core' {
  interface RegistrySections {
    resources: ResourceDescriptor
  }
}

/** `title` → `Title`, `publishedAt` → `Published at`. */
export const humanize = (name: string): string => {
  const spaced = name.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ')

  return spaced.charAt(0).toUpperCase() + spaced.slice(1).toLowerCase()
}

/**
 * `Notes on the Analytical Engine` → `notes-on-the-analytical-engine`.
 *
 * Accents are folded rather than dropped, so `Café` becomes `cafe` and not `caf`.
 * A title that survives none of this — one written entirely in a script with no
 * ASCII form — yields an empty slug, and the field's own pattern then says so
 * instead of this quietly inventing a name.
 */
export const slugify = (value: string): string =>
  value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')

export const describeField = (name: string, field: AnyField): ResourceFieldDescriptor => ({
  name,
  kind: field.kind,
  required: field.isRequired,
  searchable: field.isSearchable,
  sortable: field.isSortable,
  filterable: field.isFilterable,
  hidden: field.isHidden,
  readOnly: field.isReadOnly,
  label: field.presentation.label ?? humanize(name),
  ...(field.presentation.help === undefined ? {} : { help: field.presentation.help }),
  ...(field.presentation.placeholder === undefined
    ? {}
    : { placeholder: field.presentation.placeholder }),
  ...(field.options === undefined ? {} : { options: field.options }),
  ...(field.source === undefined ? {} : { source: field.source }),
  ...(field.target === undefined ? {} : { target: field.target }),
  ...(field.accept === undefined ? {} : { accept: field.accept }),
  // A group and a repeater describe themselves the whole way down, so Studio builds a
  // nested form from the same data it builds a flat one from, and nobody has to read
  // the JSON Schema to find out what a repeater repeats. There is no hidden field down
  // there to leak: `object()` and `array()` refuse one, because nothing enforces it
  // inside a value.
  ...(field.element === undefined ? {} : { element: describeField(ELEMENT_NAME, field.element) }),
  ...(field.shape === undefined
    ? {}
    : {
        fields: Object.entries(field.shape).map(([inner, nested]) => describeField(inner, nested)),
      }),
  agent: field.agent,
  schema: field.schema.toJsonSchema(),
})
