/**
 * Nesting inside a stored definition (SPEC.md §37, §38, §39, §86).
 *
 * `object` and `array` had builders and no registration, so a group and a repeater were
 * a TypeScript privilege and a collection made in Studio could have neither. Registering
 * them puts a tree inside untrusted JSON, which is the whole reason the bounds below
 * exist — and why each of them is stated in the refusal rather than left to be found.
 */
import { ValidationError } from '@assemora/core'
import { describe, expect, it } from 'vitest'

import { parseDynamicDefinition } from './dynamic.js'
import {
  countFields,
  type FieldSpec,
  fieldFromSpec,
  fieldSpecSchema,
  MAX_FIELDS,
  MAX_NESTING_DEPTH,
  registeredFieldKinds,
} from './field-registry.js'

const refusal = (build: () => unknown): ValidationError => {
  try {
    build()
  } catch (error) {
    if (error instanceof ValidationError) return error
    throw error
  }

  throw new Error('this was expected to be refused')
}

const collection = (...fields: readonly FieldSpec[]) => ({ name: 'blocks', fields })

describe('the kinds a definition may name', () => {
  it('offers every kind a TypeScript resource has', () => {
    expect(registeredFieldKinds()).toEqual([
      'array',
      'boolean',
      'checkboxes',
      'code',
      'color',
      'date',
      'datetime',
      'email',
      'integer',
      'json',
      'link',
      'markdown',
      'media',
      'number',
      'object',
      'relation',
      'richText',
      'select',
      'slug',
      'table',
      'text',
      'textarea',
      'time',
      'url',
    ])
  })

  it('builds each new kind from JSON alone', () => {
    const parsed = parseDynamicDefinition(
      collection(
        { name: 'rank', kind: 'integer' },
        { name: 'tags', kind: 'checkboxes', options: ['news', 'guide'] },
        { name: 'tint', kind: 'color' },
        { name: 'snippet', kind: 'code', options: ['sql'] },
        { name: 'body', kind: 'markdown' },
        { name: 'opensAt', kind: 'time' },
        { name: 'cta', kind: 'link' },
        { name: 'pricing', kind: 'table' },
        { name: 'cover', kind: 'media', accept: ['image/*'] },
      ),
    )

    expect(parsed.fields.map((field) => field.kind)).toEqual([
      'integer',
      'checkboxes',
      'color',
      'code',
      'markdown',
      'time',
      'link',
      'table',
      'media',
    ])
    expect(fieldFromSpec(parsed.fields[8] as FieldSpec).accept).toEqual(['image/*'])
  })

  it('refuses a checkboxes field with nothing to check', () => {
    expect(
      refusal(() => parseDynamicDefinition(collection({ name: 'tags', kind: 'checkboxes' })))
        .fields['fields.0.options'],
    ).toEqual(['A checkboxes field needs at least one option'])
  })
})

