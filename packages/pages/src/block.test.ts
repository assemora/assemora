/**
 * Checking a block's props against its fields (SPEC.md §55, §56, §60).
 *
 * A block's field names are keys of a plain object, and so are the props a caller
 * sends. `constructor`, `toString`, `valueOf` and `hasOwnProperty` are legal names for
 * both, and every one of them is answered by `Object.prototype` on a record that has
 * never been given the key — which is why nothing here may ask `in`.
 */
import { text } from '@assemora/resources'
import { describe, expect, it } from 'vitest'

import { block, validateProps } from './block.js'

const issues = (result: ReturnType<typeof validateProps>) => (result.ok ? [] : result.issues)

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
