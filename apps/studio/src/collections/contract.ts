/**
 * What the application says a collection definition may look like (SPEC.md §37, §39).
 *
 * A definition names a field *kind*, and only a kind the application registered can be
 * built from one — so the list of kinds belongs to the application, and this asks for
 * it in the one place the application publishes it: the JSON Schema of
 * `collections.create`, generated from the same declaration the command validates
 * against. The two name patterns and the nesting depth are read from there as well, so
 * the rule a form enforces and the rule a command enforces cannot drift apart.
 *
 * Everything below that is *not* read from the schema is a stand-in with a reason: the
 * schema declares `kind` as an enum but says nothing about which kinds need an option
 * list, which may not appear inside a group, or how they are worth grouping in a
 * dropdown. Those are stated here, and `contract.test.ts` is what fails when one of them
 * drifts from `@assemora/resources` — the same relation `src/api/permissions.ts` stands
 * in to `@assemora/auth`.
 */
import type { CommandDescriptor } from '../api/introspection.ts'
import type { MessageKey } from '../i18n/messages.ts'

/**
 * The field kinds `@assemora/resources` registers, in the order `FieldKind` declares
 * them.
 *
 * Used only when the application publishes no enum of its own, which no current one
 * does: `collections.create` describes `kind` as the kinds *this process* has
 * registered, plugins included, and `kindsOf` prefers that. A plugin's kind cannot be
 * here and does not need to be.
 */
export const KINDS = [
  'text',
  'textarea',
  'richText',
  'markdown',
  'code',
  'number',
  'integer',
  'boolean',
  'date',
  'datetime',
  'time',
  'select',
  'checkboxes',
  'color',
  'json',
  'slug',
  'url',
  'link',
  'email',
  'media',
  'relation',
  'table',
  'object',
  'array',
] as const

/** What a collection may be called, when the command does not say. */
export const NAME_PATTERN = '^[a-z][a-z0-9_]*$'

/** What a field may be called, when the command does not say. */
export const FIELD_NAME_PATTERN = '^[a-zA-Z][a-zA-Z0-9_]*$'

/**
 * How many levels of fields a definition may have, when the command does not say.
 *
 * `MAX_NESTING_DEPTH` in `@assemora/resources`. Three is a repeater of groups of fields
 * — `array(object({ … }))` — and the command publishes it, so `nestingDepthOf` reads it
 * rather than trusting this.
 */
export const NESTING_DEPTH = 3

/**
 * Where the walk below gives up.
 *
 * The published schema is unrolled to a finite depth and cannot be cyclic, but this
 * reads a document the application wrote and a loop over one is a frozen tab.
 */
const DEEPEST = 8

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/** Walks a JSON Schema by key, giving up quietly the moment the shape is not one. */
const at = (value: unknown, ...path: readonly string[]): unknown =>
  path.reduce<unknown>((current, key) => (isRecord(current) ? current[key] : undefined), value)

const stringsOf = (value: unknown): readonly string[] | undefined =>
  Array.isArray(value) && value.length > 0 && value.every((entry) => typeof entry === 'string')
    ? (value as readonly string[])
    : undefined

const patternOf = (value: unknown): string | undefined =>
  typeof value === 'string' && value !== '' ? value : undefined

/** Where one field's shape sits inside the command's input schema. */
const FIELD = ['properties', 'fields', 'items', 'properties'] as const

/** Where the fields of a group sit inside one field's shape. */
const INSIDE = ['fields', 'items', 'properties'] as const

export const kindsOf = (create: CommandDescriptor | undefined): readonly string[] =>
  stringsOf(at(create?.input, ...FIELD, 'kind', 'enum')) ?? KINDS

export const namePatternOf = (create: CommandDescriptor | undefined): string =>
  patternOf(at(create?.input, 'properties', 'name', 'pattern')) ?? NAME_PATTERN

export const fieldNamePatternOf = (create: CommandDescriptor | undefined): string =>
  patternOf(at(create?.input, ...FIELD, 'name', 'pattern')) ?? FIELD_NAME_PATTERN

/**
 * How deep this application lets a definition nest, counted off its own schema.
 *
 * The schema is *unrolled* rather than self-referential — `shapeSpecAt` in
 * `@assemora/resources` writes out one level per depth and puts a schema that always
 * refuses at the bottom — so the depth is a thing that can be counted rather than
 * guessed. Counting it is what keeps the form's bound and the parser's the same number:
 * the form stops offering a group exactly where the command would start refusing one.
 */
export const nestingDepthOf = (create: CommandDescriptor | undefined): number => {
  let shape = at(create?.input, ...FIELD)
  let depth = 0

  while (isRecord(shape) && depth < DEEPEST) {
    depth += 1

    const inner = at(shape, ...INSIDE)

    if (!isRecord(inner)) break

    shape = inner
  }

  return depth === 0 ? NESTING_DEPTH : depth
}

