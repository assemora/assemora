/**
 * What the application says about itself (SPEC.md §42, §121).
 *
 * Studio has no list of collections and no hand-written form for any of them. It
 * asks the Schema Registry what exists and renders that, which is why a new
 * `resource()` in an application appears here without a line of Studio code.
 */
import { type UseQueryResult, useQuery } from '@tanstack/react-query'

import { api } from './client.ts'

/**
 * The kinds `@assemora/resources` declares (SPEC.md §39).
 *
 * A closed union here and a plain string in a stored definition, which is deliberate:
 * this is what Studio *draws*, and a plugin's kind reaches the form as a kind the switch
 * does not know and falls back honestly. Widening this to `string` would take that
 * exhaustiveness away from every control that reads it.
 */
export type FieldKind =
  | 'text'
  | 'textarea'
  | 'richText'
  | 'markdown'
  | 'code'
  | 'number'
  | 'integer'
  | 'boolean'
  | 'date'
  | 'datetime'
  | 'time'
  | 'select'
  | 'checkboxes'
  | 'color'
  | 'json'
  | 'slug'
  | 'url'
  | 'link'
  | 'email'
  | 'media'
  | 'relation'
  | 'table'
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
  /** `select` and `checkboxes`: the values. `code`: the languages offered. */
  readonly options?: readonly { readonly value: string; readonly label: string }[]
  readonly source?: string
  readonly target?: string
  /** `media`: the media types its picker offers. */
  readonly accept?: readonly string[]
  /**
   * `array`: the field one item is. `object`: the fields it groups.
   *
   * A group and a repeater describe themselves the whole way down, so a nested form is
   * built from the same data a flat one is and nobody reads the JSON Schema to find out
   * what a repeater repeats. There is no hidden field down there: `object()` and
   * `array()` refuse one, because nothing enforces it inside a value.
   */
  readonly element?: FieldDescriptor
  readonly fields?: readonly FieldDescriptor[]
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
  /** The field that names an entry, where the resource declared one. */
  readonly titleField?: string
  /** The heading the sidebar files it under, where the application named one. */
  readonly group?: string
  /** What it is drawn as: a name from the set `ui/icons.tsx` ships (SPEC.md §58). */
  readonly icon?: string
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
  /** What the palette draws it as: a name from the set `ui/icons.tsx` ships. */
  readonly icon?: string
  /** The heading the palette files it under, where the application named one. */
  readonly group?: string
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

/** A language this deployment serves (SPEC.md §131). */
export type LocaleDescriptor = {
  readonly name: string
  /** Whether a missing translation falls back to this one. */
  readonly default: boolean
}

export type Introspection = {
  readonly resources?: readonly ResourceDescriptor[]
  readonly routes?: readonly RouteDescriptor[]
  readonly commands?: readonly CommandDescriptor[]
  /** A query describes itself exactly as a command does (SPEC.md §15). */
  readonly queries?: readonly CommandDescriptor[]
  readonly blocks?: readonly BlockDescriptor[]
  readonly models?: readonly ModelDescriptor[]
  /** Empty in an application that serves one language, which is most of them. */
  readonly locales?: readonly LocaleDescriptor[]
  /**
   * Where this application serves its own frontend — one entry, whose name is the path.
   *
   * The builder canvas frames it, and it is not always `/preview`: an application whose
   * site *is* the frontend serves it at the origin root.
   */
  readonly frontend?: readonly { readonly name: string }[]
}

export const useIntrospection = (): UseQueryResult<Introspection> =>
  useQuery({
    queryKey: ['introspection'],
    queryFn: ({ signal }) => api.get<Introspection>('/_introspection', signal),
    /**
     * The registry changes when the application restarts — and when a collection is
     * made, which is the one thing that changes it while it runs (SPEC.md §37).
     *
     * So this is cached for a long time and invalidated by hand: the collection
     * screens do it after every `collections.*` command, because the navigation, the
     * content screens and the API Explorer are all drawn from this answer.
     */
    staleTime: 5 * 60 * 1000,
  })

export const labelOf = (field: FieldDescriptor): string => field.label ?? field.name

/**
 * One value out of a record keyed by field names.
 *
 * `record[name]` is not this. A field name comes from a stored definition (SPEC.md §37,
 * §86) and `/^[a-zA-Z][a-zA-Z0-9_]*$/` makes `constructor`, `toString`, `valueOf` and
 * `hasOwnProperty` legal ones — every one of which a plain object answers from
 * `Object.prototype` even though nothing ever put it there. What comes back is a
 * function: pre-filled into an input, printed into a table cell, and saved as the
 * sentence `function Object() { [native code] }` the moment somebody presses the button.
 *
 * The application reads entries the same way (`dynamic.ts`, `validation.ts`). Studio is
 * the other end of that JSON and has to agree with it.
 */
