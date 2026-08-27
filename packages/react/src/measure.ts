/**
 * Where each block ended up on the page (SPEC.md §59).
 *
 * The editor draws its selection outline over the canvas rather than inside it, so
 * that what the frame shows stays exactly what a visitor would see. To do that it
 * needs the geometry, and only the frame can measure it.
 *
 * A block's marker is a `display: contents` wrapper, which has no box of its own —
 * so what is measured is everything it drew.
 */

import type { BlockRect } from './canvas.js'
import { BLOCK_ATTRIBUTE } from './page.js'

const union = (elements: readonly Element[]): Omit<BlockRect, 'id'> | undefined => {
  let top = Number.POSITIVE_INFINITY
  let left = Number.POSITIVE_INFINITY
  let right = Number.NEGATIVE_INFINITY
  let bottom = Number.NEGATIVE_INFINITY

  for (const element of elements) {
    const rect = element.getBoundingClientRect()

    if (rect.width === 0 && rect.height === 0) continue

    top = Math.min(top, rect.top)
    left = Math.min(left, rect.left)
    right = Math.max(right, rect.right)
    bottom = Math.max(bottom, rect.bottom)
  }

  if (!Number.isFinite(top)) return undefined

  return { top, left, width: right - left, height: bottom - top }
}

export const measureBlocks = (root: ParentNode = document): BlockRect[] => {
  const measured: BlockRect[] = []

  for (const wrapper of root.querySelectorAll(`[${BLOCK_ATTRIBUTE}]`)) {
    const id = wrapper.getAttribute(BLOCK_ATTRIBUTE)

    if (id === null) continue

    const box = union([...wrapper.children])

    if (box !== undefined) measured.push({ id, ...box })
  }

  return measured
}

/** The block a click landed in: the innermost marker above the target. */
export const blockAt = (target: EventTarget | null): string | null => {
  if (!(target instanceof Element)) return null

  return target.closest(`[${BLOCK_ATTRIBUTE}]`)?.getAttribute(BLOCK_ATTRIBUTE) ?? null
}

/**
 * Scrolls a block into view inside the frame, and says whether it found one.
 *
 * `scrollIntoView` on the marker itself does nothing when the marker is a
 * `display: contents` wrapper, because it has no box to scroll to — so what is
 * scrolled to is the first thing the block actually drew. `nearest` is what keeps
 * selecting a block that is already on screen from moving the page under the editor.
 *
 * No `behavior` is asked for. Whether this glides or jumps is `scroll-behavior` in
 * the page's own stylesheet, where a site can make it follow `prefers-reduced-motion`
 * — and where, unlike a smooth scroll requested from script, it cannot be quietly
 * dropped by a browser that is not animating.
 *
 * The markers are walked rather than selected by attribute value: an id is data, and
 * a selector built from data is a selector somebody else writes.
 */
export const revealBlock = (blockId: string, root: ParentNode = document): boolean => {
  for (const wrapper of root.querySelectorAll(`[${BLOCK_ATTRIBUTE}]`)) {
    if (wrapper.getAttribute(BLOCK_ATTRIBUTE) !== blockId) continue

    const drawn = [...wrapper.children].find((child) => {
      const rect = child.getBoundingClientRect()

      return rect.width > 0 || rect.height > 0
    })
    const target = drawn ?? wrapper

    target.scrollIntoView({ block: 'nearest' })

    return true
  }

  return false
}
