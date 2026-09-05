import { describe, expect, it } from 'vitest'

import { holds } from './visible.ts'

describe('when a section is shown', () => {
  it('always, without a condition', () => {
    expect(holds(undefined, {})).toBe(true)
  })

  it('while a field equals the value, and not before it is filled in', () => {
    const when = { field: 'fulfilment', equals: 'delivery' } as const

    expect(holds(when, { fulfilment: 'delivery' })).toBe(true)
    expect(holds(when, { fulfilment: 'pickup' })).toBe(false)
    expect(holds(when, {})).toBe(false)
  })

  it('reads a boolean field as its own switch', () => {
    expect(holds({ field: 'featured', equals: true }, { featured: true })).toBe(true)
    expect(holds({ field: 'featured', equals: false }, {})).toBe(false)
  })

  it('takes null to mean not filled in yet', () => {
    expect(holds({ field: 'cover', equals: null }, {})).toBe(true)
    expect(holds({ field: 'cover', equals: null }, { cover: 'abc' })).toBe(false)
  })

  it('takes present to mean anything but empty', () => {
    const when = { field: 'notes', present: true } as const

    expect(holds(when, { notes: 'x' })).toBe(true)
    expect(holds(when, { notes: '  ' })).toBe(false)
    expect(holds(when, { notes: [] })).toBe(false)
    expect(holds(when, { notes: false })).toBe(false)
  })
})
