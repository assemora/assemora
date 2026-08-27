/**
 * What the application says a collection definition may look like (SPEC.md §37, §39).
 *
 * A definition names a field *kind*, and only a kind the application registered can be
 * built from one — so the list of kinds belongs to the application, and this asks for
 * it in the one place the application publishes it: the JSON Schema of
 * `collections.create`, generated from the same declaration the command validates
 * against. The two name patterns are read from there as well, so the rule a form
 * enforces and the rule a command enforces cannot drift apart.
 *
 * The kinds are the exception, and the reason is worth writing down. `fieldSpecSchema`
 * in `@assemora/resources` declares `kind` as a plain string rather than as an enum of
 * the registered kinds, so the schema says nothing about which are legal. Until it
 * does, `KINDS` below stands in — and it is the *registered* kinds, not the sixteen
 * names of SPEC.md §39: `object` and `array` are kinds a TypeScript resource declares
 * and a stored definition cannot, because neither can be built from JSON without a
 * shape to build, and offering one here would put an option in the form that the
 * command refuses every time. The moment the schema carries an enum, this is read
 * from it and the list goes.
 */
import type { CommandDescriptor } from '../api/introspection.ts'

/**
 * The field kinds `@assemora/resources` registers, in the order SPEC.md §39 lists them.
 *
 * A plugin's kind is not here and cannot be, which is the cost of the schema not
 * declaring them. It is used only when the application publishes no enum of its own.
 */
export const KINDS = [
  'text',
  'textarea',
  'richText',
  'number',
  'boolean',
  'date',
  'datetime',
  'select',
  'json',
  'slug',
  'url',
  'email',
  'media',
  'relation',
] as const

/** What a collection may be called, when the command does not say. */
export const NAME_PATTERN = '^[a-z][a-z0-9_]*$'

/** What a field may be called, when the command does not say. */
export const FIELD_NAME_PATTERN = '^[a-zA-Z][a-zA-Z0-9_]*$'

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

export const kindsOf = (create: CommandDescriptor | undefined): readonly string[] =>
  stringsOf(at(create?.input, ...FIELD, 'kind', 'enum')) ?? KINDS

export const namePatternOf = (create: CommandDescriptor | undefined): string =>
  patternOf(at(create?.input, 'properties', 'name', 'pattern')) ?? NAME_PATTERN

export const fieldNamePatternOf = (create: CommandDescriptor | undefined): string =>
  patternOf(at(create?.input, ...FIELD, 'name', 'pattern')) ?? FIELD_NAME_PATTERN

/**
 * The one thing a kind needs besides a name.
 *
 * Three kinds are not built from their name alone: a select is its options, a slug is
 * the field it is made from, a relation is what it points at. Every other kind — and
 * every kind Studio has never heard of, which is how a plugin's arrives — needs
 * nothing, and the command says so if it turns out to need something after all.
 */
export type KindNeed = 'options' | 'source' | 'target'

const NEEDS: Readonly<Record<string, KindNeed>> = {
  select: 'options',
  slug: 'source',
  relation: 'target',
}

export const needOf = (kind: string): KindNeed | undefined => NEEDS[kind]