/**
 * The one thing a kind needs besides a name.
 *
 * Seven kinds are not built from their name alone. The rest — and every kind Studio has
 * never heard of, which is how a plugin's arrives — need nothing, and the command says
 * so if it turns out they do.
 *
 * `table` is deliberately absent, and it is the one worth explaining: a table's columns
 * are part of its *value*, not of its schema. That is the whole reason it is a kind
 * rather than an `array(object(…))` — there a developer fixes the columns, here an
 * editor adds one to a pricing table without a deployment. A "columns" control on this
 * form would be a control the command ignores.
 */
export type KindNeed =
  /** `select`, `checkboxes`: the values, at least one. */
  | 'options'
  /** `code`: the languages offered. None means any language. */
  | 'languages'
  /** `slug`: the field it is made from. */
  | 'source'
  /** `relation`: the resource it points at. */
  | 'target'
  /** `media`: the media types its picker offers. None means any file. */
  | 'accept'
  /** `object`: the fields it groups. */
  | 'fields'
  /** `array`: the field one item is. */
  | 'element'

const NEEDS: Readonly<Record<string, KindNeed>> = {
  select: 'options',
  checkboxes: 'options',
  code: 'languages',
  slug: 'source',
  relation: 'target',
  media: 'accept',
  object: 'fields',
  array: 'element',
}

export const needOf = (kind: string): KindNeed | undefined => NEEDS[kind]

/** The kinds that hold other fields, and so are what a depth limit is about. */
export const CONTAINERS: readonly string[] = ['object', 'array']

/**
 * The kinds that mean nothing inside a group or as a repeater's element.
 *
 * `slug` derives from another field *of the resource*, so inside a group its source
 * names something no derivation will ever read — `nestingIssues` in `@assemora/resources`
 * refuses it. Every other refusal there is about a modifier rather than a kind, and a
 * nested row offers none of those modifiers.
 */
const NOT_NESTABLE: readonly string[] = ['slug']

/**
 * The kinds a field at this depth may be.
 *
 * A group or a repeater is offered only where one can still hold something: at the
 * deepest level the command accepts the *keys* and refuses any value under them, on
 * purpose — leaving them out of the schema would have let a too-deep definition through
 * and stored it one level short. So the form stops offering them one level earlier,
 * which is the same rule seen from the other side.
 */
export const kindsAt = (
  kinds: readonly string[],
  depth: number,
  maxDepth: number,
  nested: boolean,
): readonly string[] =>
  kinds.filter(
    (kind) =>
      !(nested && NOT_NESTABLE.includes(kind)) && !(depth >= maxDepth && CONTAINERS.includes(kind)),
  )

/**
 * How the kinds are grouped in the picker, and nothing else.
 *
 * Presentation, and therefore allowed to be incomplete: a kind this does not name — a
 * plugin's, or one added after it was written — is offered under "Other" rather than
 * left out. The application still decides which kinds exist; this only decides the order
 * they are read in, because two dozen options in one flat list is a list nobody reads to
 * the end.
 */
const GROUPS = [
  ['collections.kinds.text', ['text', 'textarea', 'richText', 'markdown', 'code', 'slug']],
  ['collections.kinds.numbers', ['number', 'integer', 'boolean']],
  ['collections.kinds.choices', ['select', 'checkboxes', 'color']],
  ['collections.kinds.dates', ['date', 'datetime', 'time']],
  ['collections.kinds.links', ['url', 'link', 'email', 'media', 'relation']],
  ['collections.kinds.several', ['object', 'array', 'table', 'json']],
] as const satisfies readonly (readonly [MessageKey, readonly string[]])[]

/**
 * A heading is named rather than written, because the picker that draws it is drawn in
 * the language of whoever opened Studio. The set is closed — these six and `Other` —
 * so it is a union of keys rather than `MessageKey`, which `t` could not be called with.
 */
export type KindGroupLabel = (typeof GROUPS)[number][0] | 'collections.kinds.other'

export type KindGroup = {
  readonly label: KindGroupLabel
  readonly kinds: readonly string[]
}

export const groupedKinds = (kinds: readonly string[]): readonly KindGroup[] => {
  const placed = new Set<string>()

  const groups = GROUPS.map(([label, members]): KindGroup => {
    const held = members.filter((kind) => kinds.includes(kind))

    for (const kind of held) placed.add(kind)

    return { label, kinds: held }
  }).filter((group) => group.kinds.length > 0)

  const rest = kinds.filter((kind) => !placed.has(kind))

  return rest.length === 0 ? groups : [...groups, { label: 'collections.kinds.other', kinds: rest }]
}
