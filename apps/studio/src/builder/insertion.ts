/**
 * Where a block can be put in, drawn on the canvas (SPEC.md §59, §60).
 *
 * The frame reports one box per block and nothing else. The editor holds the tree, so
 * it already knows which blocks are siblings and in what order, and the gap before the
 * *n*th child is the space between the *n-1*th box and the *n*th. A `+` dropped there
 * sends `blocks.add` with that same *n* as its index — the array position the tree's
 * own `insert()` uses, so what a person sees and what the command does are the same
 * number.
 *
 * There is deliberately no protocol message for this. It is derived from boxes the
 * editor is already given, and a message describing gaps would have to be recomputed
 * and resent on every scroll and resize alongside the boxes it came from.
 */
import type { BlockRect } from '@assemora/react'

/** How thick the line is drawn, in the frame's own pixels. */
const THICKNESS = 2

export type InsertionPoint = {
  /** The index `blocks.add` is given. */
  readonly index: number
  readonly top: number
  readonly left: number
  readonly width: number
  readonly height: number
}

type Box = Omit<InsertionPoint, 'index'>

/**
 * Whether the group is laid out across rather than down.
 *
 * The boxes say which it is: two blocks side by side overlap vertically, and two
 * stacked ones do not. The gap between them is then a vertical line, not a horizontal
 * one — the same sum read across instead of down.
 */
const sideways = (boxes: readonly BlockRect[]): boolean =>
  boxes.length > 1 &&
  boxes.every((rect, at) => {
    const previous = boxes[at - 1]

    return previous === undefined || rect.top < previous.top + previous.height
  })

const between = (before: BlockRect, after: BlockRect, across: boolean): Box => {
  if (across) {
    const middle = (before.left + before.width + after.left) / 2
    const top = Math.min(before.top, after.top)
    const bottom = Math.max(before.top + before.height, after.top + after.height)

    return { top, left: middle - THICKNESS / 2, width: THICKNESS, height: bottom - top }
  }

  const middle = (before.top + before.height + after.top) / 2
  const left = Math.min(before.left, after.left)
  const right = Math.max(before.left + before.width, after.left + after.width)

  return { top: middle - THICKNESS / 2, left, width: right - left, height: THICKNESS }
}

/** The gap on one side of a block that has no neighbour there. */
const beside = (rect: BlockRect, side: 'before' | 'after', across: boolean): Box => {
  const offset = side === 'before' ? 0 : across ? rect.width : rect.height

  return across
    ? {
        top: rect.top,
        left: rect.left + offset - THICKNESS / 2,
        width: THICKNESS,
        height: rect.height,
      }
    : {
        top: rect.top + offset - THICKNESS / 2,
        left: rect.left,
        width: rect.width,
        height: THICKNESS,
      }
}

/**
 * Every place a block could be added among one group of siblings.
 *
 * A sibling the frame drew no box for is skipped rather than guessed at: a block whose
 * view rendered nothing has no position to be beside. The indices belong to the tree,
 * not to the boxes, so skipping one does not shift the rest.
 */
export const insertionPoints = (
  siblings: readonly { readonly id: string }[],
  rects: readonly BlockRect[],
  /** The box of the container holding the group, when it is not the top level. */
  container: BlockRect | undefined,
): readonly InsertionPoint[] => {
  const placed = siblings.flatMap((sibling, index) => {
    const rect = rects.find((entry) => entry.id === sibling.id)

    return rect === undefined ? [] : [{ index, rect }]
  })

  const first = placed[0]
  const last = placed[placed.length - 1]

  if (first === undefined || last === undefined) {
    // An empty container still draws its own box, so the one place a block can go is
    // the middle of it. An empty page has no box, and its own invitation instead.
    return container === undefined
      ? []
      : [
          {
            index: 0,
            top: container.top + container.height / 2 - THICKNESS / 2,
            left: container.left,
            width: container.width,
            height: THICKNESS,
          },
        ]
  }

  const across = sideways(placed.map((entry) => entry.rect))
  const points: InsertionPoint[] = [{ index: first.index, ...beside(first.rect, 'before', across) }]

  for (let at = 1; at < placed.length; at += 1) {
    const previous = placed[at - 1]
    const current = placed[at]

    if (previous === undefined || current === undefined) continue

    points.push({ index: current.index, ...between(previous.rect, current.rect, across) })
  }

  points.push({ index: last.index + 1, ...beside(last.rect, 'after', across) })

  return points
}
