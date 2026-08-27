import type { BlockRect } from '@assemora/react'
import { describe, expect, it } from 'vitest'

import { insertionPoints } from './insertion.ts'

const rect = (id: string, top: number, height: number, left = 0, width = 600): BlockRect => ({
  id,
  top,
  left,
  width,
  height,
})

const siblings = (...ids: string[]) => ids.map((id) => ({ id }))

describe('where a block can be put in (SPEC.md §60)', () => {
  const stacked = [rect('a', 0, 100), rect('b', 120, 80)]

  it('offers a gap before the first, between each pair and after the last', () => {
    expect(insertionPoints(siblings('a', 'b'), stacked, undefined).map((gap) => gap.index)).toEqual(
      [0, 1, 2],
    )
  })

  it('gives the same index the command takes, so the gap and the write agree', () => {
    const [first, middle, last] = insertionPoints(siblings('a', 'b'), stacked, undefined)

    // Before the first block, halfway down the gap, and below the last.
    expect(first?.top).toBe(-1)
    expect(middle?.top).toBe(109)
    expect(last?.top).toBe(199)
  })

  it('draws a vertical line between blocks that sit side by side', () => {
    const across = [rect('a', 0, 100, 0, 300), rect('b', 0, 100, 320, 280)]
    const [, middle] = insertionPoints(siblings('a', 'b'), across, undefined)

    expect(middle).toMatchObject({ index: 1, left: 309, width: 2, height: 100 })
  })

  it('offers the middle of an empty container, which still draws a box of its own', () => {
    expect(insertionPoints([], [], rect('section', 40, 200))).toEqual([
      { index: 0, top: 139, left: 0, width: 600, height: 2 },
    ])
  })

  it('has nothing to offer on an empty page, which has its own invitation', () => {
    expect(insertionPoints([], [], undefined)).toEqual([])
  })

  /** A block whose view drew nothing has no box, and so no position to be beside. */
  it('skips a sibling the frame reported no box for, without shifting the indices', () => {
    const points = insertionPoints(siblings('a', 'ghost', 'b'), stacked, undefined)

    expect(points.map((gap) => gap.index)).toEqual([0, 2, 3])
  })
})
