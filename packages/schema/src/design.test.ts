import { describe, expect, it } from 'vitest'

import { blockDesign, hiddenOnViewport, isPlainDesign } from './design.js'

const parse = (value: unknown) => blockDesign().parse(value)

describe('universal design controls (SPEC.md §61)', () => {
  it('accepts the seven controls, all of them optional', () => {
    const result = parse({
      spacingTop: 'lg',
      spacingBottom: 'none',
      width: 'wide',
      align: 'center',
      background: 'surface-sunken',
      container: 'narrow',
      hiddenOn: ['mobile'],
    })

    expect(result.ok).toBe(true)
    expect(parse({}).ok).toBe(true)
  })

  it('refuses a value that is not on the scale', () => {
    expect(parse({ spacingTop: '17px' }).ok).toBe(false)
    expect(parse({ width: '80%' }).ok).toBe(false)
    expect(parse({ hiddenOn: ['watch'] }).ok).toBe(false)
  })

  it('refuses a background that is a colour rather than a token (SPEC.md §62)', () => {
    expect(parse({ background: '#ff0000' }).ok).toBe(false)
    expect(parse({ background: 'red; position: fixed' }).ok).toBe(false)
    expect(parse({ background: 'brand-muted' }).ok).toBe(true)
  })

  it('drops anything it was not asked for', () => {
    const result = parse({ width: 'full', onclick: 'alert(1)' })

    expect(result.ok && result.value).toEqual({ width: 'full' })
  })

  it('knows when nothing has been set', () => {
    expect(isPlainDesign(undefined)).toBe(true)
    expect(isPlainDesign({})).toBe(true)
    expect(isPlainDesign({ width: 'full' })).toBe(false)
  })

  it('answers where a block is not drawn', () => {
    expect(hiddenOnViewport({ hiddenOn: ['mobile'] }, 'mobile')).toBe(true)
    expect(hiddenOnViewport({ hiddenOn: ['mobile'] }, 'desktop')).toBe(false)
    expect(hiddenOnViewport(undefined, 'desktop')).toBe(false)
  })
})
