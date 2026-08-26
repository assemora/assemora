/**
 * The field registry (SPEC.md §39, §86).
 *
 * A dynamic resource definition is untrusted data. It names a field *kind*, and only
 * a kind registered here can be built from it — there is no path from a definition
 * to executable code, which is the whole point of §86.
 */
import { ValidationError } from '@assemora/core'
import { array, boolean, enumOf, object, string } from '@assemora/schema'
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

/** The shape a stored definition is allowed to have. Declarative JSON, nothing else. */
export const fieldSpecSchema = object({
  name: string().pattern(/^[a-zA-Z][a-zA-Z0-9_]*$/, 'Invalid field name'),
  kind: string(),
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
  name: string().pattern(/^[a-z][a-z0-9_]*$/, 'Invalid resource name'),
  label: string().optional(),
  fields: array(fieldSpecSchema).min(1),
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