describe('a group and a repeater, made from JSON', () => {
  const author: FieldSpec = {
    name: 'author',
    kind: 'object',
    fields: [
      { name: 'name', kind: 'text', required: true },
      { name: 'site', kind: 'url' },
    ],
  }

  it('groups the fields a definition names', () => {
    const [field] = parseDynamicDefinition(collection(author)).fields
    const built = fieldFromSpec(field as FieldSpec)

    expect(Object.keys(built.shape ?? {})).toEqual(['name', 'site'])
    expect(built.schema.parse({ name: 'Ada' }).ok).toBe(true)
    expect(built.schema.parse({ site: 'https://x.io' }).ok).toBe(false)
  })

  it('repeats the element a definition names', () => {
    const [field] = parseDynamicDefinition(
      collection({
        name: 'people',
        kind: 'array',
        element: { kind: 'object', fields: author.fields ?? [] },
      }),
    ).fields
    const built = fieldFromSpec(field as FieldSpec)

    expect(built.element?.kind).toBe('object')
    expect(built.schema.parse([{ name: 'Ada' }, { name: 'Grace' }]).ok).toBe(true)
    expect(built.schema.parse([{ site: 'https://x.io' }]).ok).toBe(false)
  })

  it('needs the thing it contains, and says why one might be missing', () => {
    expect(
      refusal(() => parseDynamicDefinition(collection({ name: 'author', kind: 'object' }))).fields[
        'fields.0.fields'
      ]?.[0],
    ).toContain(`Nesting is limited to ${MAX_NESTING_DEPTH} levels`)

    expect(
      refusal(() => parseDynamicDefinition(collection({ name: 'people', kind: 'array' }))).fields[
        'fields.0.element'
      ]?.[0],
    ).toContain(`Nesting is limited to ${MAX_NESTING_DEPTH} levels`)
  })

  it('refuses two inner fields of one name, which a shape cannot hold', () => {
    expect(
      refusal(() =>
        parseDynamicDefinition(
          collection({
            name: 'author',
            kind: 'object',
            fields: [
              { name: 'name', kind: 'text' },
              { name: 'name', kind: 'number' },
            ],
          }),
        ),
      ).fields['fields.0.fields.1.name'],
    ).toEqual(['"name" is declared twice'])
  })

  /**
   * The same refusal the builders make, reached through JSON. A `hidden` field inside a
   * group would be published in OpenAPI and returned by every read, because nothing
   * enforces it inside a value — so the definition is refused rather than stored.
   */
  it('refuses a modifier nothing inside a group can enforce, and points at it', () => {
    const failure = refusal(() =>
      parseDynamicDefinition(
        collection({
          name: 'author',
          kind: 'object',
          fields: [{ name: 'secret', kind: 'text', hidden: true }],
        }),
      ),
    )

    expect(Object.keys(failure.fields)).toEqual(['fields.0.fields.0.hidden'])
  })

  it('reports a broken inner field where it is, not where the group is', () => {
    const failure = refusal(() =>
      parseDynamicDefinition(
        collection({
          name: 'author',
          kind: 'object',
          fields: [
            { name: 'name', kind: 'text' },
            { name: 'link', kind: 'relation' },
          ],
        }),
      ),
    )

    expect(failure.fields['fields.0.fields.1.target']).toEqual([
      'A relation field needs a target resource',
    ])
  })
})

describe('the bounds nesting needs, because a definition is untrusted data', () => {
  const nest = (depth: number): FieldSpec =>
    depth === 1
      ? { name: `level${depth}`, kind: 'text' }
      : { name: `level${depth}`, kind: 'object', fields: [nest(depth - 1)] }

  it('takes a definition nested to the bound', () => {
    expect(parseDynamicDefinition(collection(nest(MAX_NESTING_DEPTH))).fields).toHaveLength(1)
  })

  it('refuses one nested past it, and names the bound', () => {
    const failure = refusal(() => parseDynamicDefinition(collection(nest(MAX_NESTING_DEPTH + 1))))

    expect(Object.values(failure.fields).flat()).toContain(
      `Nesting is limited to ${MAX_NESTING_DEPTH} levels`,
    )
  })

  /**
   * The refusal has to be a refusal. `object()` keeps only the keys its shape mentions,
   * so a spec schema that simply did not describe `fields` at the deepest level would
   * accept the definition and store it one level short of what was sent.
   */
  it('does not quietly store a definition one level short', () => {
    const tooDeep = nest(MAX_NESTING_DEPTH + 1)

    expect(() => parseDynamicDefinition(collection(tooDeep))).toThrow(ValidationError)
  })

  it('counts a nested field towards the cap the whole definition shares', () => {
    const inner: FieldSpec[] = Array.from({ length: 100 }, (_, index) => ({
      name: `f${index}`,
      kind: 'text',
    }))

    /**
     * Named, because `countFields` walks both halves of a tree and only one half has
     * names: a group's `fields` are `FieldSpec`, a repeater's `element` is a
     * `FieldShapeSpec`. `FieldShapeSpec` is therefore the parameter — a `FieldSpec` is
     * one plus a name, so it is assignable — and the annotation is what an object
     * literal needs, since the excess-property check fires on a fresh literal and not
     * on a variable of the named type.
     */
    const group: FieldSpec = { name: 'a', kind: 'object', fields: inner }

    expect(countFields([group])).toBe(101)

    const groups: FieldSpec[] = Array.from({ length: 3 }, (_, index) => ({
      name: `g${index}`,
      kind: 'object',
      fields: inner,
    }))

    const failure = refusal(() => parseDynamicDefinition(collection(...groups)))

    expect(failure.fields.fields).toEqual([
      `A collection declares at most ${MAX_FIELDS} fields in total, nested fields included. This one declares 303.`,
    ])
  })

  it('counts an array element too', () => {
    const repeater: FieldSpec = { name: 'a', kind: 'array', element: { kind: 'text' } }

    expect(countFields([repeater])).toBe(2)
  })
})

