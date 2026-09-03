/**
 * Checking a block's props against its fields (SPEC.md §55, §56, §60).
 *
 * A block's field names are keys of a plain object, and so are the props a caller
 * sends. `constructor`, `toString`, `valueOf` and `hasOwnProperty` are legal names for
 * both, and every one of them is answered by `Object.prototype` on a record that has
 * never been given the key — which is why nothing here may ask `in`.
 */
import { date, image, link, number, text } from '@assemora/resources'
import { describe, expect, it } from 'vitest'

import { block, describeBlock, validateProps } from './block.js'

const issues = (result: ReturnType<typeof validateProps>) => (result.ok ? [] : result.issues)

describe('how a block says it should be drawn (SPEC.md §58)', () => {
  it('carries an icon and a heading into the registry, as data', () => {
    const described = describeBlock(
      block('hero', { title: text() }, { icon: 'panel-top', group: 'Layout' }),
    )

    expect(described.icon).toBe('panel-top')
    expect(described.group).toBe('Layout')
  })

  it('says neither when neither was said, so a palette that grouped nothing looks as it did', () => {
    const described = describeBlock(block('hero', { title: text() }))

    expect(described.icon).toBeUndefined()
    expect(described.group).toBeUndefined()
  })
})

describe("props checked against a block's fields", () => {
  it('takes what the fields declare and drops nothing it declared', () => {
    const result = validateProps(block('hero', { title: text() }), { title: 'A heading' })

    expect(result).toEqual({ ok: true, value: { title: 'A heading' } })
  })

  /**
   * `!(name in source)` read the *definition's* required field off `Object.prototype`,
   * so a field called `constructor` was never reported missing — it was parsed instead,
   * and the caller was told "Expected a string" about a prop they had not sent.
   */
  it('reports a required field named after a prototype key as missing, not as mistyped', () => {
    const quirk = block('quirk', { constructor: text().required(), title: text() })

    expect(issues(validateProps(quirk, { title: 'A heading' }, 'complete'))).toEqual([
      { path: ['constructor'], code: 'required', message: 'This field is required' },
    ])
  })

  it('still checks such a field when the props do carry it', () => {
    const quirk = block('quirk', { constructor: text().required() })

    expect(validateProps(quirk, { constructor: 'a name like any other' })).toEqual({
      ok: true,
      value: { constructor: 'a name like any other' },
    })
    expect(issues(validateProps(quirk, { constructor: 7 }))[0]?.path).toEqual(['constructor'])
  })

  /**
   * The mirror image: `!(key in definition.fields)` said every block has a field called
   * `toString`, so a prop by that name passed the unknown-key check and was then
   * dropped without a word — mass assignment's quieter half (SPEC.md §85).
   */
  it('refuses a prop that is not a field, whatever it is called', () => {
    const plain = block('plain', { title: text() })
    const refused = issues(validateProps(plain, { title: 'A heading', toString: 'x' }, 'editing'))

    expect(refused).toEqual([
      {
        path: ['toString'],
        code: 'unknown_field',
        message: '"toString" is not a field of the plain block',
      },
    ])
  })
})

/**
 * Reported in the audit as a difference between a block's props and a resource's
 * fields, and confirmed by reproducing it before anything was changed: every kind
 * refused a `null`, answering "Expected a string" for an edit the same field in an
 * entry form performs.
 *
 * `validateAgainstFields` in `@assemora/resources` accepts `null` wherever the value
 * can be held. A block tree is JSON, which holds a `null` under any key, so there is
 * no column here that could refuse — the rule is the same one, and the two now agree.
 */
describe('clearing a block field (#15)', () => {
  const kinds = {
    image: image(),
    number: number(),
    date: date(),
    link: link(),
    text: text(),
  }

  for (const [name, field] of Object.entries(kinds)) {
    it(`clears an optional ${name}`, () => {
      const hero = block('hero', { [name]: field })

      expect(validateProps(hero, { [name]: null }, 'editing')).toEqual({
        ok: true,
        value: { [name]: null },
      })
    })
  }

  it('clears when publishing too, not only while editing', () => {
    // An optional field left empty is a publishable page; `complete` is about
    // *required* fields, and clearing an optional one is not an unfinished block.
    const hero = block('hero', { image: image() })

    expect(validateProps(hero, { image: null }, 'complete')).toEqual({
      ok: true,
      value: { image: null },
    })
  })

  it('still refuses to clear a required field', () => {
    const hero = block('hero', { title: text().required() })

    expect(issues(validateProps(hero, { title: null }, 'complete'))).toEqual([
      { path: ['title'], code: 'type', message: 'Expected a string' },
    ])
  })

  it('still refuses a wrong type that is not null', () => {
    // The guard must clear on `null` only, not wave through anything falsy.
    const hero = block('hero', { count: number() })

    expect(issues(validateProps(hero, { count: 'seven' }, 'editing'))).toEqual([
      { path: ['count'], code: 'type', message: 'Expected a number' },
    ])
  })

  it('does not invent a key for a field that was not sent', () => {
    // Clearing is an explicit `null`; an absent prop stays absent.
    const hero = block('hero', { image: image(), title: text() })

    expect(validateProps(hero, { title: 'A heading' }, 'editing')).toEqual({
      ok: true,
      value: { title: 'A heading' },
    })
  })
})
