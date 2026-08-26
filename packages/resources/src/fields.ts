/**
 * Resource fields (SPEC.md §39).
 *
 * A field is how a column is presented, validated and exposed — to Studio, to REST,
 * to the SDK and to an agent. It never replaces the column: the model owns the data,
 * the resource owns its representation (SPEC.md §35).
 */
import {
  array as arraySchema,
  boolean as booleanSchema,
  enumOf,
  type Infer,
  json as jsonSchema,
  number as numberSchema,
  object as objectSchema,
  type Schema,
  type Shape,
  string as stringSchema,
  timestamp as timestampSchema,
  uuid as uuidSchema,
} from '@assemora/schema'

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

/** What an agent may do with this field (SPEC.md §52). */
export type AgentPermissions = {
  readonly read: boolean
  readonly write: boolean
}

/** How the field is shown. Kept apart from the builder's setters of the same name. */
export type Presentation = {
  readonly label: string | undefined
  readonly help: string | undefined
  readonly placeholder: string | undefined
}

export type SelectOption = {
  readonly value: string
  readonly label: string
}

export type FieldState<T> = {
  readonly kind: FieldKind
  readonly schema: Schema<T>
  readonly isRequired: boolean
  readonly isSearchable: boolean
  readonly isSortable: boolean
  readonly isFilterable: boolean
  readonly isHidden: boolean
  readonly isReadOnly: boolean
  readonly presentation: Presentation
  readonly agent: AgentPermissions
  /** `select` only. */
  readonly options: readonly SelectOption[] | undefined
  /** `slug` only: the field it is derived from. */
  readonly source: string | undefined
  /** `relation` and `media` only: the resource on the other side. */
  readonly target: string | undefined
  /** `array` only. */
  readonly element: Field | undefined
  /** `object` only. */
  readonly shape: Readonly<Record<string, Field>> | undefined
}

export type Field<T = unknown> = FieldState<T> & { readonly node: 'field' }

/** Any field, for places that only read the metadata. */
export type AnyField = {
  readonly node: 'field'
  readonly kind: FieldKind
  readonly schema: Schema<unknown>
  readonly isRequired: boolean
  readonly isSearchable: boolean
  readonly isSortable: boolean
  readonly isFilterable: boolean
  readonly isHidden: boolean
  readonly isReadOnly: boolean
  readonly presentation: Presentation
  readonly agent: AgentPermissions
  readonly options: readonly SelectOption[] | undefined
  readonly source: string | undefined
  readonly target: string | undefined
  readonly element: AnyField | undefined
  readonly shape: Readonly<Record<string, AnyField>> | undefined
}

export type FieldValue<F> = F extends { readonly schema: Schema<infer T> } ? T : never

/**
 * A field that never reaches serialized output (SPEC.md §28).
 *
 * The marker is a literal, not a boolean, so the resource record type can drop the
 * field as well — a guarantee that only holds at runtime is half a guarantee.
 */
export type HiddenFieldBuilder<T> = Field<T> & {
  readonly isHidden: true
  required(): HiddenFieldBuilder<T>
  searchable(): HiddenFieldBuilder<T>
  sortable(): HiddenFieldBuilder<T>
  filterable(): HiddenFieldBuilder<T>
  hidden(): HiddenFieldBuilder<T>
  readOnly(): HiddenFieldBuilder<T>
  label(text: string): HiddenFieldBuilder<T>
  help(text: string): HiddenFieldBuilder<T>
  placeholder(text: string): HiddenFieldBuilder<T>
  agentAccess(permissions: Partial<AgentPermissions>): HiddenFieldBuilder<T>
}

export type FieldBuilder<T> = Field<T> & {
  /** The value must be present. Studio marks it, validation enforces it. */
  required(): FieldBuilder<T>
  /** Free-text search covers this field (SPEC.md §35). */
  searchable(): FieldBuilder<T>
  sortable(): FieldBuilder<T>
  filterable(): FieldBuilder<T>
  /** Never serialized and never shown (SPEC.md §28). */
  hidden(): HiddenFieldBuilder<T>
  readOnly(): FieldBuilder<T>
  label(text: string): FieldBuilder<T>
  help(text: string): FieldBuilder<T>
  placeholder(text: string): FieldBuilder<T>
  /** Narrows what an agent may do with the field (SPEC.md §52). */
  agentAccess(permissions: Partial<AgentPermissions>): FieldBuilder<T>
}

const DEFAULT_AGENT: AgentPermissions = { read: true, write: true }

