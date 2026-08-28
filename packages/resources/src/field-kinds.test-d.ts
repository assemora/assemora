/**
 * What the new kinds infer, and what they refuse to compile.
 *
 * A composite field whose value is `unknown` teaches the SDK, OpenAPI and an agent
 * nothing, so the type each one produces is asserted here rather than assumed.
 */
import { describe, expectTypeOf, it } from 'vitest'

import {
  array,
  checkboxes,
  code,
  color,
  integer,
  type LinkValue,
  link,
  markdown,
  object,
  type TableValue,
  table,
  text,
  time,
} from './fields.js'

/** The documentation example, compiled: a section of a page, declared once. */
const section = object({
  heading: text().required().label('Heading'),
  tint: color(),
  opensAt: time(),
  cta: link(),
  tags: checkboxes('news', 'guide'),
})

const parse = <T>(field: { schema: { parse(value: unknown): { ok: boolean; value?: T } } }) =>
  field.schema.parse({})

describe('what each kind holds', () => {
  it('gives a whole number and a piece of text their own types', () => {
    const rank = parse<number>(integer())
    const body = parse<string>(markdown())

    if (rank.ok) expectTypeOf(rank.value).toEqualTypeOf<number | undefined>()
    if (body.ok) expectTypeOf(body.value).toEqualTypeOf<string | undefined>()
  })

  it('types checkboxes by the values declared, the way select does', () => {
    const tags = checkboxes('news', 'guide')
    const result = tags.schema.parse(['news'])

    if (result.ok) expectTypeOf(result.value).toEqualTypeOf<('news' | 'guide')[]>()
  })

  it('types code as both of its halves', () => {
    const result = code().schema.parse({})

    if (result.ok) {
      expectTypeOf(result.value.language).toEqualTypeOf<string>()
      expectTypeOf(result.value.source).toEqualTypeOf<string>()
    }
  })

  it('types a table as its columns and its rows of text', () => {
    const result = table().schema.parse({})

    if (result.ok) expectTypeOf(result.value).toEqualTypeOf<TableValue>()
  })

  /**
   * The tag is what a reader switches on, and the type says so: inside the `url` branch
   * the URL is present and the entry reference does not exist at all.
   */
  it('narrows a link on the tag it carries', () => {
    const result = link().schema.parse({})

    if (result.ok) {
      expectTypeOf(result.value).toEqualTypeOf<LinkValue>()

      if (result.value.type === 'url') {
        expectTypeOf(result.value.url).toEqualTypeOf<string>()

        // @ts-expect-error a link of type "url" has no entry reference
        result.value.entry
      } else {
        expectTypeOf(result.value.entry.resource).toEqualTypeOf<string>()
      }
    }
  })

  it('types a group by the fields it groups', () => {
    const result = section.schema.parse({})

    if (result.ok) {
      expectTypeOf(result.value.heading).toEqualTypeOf<string | undefined>()
      expectTypeOf(result.value.tags).toEqualTypeOf<('news' | 'guide')[] | undefined>()

      // @ts-expect-error `subtitle` is not one of the fields the group declares
      result.value.subtitle
    }
  })

  it('types a repeater by what it repeats', () => {
    const result = array(object({ heading: text() })).schema.parse([])

    if (result.ok) {
      expectTypeOf(result.value[0]?.heading).toEqualTypeOf<string | undefined>()
    }
  })
})

describe('invalid usage does not compile', () => {
  it('rejects a group whose member is a schema rather than a field', () => {
    // @ts-expect-error a group is built from fields, which carry a label and a kind
    object({ heading: 'text' })
  })

  it('rejects checkboxes with no values to check', () => {
    // @ts-expect-error a checkboxes field is its list, and an empty list is not one
    checkboxes()
  })
})
