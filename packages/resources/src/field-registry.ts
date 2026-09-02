/**
 * The field registry (SPEC.md §39, §86).
 *
 * A dynamic resource definition is untrusted data. It names a field *kind*, and only
 * a kind registered here can be built from it — there is no path from a definition
 * to executable code, which is the whole point of §86.
 */
import { ValidationError } from '@assemora/core'
import {
  array,
  boolean,
  enumOf,
  type Issue,
  type OptionalSchema,
  object,
  ok,
  type Schema,
  type Shape,
  string,
} from '@assemora/schema'
import type { AnyField, FieldKind } from './fields.js'
import * as fields from './fields.js'

/**
 * What a stored definition says about one field, minus its name.
 *
 * An array's element is a field with no name — there is nothing to key it by — and it
 * is otherwise a field like any other, so it is this type and a named one is this type
 * plus a name. One shape means one parser, one set of modifiers and one `fieldFromSpec`.
 */
export type FieldShapeSpec = {
  readonly kind: FieldKind
  readonly label?: string
  readonly help?: string
  readonly required?: boolean
  readonly searchable?: boolean
  readonly sortable?: boolean
  readonly filterable?: boolean
  readonly hidden?: boolean
  readonly readOnly?: boolean
  /** `select` and `checkboxes`: the values. `code`: the languages offered. */
  readonly options?: readonly string[]
  /** `slug` only. */
  readonly source?: string
  /** `relation` and `media` only. */
  readonly target?: string
  /** `media` only: the media types its picker offers. */
  readonly accept?: readonly string[]
  /** `object` only: the fields it groups. */
  readonly fields?: readonly FieldSpec[]
  /** `array` only: the field one item is. */
  readonly element?: FieldShapeSpec
  readonly agent?: { readonly read?: boolean; readonly write?: boolean }
}

export type FieldSpec = FieldShapeSpec & { readonly name: string }

export type FieldFactory = (spec: FieldShapeSpec) => AnyField

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
  'integer',
  simple(() => fields.integer()),
)
registerFieldKind(
  'color',
  simple(() => fields.color()),
)
registerFieldKind(
  'markdown',
  simple(() => fields.markdown()),
)
registerFieldKind(
  'time',
  simple(() => fields.time()),
)
registerFieldKind(
  'link',
  simple(() => fields.link()),
)
registerFieldKind(
  'table',
  simple(() => fields.table()),
)

registerFieldKind('media', (spec) => fields.media(...(spec.accept ?? [])))

/** A kind that is its list of values: refusing an empty one says which key is missing. */
const chosenFrom = (spec: FieldShapeSpec, what: string): readonly [string, ...string[]] => {
  const [first, ...rest] = spec.options ?? []

  if (first === undefined) {
    throw new ValidationError([
      { path: ['options'], code: 'required', message: `A ${what} field needs at least one option` },
    ])
  }

  return [first, ...rest]
}

registerFieldKind('select', (spec) => fields.select(...chosenFrom(spec, 'select')))

registerFieldKind('checkboxes', (spec) => fields.checkboxes(...chosenFrom(spec, 'checkboxes')))

// Unlike `select`, no options at all is the ordinary case: it means any language.
registerFieldKind('code', (spec) => fields.code(...(spec.options ?? [])))

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
export const MAX_FIELDS = 200

/**
 * How far a definition may nest.
 *
 * Three levels is a repeater of groups of fields — `array(object({ … }))` — which is
 * every content model anybody has ever drawn on a whiteboard, and one more than the
 * Studio form can lay out without becoming an outline view. Nothing about JSONB stops a
 * definition nesting for ever, and a definition is untrusted data (SPEC.md §86), so the
 * bound is here and it is stated in the refusal rather than left to be discovered.
 *
 * It also keeps the published JSON Schema finite. The spec schema below is *unrolled*
 * to this depth instead of referring to itself, so `collections.create` describes its
 * own nesting to an agent (ADR-0020) and `toJsonSchema()` terminates.
 *
 * **This is a bound, not a setting.** A field spec branches two ways at every level —
 * `fields` and `element` — so the unrolled document roughly doubles per level, and JSON
 * has no sharing to take that back:
 *
 * ```text
 * 3 →   7.4 KB      6 →  66 KB      9 →  535 KB     12 →  4.3 MB
 * 4 →  15.8 KB      7 → 133 KB     10 →  1.0 MB     16 →   68 MB
 * 5 →  32.6 KB      8 → 268 KB     11 →  2.1 MB
 * ```
 *
 * That document is `/api/_introspection` on every Studio load and the MCP `tools/list`
 * payload on every agent connection, so a fourth level is 8 KB paid by every reader on
 * every request in exchange for a shape nobody draws. `nesting.test.ts` measures the
 * published schema against a budget, which is what turns "reads as tunable" into "goes
 * red when tuned".
 */