export const valueAt = (record: Readonly<Record<string, unknown>>, name: string): unknown =>
  Object.hasOwn(record, name) ? record[name] : undefined

/**
 * The fields a form sends, out of everything its draft is holding.
 *
 * An id or a timestamp the read returned is not the form's to write back, and a field
 * the draft never touched is left out rather than sent as `undefined` — that is what
 * makes an edit partial. `hasOwn` for the reason above: `'constructor' in draft` is true
 * of every draft.
 */
export const declaredValues = (
  fields: readonly FieldDescriptor[],
  draft: Readonly<Record<string, unknown>>,
): Record<string, unknown> => {
  const values: Record<string, unknown> = {}

  for (const field of fields) {
    if (Object.hasOwn(draft, field.name)) values[field.name] = draft[field.name]
  }

  return values
}

/**
 * The kinds that are not a column.
 *
 * A document, a program and a value with other values inside it have no one-line form:
 * printed into a cell they are either a paragraph or the JSON somebody was escaping when
 * they asked for a repeater. They are what the row is *opened* to read.
 */
const NOT_A_COLUMN: readonly FieldKind[] = [
  'richText',
  'markdown',
  'code',
  'table',
  'object',
  'array',
  'json',
]

/** The fields a table shows: never a hidden one, and never the whole record. */
export const columnFields = (resource: ResourceDescriptor): FieldDescriptor[] =>
  resource.fields.filter((field) => !field.hidden && !NOT_A_COLUMN.includes(field.kind)).slice(0, 5)

export const editableFields = (resource: ResourceDescriptor): FieldDescriptor[] =>
  resource.fields.filter((field) => !field.hidden && !field.readOnly)

/**
 * The kinds that belong beside the entry rather than inside it.
 *
 * An entry form is two columns: what the entry *is* on the left, and what is *true of*
 * it on the right — the arrangement `design_handoff_studio_redesign` §3 draws, where
 * Title, Slug, Excerpt, Content and the cover image sit in a Main content card and
 * Status, Views, Featured and the relations sit in a panel next to it.
 *
 * Derived from the kind rather than declared, because a resource descriptor has nowhere
 * to say it: nothing in `resource()` or in a stored definition carries a hint about
 * where a field is drawn, and inventing one is a change to the schema layer, the parser,
 * the registry, OpenAPI and the MCP tools — not to Studio. The kind is the honest proxy
 * we already have, and it is the same division the design made by hand: a single small
 * value with a fixed set of answers is metadata; anything holding prose, a document or
 * a file is the entry itself.
 *
 * A resource whose fields all fall on one side gets one column, at full width. Two
 * columns where one of them is empty is a margin, not a layout.
 */
const BESIDE: readonly FieldKind[] = [
  'boolean',
  'number',
  'integer',
  'date',
  'datetime',
  'time',
  'select',
  'checkboxes',
  'relation',
  'color',
  'email',
  'url',
  'link',
]

/** What the entry is: its title, its address, its prose, its picture. */
export const mainFields = (fields: readonly FieldDescriptor[]): FieldDescriptor[] =>
  fields.filter((field) => !BESIDE.includes(field.kind))

/** What is true of the entry: its status, its author, its counters, its flags. */
export const asideFields = (fields: readonly FieldDescriptor[]): FieldDescriptor[] =>
  fields.filter((field) => BESIDE.includes(field.kind))

/**
 * The fields a listing of this resource can actually be ordered by (SPEC.md §38).
 *
 * None of a collection's, whatever its fields claim. `entries.list` orders a dynamic
 * resource by the entry's own columns — `createdAt`, `updatedAt`, `publishedAt`,
 * `status` — and refuses anything else with a 422, because the values live inside one
 * JSONB document and the Query AST has no ordering term that reaches into it
 * (ADR-0012). A stored definition can still say `sortable: true`: `collections.create`
 * accepts the flag, so an agent or a Studio that offered the checkbox may have written
 * one. Reading the descriptor at face value put an option in the sort dropdown whose
 * only possible outcome was replacing the list with a refusal, and a control that
 * always fails is worse than no control.
 */
export const sortableFields = (resource: ResourceDescriptor): FieldDescriptor[] =>
  resource.kind === 'dynamic' ? [] : resource.fields.filter((field) => field.sortable)

export const blockByName = (
  introspection: Introspection | undefined,
  name: string,
): BlockDescriptor | undefined => introspection?.blocks?.find((block) => block.name === name)

/** Whether a block may hold another of this type (SPEC.md §56). */
export const accepts = (parent: BlockDescriptor, childType: string): boolean =>
  parent.acceptsChildren &&
  (parent.allowedChildren.length === 0 || parent.allowedChildren.includes(childType))