const buildHidden = <T>(state: FieldState<T>): HiddenFieldBuilder<T> => ({
  ...state,
  node: 'field',
  isHidden: true,
  required: () => buildHidden({ ...state, isRequired: true }),
  searchable: () => buildHidden({ ...state, isSearchable: true }),
  sortable: () => buildHidden({ ...state, isSortable: true }),
  filterable: () => buildHidden({ ...state, isFilterable: true }),
  hidden: () => buildHidden(state),
  readOnly: () => buildHidden({ ...state, isReadOnly: true }),
  label: (text) => buildHidden({ ...state, presentation: { ...state.presentation, label: text } }),
  help: (text) => buildHidden({ ...state, presentation: { ...state.presentation, help: text } }),
  placeholder: (text) =>
    buildHidden({ ...state, presentation: { ...state.presentation, placeholder: text } }),
  agentAccess: (permissions) =>
    buildHidden({ ...state, agent: { ...state.agent, ...permissions } }),
})

const build = <T>(state: FieldState<T>): FieldBuilder<T> => ({
  ...state,
  node: 'field',
  required: () => build({ ...state, isRequired: true }),
  searchable: () => build({ ...state, isSearchable: true }),
  sortable: () => build({ ...state, isSortable: true }),
  filterable: () => build({ ...state, isFilterable: true }),
  hidden: () => buildHidden({ ...state, isHidden: true }),
  readOnly: () => build({ ...state, isReadOnly: true }),
  label: (text) => build({ ...state, presentation: { ...state.presentation, label: text } }),
  help: (text) => build({ ...state, presentation: { ...state.presentation, help: text } }),
  placeholder: (text) =>
    build({ ...state, presentation: { ...state.presentation, placeholder: text } }),
  agentAccess: (permissions) => build({ ...state, agent: { ...state.agent, ...permissions } }),
})

const start = <T>(kind: FieldKind, schema: Schema<T>, extra: Partial<FieldState<T>> = {}) =>
  build<T>({
    kind,
    schema,
    isRequired: false,
    isSearchable: false,
    isSortable: false,
    isFilterable: false,
    isHidden: false,
    isReadOnly: false,
    presentation: { label: undefined, help: undefined, placeholder: undefined },
    agent: DEFAULT_AGENT,
    options: undefined,
    source: undefined,
    target: undefined,
    element: undefined,
    shape: undefined,
    ...extra,
  })

// --- the field vocabulary of SPEC.md §39 -------------------------------------

export const text = (): FieldBuilder<string> => start('text', stringSchema())

export const textarea = (): FieldBuilder<string> => start('textarea', stringSchema())

export const richText = (): FieldBuilder<string> => start('richText', stringSchema())

export const number = (): FieldBuilder<number> => start('number', numberSchema())

export const boolean = (): FieldBuilder<boolean> => start('boolean', booleanSchema())

/** The same field as `boolean`, named the way Studio shows it (SPEC.md §39). */
export const toggle = (): FieldBuilder<boolean> => start('boolean', booleanSchema())

export const date = (): FieldBuilder<Date> => start('date', timestampSchema())

export const datetime = (): FieldBuilder<Date> => start('datetime', timestampSchema())

export const url = (): FieldBuilder<string> =>
  start('url', stringSchema().pattern(/^https?:\/\/\S+$/, 'Invalid URL'))

export const email = (): FieldBuilder<string> => start('email', stringSchema().email())

export const json = <T = unknown>(): FieldBuilder<T> => start('json', jsonSchema<T>())

/** A URL-safe identifier derived from another field. */
export const slug = (source: string): FieldBuilder<string> =>
  start('slug', stringSchema().pattern(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Invalid slug'), { source })

export const select = <const V extends readonly [string, ...string[]]>(
  ...values: V
): FieldBuilder<V[number]> =>
  start('select', enumOf(...values), {
    options: values.map((value) => ({ value, label: value })),
  })

/** A reference to an item in the media library (SPEC.md §63). */
export const media = (): FieldBuilder<string> => start('media', uuidSchema(), { target: 'media' })

/** A reference to another resource. */
export const relation = (target: string): FieldBuilder<string> =>
  start('relation', uuidSchema(), { target })

export const object = <S extends Shape>(
  shape: S,
): FieldBuilder<Infer<ReturnType<typeof objectSchema<S>>>> => start('object', objectSchema(shape))

export const array = <E extends FieldBuilder<unknown>>(element: E): FieldBuilder<FieldValue<E>[]> =>
  start('array', arraySchema(element.schema) as Schema<FieldValue<E>[]>, {
    element: element as Field,
  })