/**
 * What the depth costs everybody who never asked for it.
 *
 * `MAX_NESTING_DEPTH` reads like a knob, and it is not one. The spec schema is unrolled
 * rather than recursive, and a field spec branches two ways at every level — `fields`
 * and `element` — so the *published* document roughly doubles per level: 7.4 KB at 3,
 * 15.8 KB at 4, 268 KB at 8, 4.3 MB at 12, 68 MB at 16. Sharing the parser graph makes
 * building it linear but cannot help here, because JSON has no sharing.
 *
 * That document is `collections.create`'s input. It ships in `/api/_introspection` on
 * every Studio load and in the MCP `tools/list` payload on every agent connection
 * (ADR-0020), so nobody who nests nothing gets to opt out of it. Nothing measured that
 * before, and raising the constant to 30 left the whole suite green.
 *
 * Two assertions, in this order on purpose. The ceiling is checked first so that a wild
 * value fails with a sentence rather than by exhausting the heap on the line below; the
 * budget is what actually holds the line, and it catches a fat *key* added to the spec
 * shape as well as a raised depth, because both are multiplied by the unrolling.
 */
describe('the published schema the depth is paid for in', () => {
  /**
   * As high as the doubling may go. Not a target — a fourth level costs 8 KB on every
   * introspection request and every `tools/list`, in exchange for a shape no content
   * model draws. Raising this is a decision with an ADR behind it, not an edit.
   */
  const DEEPEST_WORTH_PUBLISHING = 3

  /** 7.4 KB today. The headroom is for another modifier key, not for another level. */
  const BUDGET = 12 * 1024

  /**
   * One test rather than two, and the assertions in this order on purpose: serializing
   * the schema is the expensive act, so the depth is checked before anything asks for
   * it. Split across two tests the second would still run after the first failed, and a
   * raised constant would report as a dead worker instead of as a sentence.
   */
  it('stays inside what every reader can be asked to carry, and still describes itself', () => {
    expect(MAX_NESTING_DEPTH).toBeLessThanOrEqual(DEEPEST_WORTH_PUBLISHING)

    const published = fieldSpecSchema.toJsonSchema()

    expect(JSON.stringify(published).length).toBeLessThanOrEqual(BUDGET)

    // Unrolled, not a `$ref` — an SDK generator prints `unknown` for one of those, and
    // the point of publishing this at all is that an agent can read the nesting.
    const at = (...path: readonly string[]): Record<string, unknown> =>
      path.reduce<Record<string, unknown>>(
        (current, key) => (current[key] ?? {}) as Record<string, unknown>,
        published as Record<string, unknown>,
      )

    expect(at('properties', 'fields', 'items', 'properties', 'name')).toMatchObject({
      type: 'string',
    })
    expect(at('properties', 'element', 'properties', 'kind')).toMatchObject({ type: 'string' })
  })
})