export const MAX_NESTING_DEPTH = 3

/**
 * `name` and `label` are `varchar(255)` columns (SPEC.md §38).
 *
 * Without the cap a long name was a `DATABASE_ERROR` — a 500, blaming the server for
 * what the caller sent — and only in production: the memory adapter has no column
 * width, so it stored the name happily and the defect appeared exactly where it was
 * hardest to see (SPEC.md §83, §84).
 */
const COLUMN_LENGTH = 255

const TOO_DEEP = `Nesting is limited to ${MAX_NESTING_DEPTH} levels`

/**
 * The floor of the unrolled spec schema: present, and refusing.
 *
 * The key has to still be *there* at the deepest level, because `object()` drops a key
 * its shape does not mention — so leaving it out would take a definition that nests too
 * far, accept it, and store it one level short of what the caller sent. Silently losing
 * a field is the worst of the three possible answers.
 */
const noDeeper = (): OptionalSchema<never> => ({
  kind: 'unknown',
  isOptional: true,
  isNullable: false,
  description: TOO_DEEP,
  parse: (value: unknown) =>
    value === undefined
      ? ok(undefined)
      : { ok: false, issues: [{ path: [], code: 'too_deep', message: TOO_DEEP }] },
  toJsonSchema: () => ({ description: TOO_DEEP, not: {} }),
})

const fieldName = () => string().pattern(/^[a-zA-Z][a-zA-Z0-9_]*$/, 'Invalid field name')

/**
 * A field spec's shape, plus the name a keyed field carries and an element does not.
 *
 * The return type is written out rather than inferred, and that is not decoration: it
 * *checks* the unrolling, asserting that what a definition parses to is the `FieldSpec`
 * the rest of this package is written against, so a key added to one and forgotten in
 * the other stops compiling.
 */
const namedSpec = (shape: Shape): Schema<FieldSpec> =>
  object({ name: fieldName(), ...shape }) as Schema<FieldSpec>

/**
 * Everything a field spec says except its name, at one level of nesting.
 *
 * The deeper shape is built *once* and handed to both `fields` and `element`. A spec is
 * described identically whichever way it was reached — a group's field and a repeater's
 * element differ only by the name — and asking for it twice made this branch twice per
 * level, so building the schema cost 2^MAX_NESTING_DEPTH shapes to describe
 * MAX_NESTING_DEPTH of them. It is one shape per level now, and the recursion is finite
 * because each call is one level deeper and `MAX_NESTING_DEPTH` stops it.
 *
 * What the *serialized* document costs is a separate question, and sharing does not
 * answer it: JSON has no sharing, so the published schema still doubles with every
 * level. That is what the budget in `nesting.test.ts` holds.
 */
const shapeSpecAt = (depth: number): Shape => {
  const deeper = depth < MAX_NESTING_DEPTH ? shapeSpecAt(depth + 1) : undefined

  return {
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
    accept: array(string()).optional(),
    agent: object({ read: boolean().optional(), write: boolean().optional() }).optional(),
    fields:
      deeper === undefined
        ? noDeeper()
        : array(namedSpec(deeper)).min(1).max(MAX_FIELDS).optional(),
    element: deeper === undefined ? noDeeper() : object(deeper).optional(),
  }
}

/** The shape a stored definition is allowed to have. Declarative JSON, nothing else. */
export const fieldSpecSchema: Schema<FieldSpec> = namedSpec(shapeSpecAt(1))

/**
 * What a resource is drawn as, wherever it is listed (SPEC.md §58).
 *
 * A *name*, and never a picture: an icon set belongs to whatever is drawing, and Studio
 * is a pre-built artifact whose icons ship inside it (ADR-0027). So this validates the
 * shape of a name and nothing more — the drawer holds the set, offers the ones it has,
 * and falls back to a general one for a name it does not know. The alternative is an
 * enum in the framework that has to be edited every time a client learns a new glyph,
 * and a picture in a definition, which is a stylesheet arriving through the field layer.
 *
 * Kebab-case because that is how the set Studio ships names its own: `shopping-cart`,
 * `map-pin`. Unsaid, a resource is drawn as a document, which is what every one of them
 * looked like before.
 */
