/**
 * The field registry (SPEC.md §39, §86).
 *
 * A dynamic resource definition is untrusted data. It names a field *kind*, and only
 * a kind registered here can be built from it — there is no path from a definition
 * to executable code, which is the whole point of §86.
 */
import { ValidationError } from '@assemora/core'
import { array, boolean, enumOf, object, type Schema, string } from '@assemora/schema'
import type { AnyField, FieldKind } from './fields.js'
import * as fields from './fields.js'

export type FieldSpec = {
  readonly name: string
  readonly kind: FieldKind
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
  /** `slug` only. */
  readonly source?: string
  /** `relation` and `media` only. */
  readonly target?: string
  readonly agent?: { readonly read?: boolean; readonly write?: boolean }
}

export type FieldFactory = (spec: FieldSpec) => AnyField

const factories = new Map<string, FieldFactory>()

export const registerFieldKind = (kind: string, factory: FieldFactory): void => {
  factories.set(kind, factory)
}

export const registeredFieldKinds = (): readonly string[] => [...factories.keys()].sort()

export const hasFieldKind = (kind: string): boolean => factories.has(kind)

const simple = (build: () => AnyField): FieldFactory => build

registerFieldKind(
  'text',
  simple(() => fields.text()),
)
registerFieldKind(
  'textarea',
  simple(() => fields.textarea()),
)
registerFieldKind(
  'richText',
  simple(() => fields.richText()),
)
registerFieldKind(
  'number',
  simple(() => fields.number()),
)
registerFieldKind(
  'boolean',
  simple(() => fields.boolean()),
)
registerFieldKind(
  'date',
  simple(() => fields.date()),
)
registerFieldKind(
  'datetime',
  simple(() => fields.datetime()),
)
registerFieldKind(
  'json',
  simple(() => fields.json()),
)
registerFieldKind(
  'url',
  simple(() => fields.url()),
)
registerFieldKind(
  'email',
  simple(() => fields.email()),
)
registerFieldKind(
  'media',
  simple(() => fields.media()),
)

registerFieldKind('select', (spec) => {
  const [first, ...rest] = spec.options ?? []

  if (first === undefined) {
    throw new ValidationError([
      { path: ['options'], code: 'required', message: 'A select field needs at least one option' },
    ])
  }

  return fields.select(first, ...rest)
})

registerFieldKind('slug', (spec) => {
  if (spec.source === undefined) {
    throw new ValidationError([
      { path: ['source'], code: 'required', message: 'A slug field needs a source field' },
    ])
  }

  return fields.slug(spec.source)
})

registerFieldKind('relation', (spec) => {
  if (spec.target === undefined) {
    throw new ValidationError([
      { path: ['target'], code: 'required', message: 'A relation field needs a target resource' },
    ])
  }

  return fields.relation(spec.target)
})

/**
 * `kind` validates as a string and describes itself as the list of kinds this process
 * actually has.
 *
 * The description is what an agent reads: `collections.create` is an MCP tool by
 * generation (ADR-0020), and its schema is the only thing telling a caller what may go
 * here. Published as a bare `string` it left the fifteen legal kinds of SPEC.md §39 to
 * be guessed, which is a tool nobody can use without trying it.
 *
 * The enum is computed when the schema is asked to describe itself, not when this
 * module loads, because a plugin may register a kind before the application is built —
 * a frozen list would publish a kind short or a kind long. Validation stays with
 * `fieldFromSpec`, which is the one place that knows what is registered *now* and which
 * names the offending kind; an enum in the parser would answer the same question a
 * sentence less clearly.
 */
const fieldKindSchema = (): Schema<string> => {
  const inner = string().describe('One of the field kinds this application has registered')

  return {
    ...inner,
    toJsonSchema: () => ({ ...inner.toJsonSchema(), enum: registeredFieldKinds() }),
  }
}

/**
 * How many fields one collection may declare.
 *
 * Not a storage limit — the definition is JSONB and would hold thousands. It is what
 * `/api/_introspection` and `assemora.describe` carry on every load: six thousand
 * fields, which is one accepted `collections.create`, took that document to 1.5 MB and
 * survived every restart, and any holder of `collections.create` could leave it there.
 * Two hundred is far past any editorial shape and far short of a payload that hurts.
 */
const MAX_FIELDS = 200

/**
 * `name` and `label` are `varchar(255)` columns (SPEC.md §38).
 *
 * Without the cap a long name was a `DATABASE_ERROR` — a 500, blaming the server for
 * what the caller sent — and only in production: the memory adapter has no column
 * width, so it stored the name happily and the defect appeared exactly where it was
 * hardest to see (SPEC.md §83, §84).
 */
const COLUMN_LENGTH = 255

/** The shape a stored definition is allowed to have. Declarative JSON, nothing else. */
export const fieldSpecSchema = object({
  name: string().pattern(/^[a-zA-Z][a-zA-Z0-9_]*$/, 'Invalid field name'),
  kind: fieldKindSchema(),
  label: string().optional(),
  help: string().optional(),
  required: boolean().optional(),
  searchable: boolean().optional(),
  sortable: boolean().optional(),
  filterable: boolean().optional(),
  hidden: boolean().optional(),
  readOnly: boolean().optional(),
  options: array(string()).optional(),
  source: string().optional(),
  target: string().optional(),
  agent: object({ read: boolean().optional(), write: boolean().optional() }).optional(),
})

export const definitionSchema = object({
  name: string()
    .pattern(/^[a-z][a-z0-9_]*$/, 'Invalid resource name')
    .max(COLUMN_LENGTH),
  label: string().max(COLUMN_LENGTH).optional(),
  fields: array(fieldSpecSchema).min(1).max(MAX_FIELDS),
})

/** Applies the declarative modifiers of a spec to the field its kind produced. */
export const fieldFromSpec = (spec: FieldSpec): AnyField => {
  const factory = factories.get(spec.kind)

  if (factory === undefined) {
    throw new ValidationError([
      {
        path: ['kind'],
        code: 'unknown_kind',
        message: `"${spec.kind}" is not a known field kind`,
      },
    ])
  }

  let field = factory(spec) as ReturnType<typeof fields.text>

  if (spec.required === true) field = field.required()
  if (spec.searchable === true) field = field.searchable()
  if (spec.sortable === true) field = field.sortable()
  if (spec.filterable === true) field = field.filterable()
  if (spec.hidden === true) field = field.hidden()
  if (spec.readOnly === true) field = field.readOnly()
  if (spec.label !== undefined) field = field.label(spec.label)
  if (spec.help !== undefined) field = field.help(spec.help)
  if (spec.agent !== undefined) field = field.agentAccess(spec.agent)

  return field
}

export const clearFieldKind = (kind: string): void => {
  factories.delete(kind)
}

export { enumOf }
