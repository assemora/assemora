import { describe, expect, it } from 'vitest'

import { changedFields, diff } from './patch.js'

describe('what changed', () => {
  it('reports only the fields that differ', () => {
    expect(diff({ title: 'One', views: 5 }, { title: 'Two', views: 5 })).toEqual({
      title: { from: 'One', to: 'Two' },
    })
  })

  it('reports a field that appeared and one that went away', () => {
    expect(diff({ a: 1 }, { b: 2 })).toEqual({
      a: { from: 1, to: undefined },
      b: { from: undefined, to: 2 },
    })
  })

  it('compares nested values by content, not by identity', () => {
    expect(diff({ meta: { a: 1 } }, { meta: { a: 1 } })).toEqual({})
    expect(diff({ meta: { a: 1 } }, { meta: { a: 2 } })).toEqual({
      meta: { from: { a: 1 }, to: { a: 2 } },
    })
  })

  it('compares dates by their moment', () => {
    const moment = new Date('2026-08-26T10:00:00.000Z')

    expect(diff({ at: moment }, { at: new Date(moment) })).toEqual({})
  })

  it('treats a creation and a deletion as whole-record changes', () => {
    expect(changedFields(diff(null, { title: 'New' }))).toEqual(['title'])
    expect(changedFields(diff({ title: 'Gone' }, null))).toEqual(['title'])
  })

  it('says nothing changed when nothing did', () => {
    expect(diff({ a: 1 }, { a: 1 })).toEqual({})
    expect(changedFields(diff(null, null))).toEqual([])
  })
})