const iconNameSchema = string()
  .pattern(/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/, 'Invalid icon name')
  .max(64)
  .describe(
    'What this resource is drawn as in a client that lists it — a name from the set that client ships, such as "shopping-cart". Unknown names fall back to a general document icon (SPEC.md §58)',
  )

export const definitionSchema = object({
  name: string()
    .pattern(/^[a-z][a-z0-9_]*$/, 'Invalid resource name')
    .max(COLUMN_LENGTH),
  label: string().max(COLUMN_LENGTH).optional(),
  icon: iconNameSchema.optional(),
  fields: array(fieldSpecSchema).min(1).max(MAX_FIELDS),
})

/**
 * Every field a definition declares, nested ones counted.
 *
 * `definitionSchema` caps the outermost list, and that cap used to be the whole bound.
 * With nesting it is one two-hundredth of one: two hundred groups of two hundred
 * repeaters is a definition served on every introspection request for ever, from one
 * accepted `collections.create`. So the cap is on the total, and this is what counts it.
 */
export const countFields = (specs: readonly FieldShapeSpec[]): number =>
  specs.reduce(
    (total, spec) =>
      total +
      1 +
      countFields(spec.fields ?? []) +
      (spec.element === undefined ? 0 : countFields([spec.element])),
    0,
  )

/** Applies the declarative modifiers of a spec to the field its kind produced. */
export const fieldFromSpec = (spec: FieldShapeSpec): AnyField => {
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

/** Re-addresses a nested field's issues into the container's coordinate space. */
const under = (path: readonly (string | number)[], error: unknown): readonly Issue[] =>
  (error instanceof ValidationError ? error.issues : []).map((issue) => ({
    ...issue,
    path: [...path, ...issue.path],
  }))

/**
 * The two kinds a collection could not have, and a static resource could.
 *
 * `object` and `array` had builders and no registration, so a group and a repeater —
 * the two shapes every real content model needs — were a TypeScript privilege. Nothing
 * about them resisted being registered; there was simply no answer yet to what a
 * definition should *say* for one, and no bound on how far it could say it.
 *
 * They call `fieldFromSpec` per inner spec and hand the result to the same `object()`
 * and `array()` a TypeScript resource uses, so a group made in Studio and a group
 * declared in source are the same field and not two implementations that agree today.
 * Every rule those builders enforce — a hidden field inside a group is refused, and so
 * is a slug — therefore applies here without being restated.
 */
registerFieldKind('object', (spec) => {
  const inner = spec.fields ?? []

  if (inner.length === 0) {
    throw new ValidationError([
      {
        path: ['fields'],
        code: 'required',
        message: `An object field needs the fields it groups. ${TOO_DEEP}, so a field at the deepest level cannot be one.`,
      },
    ])
  }

  const shape: Record<string, AnyField> = {}
  const issues: Issue[] = []

  for (const [index, field] of inner.entries()) {
    if (Object.hasOwn(shape, field.name)) {
      issues.push({
        path: ['fields', index, 'name'],
        code: 'duplicate',
        message: `"${field.name}" is declared twice`,
      })
      continue
    }

    try {
      shape[field.name] = fieldFromSpec(field)
    } catch (error) {
      issues.push(...under(['fields', index], error))
    }
  }

  if (issues.length > 0) throw new ValidationError(issues)

  try {
    return fields.object(shape)
  } catch (error) {
    // `object()` refuses by the inner field's *name*, which is how a TypeScript
    // declaration reads. A definition addresses the same field by its position in the
    // list, and an issue path that does not lead to the offending key is a path nobody
    // can act on.
    const order = inner.map((field) => field.name)

    throw new ValidationError(
      (error instanceof ValidationError ? error.issues : []).map((issue) => {
        const [head, ...rest] = issue.path
        const index = order.indexOf(String(head))

        return index === -1 ? issue : { ...issue, path: ['fields', index, ...rest] }
      }),
    )
  }
})

registerFieldKind('array', (spec) => {
  const element = spec.element

  if (element === undefined) {
    throw new ValidationError([
      {
        path: ['element'],
        code: 'required',
        message: `An array field needs the field one item is. ${TOO_DEEP}, so a field at the deepest level cannot be one.`,
      },
    ])
  }

  let built: AnyField

  try {
    built = fieldFromSpec(element)
  } catch (error) {
    throw new ValidationError(under(['element'], error))
  }

  // `array()` refuses on its own account with `element` already at the head of the
  // path, so it is not wrapped again.
  return fields.array(built)
})

export const clearFieldKind = (kind: string): void => {
  factories.delete(kind)
}

export { enumOf }
