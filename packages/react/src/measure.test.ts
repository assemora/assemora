import { describe, expect, it, vi } from 'vitest'

import { blockAt, measureBlocks, revealBlock } from './measure.js'
import { BLOCK_ATTRIBUTE } from './page.js'

/**
 * A DOM small enough to reason about.
 *
 * These three functions are the only place the renderer touches a real document, and
 * what they promise is arithmetic over boxes — a union, a walk up, a walk across.
 * Handing them a page whose geometry is stated outright says what the answer should
 * be; a browser laying out real elements would only say what it happened to compute.
 */
type Box = { top: number; left: number; width: number; height: number }

const NOTHING: Box = { top: 0, left: 0, width: 0, height: 0 }

class FakeElement {
  readonly children: FakeElement[] = []
  parentElement: FakeElement | null = null
  /** What `scrollIntoView` was called with, or `undefined` if it never was. */
  scrolledInto: ScrollIntoViewOptions | undefined
  scrolled = false

  readonly attributes: Readonly<Record<string, string>>
  private readonly box: Box

  constructor(attributes: Readonly<Record<string, string>> = {}, box: Box = NOTHING) {
    this.attributes = attributes
    this.box = box
  }

  append(...children: FakeElement[]): this {
    for (const child of children) {
      child.parentElement = this
      this.children.push(child)
    }

    return this
  }

  getAttribute(name: string): string | null {
    return this.attributes[name] ?? null
  }

  getBoundingClientRect() {
    const { top, left, width, height } = this.box

    return { top, left, width, height, right: left + width, bottom: top + height }
  }

  /** Only the one selector shape `measure.ts` builds: `[attribute]`. */
  closest(selector: string): FakeElement | null {
    const attribute = selector.slice(1, -1)
    let node: FakeElement | null = this

    while (node !== null) {
      if (node.getAttribute(attribute) !== null) return node

      node = node.parentElement
    }

    return null
  }

  querySelectorAll(selector: string): FakeElement[] {
    const attribute = selector.slice(1, -1)
    const found: FakeElement[] = []

    const walk = (node: FakeElement): void => {
      for (const child of node.children) {
        if (child.getAttribute(attribute) !== null) found.push(child)

        walk(child)
      }
    }

    walk(this)

    return found
  }

  scrollIntoView(options?: ScrollIntoViewOptions): void {
    this.scrolled = true
    this.scrolledInto = options
  }
}

// `blockAt` asks whether a click target is an element at all, and Node has no DOM.
vi.stubGlobal('Element', FakeElement)

const marker = (id: string, ...children: FakeElement[]) =>
  new FakeElement({ [BLOCK_ATTRIBUTE]: id }).append(...children)

const drawn = (box: Box) => new FakeElement({}, box)

const rootOf = (...children: FakeElement[]) => new FakeElement().append(...children)

const asRoot = (element: FakeElement) => element as unknown as ParentNode
const asTarget = (element: FakeElement) => element as unknown as EventTarget

describe('measuring what a block drew', () => {
  it('unions everything under the marker, which has no box of its own', () => {
    // The marker is a `display: contents` wrapper, so its own rect is empty and the
    // block's box is the extent of what it drew.
    const root = rootOf(
      marker(
        'a',
        drawn({ top: 100, left: 20, width: 200, height: 50 }),
        drawn({ top: 180, left: 10, width: 100, height: 40 }),
      ),
    )

    expect(measureBlocks(asRoot(root))).toEqual([
      { id: 'a', top: 100, left: 10, width: 210, height: 120 },
    ])
  })

  it('ignores a child that occupies nothing', () => {
    // A block may draw an anchor, a comment placeholder or a hidden input first; at
    // 0 × 0 and origin 0,0 it would drag the union up to the top of the viewport.
    const root = rootOf(
      marker('a', drawn(NOTHING), drawn({ top: 60, left: 5, width: 30, height: 10 })),
    )

    expect(measureBlocks(asRoot(root))).toEqual([
      { id: 'a', top: 60, left: 5, width: 30, height: 10 },
    ])
  })

  it('leaves out a block that drew nothing at all', () => {
    expect(measureBlocks(asRoot(rootOf(marker('a'))))).toEqual([])
    expect(measureBlocks(asRoot(rootOf(marker('a', drawn(NOTHING)))))).toEqual([])
  })

  it('reports a nested block as well as the one holding it', () => {
    const inner = marker('b', drawn({ top: 20, left: 0, width: 50, height: 10 }))
    const root = rootOf(marker('a', drawn({ top: 0, left: 0, width: 100, height: 100 }), inner))

    expect(measureBlocks(asRoot(root)).map((rect) => rect.id)).toEqual(['a', 'b'])
  })
})

describe('the block a click landed in', () => {
  it('is the innermost marker above the target', () => {
    const text = drawn(NOTHING)
    const inner = marker('b', text)
    const root = rootOf(marker('a', inner))

    expect(root.children).toHaveLength(1)
    expect(blockAt(asTarget(text))).toBe('b')
  })

  it('is the marker itself when the marker was clicked', () => {
    expect(blockAt(asTarget(marker('a')))).toBe('a')
  })

  it('is nothing when the click landed outside every block', () => {
    expect(blockAt(asTarget(rootOf(drawn(NOTHING))))).toBeNull()
  })

  it('is nothing when there was no element to speak of', () => {
    expect(blockAt(null)).toBeNull()
    expect(blockAt({ tagName: 'DIV' } as unknown as EventTarget)).toBeNull()
  })
})

describe('bringing a block into view', () => {
  it('scrolls to the first thing the block drew, and says it found it', () => {
    // `scrollIntoView` on the marker does nothing — `display: contents` has no box to
    // scroll to — so what is scrolled to is the first child with a box.
    const empty = drawn(NOTHING)
    const body = drawn({ top: 900, left: 0, width: 100, height: 40 })
    const root = rootOf(marker('a', empty, body))

    expect(revealBlock('a', asRoot(root))).toBe(true)
    expect(body.scrolled).toBe(true)
    expect(body.scrolledInto).toEqual({ block: 'nearest' })
    expect(empty.scrolled).toBe(false)
  })

  it('asks for nearest, so a block already on screen does not move the page', () => {
    const body = drawn({ top: 10, left: 0, width: 100, height: 40 })

    revealBlock('a', asRoot(rootOf(marker('a', body))))

    expect(body.scrolledInto?.block).toBe('nearest')
  })

  it('scrolls to the block that was asked for, not the first one on the page', () => {
    const first = drawn({ top: 0, left: 0, width: 100, height: 40 })
    const second = drawn({ top: 900, left: 0, width: 100, height: 40 })
    const root = rootOf(marker('a', first), marker('b', second))

    expect(revealBlock('b', asRoot(root))).toBe(true)
    expect(first.scrolled).toBe(false)
    expect(second.scrolled).toBe(true)
  })

  it('falls back to the marker when nothing the block drew has a box', () => {
    const wrapper = marker('a', drawn(NOTHING))

    expect(revealBlock('a', asRoot(rootOf(wrapper)))).toBe(true)
    expect(wrapper.scrolled).toBe(true)
  })

  it('scrolls nothing and says so when the block is not drawn yet', () => {
    // The editor reveals a block in the same breath as the render that created it,
    // and the answer is what tells the frame to ask again a frame later.
    const body = drawn({ top: 0, left: 0, width: 100, height: 40 })

    expect(revealBlock('missing', asRoot(rootOf(marker('a', body))))).toBe(false)
    expect(body.scrolled).toBe(false)
  })
})
