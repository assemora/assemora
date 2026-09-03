/**
 * What a listing is ordered by (SPEC.md §40, §41).
 *
 * The property under test is *totality*: an ordering under which no two distinct rows
 * can tie. A page is a window onto an ordering, and a paginated read is two queries —
 * so rows that tie are rows the database may hand back in either order, and it may
 * choose differently the second time. That is how page two repeats a row from page one
 * and skips another.
 */
import { describe, expect, it } from 'vitest'

import { listingOrder, parseSort } from './ordering.js'

describe('the sort a URL sends', () => {
  it('reads a leading minus as descending', () => {
    expect(parseSort('-createdAt')).toEqual({ field: 'createdAt', direction: 'desc' })
    expect(parseSort('title')).toEqual({ field: 'title', direction: 'asc' })
  })
})

describe('the ordering a listing runs under', () => {
  it('is never empty, which is what left a page onto an unordered heap', () => {
    expect(listingOrder({ primaryKey: 'id', hasCreatedAt: false })).not.toEqual([])
  })

  it('is newest first when nobody asked, where the model knows when a row was made', () => {
    expect(listingOrder({ primaryKey: 'id', hasCreatedAt: true })).toEqual([
      { field: 'createdAt', direction: 'desc' },
      { field: 'id', direction: 'asc' },
    ])
  })

  it('falls to the key alone for a model with no createdAt — arbitrary, but stable', () => {
    expect(listingOrder({ primaryKey: 'sku', hasCreatedAt: false })).toEqual([
      { field: 'sku', direction: 'asc' },
    ])
  })

  it('leads with what was asked for, and settles the ties underneath it', () => {
    // The plain case: forty drafts tie forty ways on `status`.
    expect(listingOrder({ sort: 'status', primaryKey: 'id', hasCreatedAt: true })).toEqual([
      { field: 'status', direction: 'asc' },
      { field: 'id', direction: 'asc' },
    ])
  })

  it('settles them under a timestamp too, which ties more rarely and no less badly', () => {
    // Two entries written in the same millisecond by one import are a coin toss for
    // as long as they both exist.
    expect(listingOrder({ sort: '-createdAt', primaryKey: 'id', hasCreatedAt: true })).toEqual([
      { field: 'createdAt', direction: 'desc' },
      { field: 'id', direction: 'asc' },
    ])
  })

  it('does not name the key twice when that is what was asked for', () => {
    expect(listingOrder({ sort: '-id', primaryKey: 'id', hasCreatedAt: true })).toEqual([
      { field: 'id', direction: 'desc' },
    ])
  })

  it('always ends with the key, which is the whole of what makes it total', () => {
    const orderings = [
      listingOrder({ primaryKey: 'id', hasCreatedAt: true }),
      listingOrder({ primaryKey: 'id', hasCreatedAt: false }),
      listingOrder({ sort: 'status', primaryKey: 'id', hasCreatedAt: true }),
      listingOrder({ sort: '-publishedAt', primaryKey: 'id', hasCreatedAt: true }),
      listingOrder({ sort: 'id', primaryKey: 'id', hasCreatedAt: true }),
    ]

    for (const ordering of orderings) {
      expect(ordering.at(-1)?.field, JSON.stringify(ordering)).toBe('id')
    }
  })
})
