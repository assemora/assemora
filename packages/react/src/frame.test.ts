import type { BlockTree } from '@assemora/schema'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { CanvasEvent, CanvasInstruction } from './canvas.js'
import { connectCanvas } from './frame.js'
import { BLOCK_ATTRIBUTE } from './page.js'

const EDITOR = 'https://studio.example'

type Box = { top: number; left: number; width: number; height: number }

const NOTHING: Box = { top: 0, left: 0, width: 0, height: 0 }

class FakeElement {
  readonly children: FakeElement[] = []
  parentElement: FakeElement | null = null
  tagName = 'DIV'
  isContentEditable = false
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

  scrollIntoView(): void {
    this.scrolled = true
  }
}

// `blockAt` asks whether an event target is an element at all, and Node has no DOM.
vi.stubGlobal('Element', FakeElement)

type Handler = (event: never) => void

class FakeTarget {
  readonly handlers = new Map<string, Set<Handler>>()

  addEventListener(type: string, handler: Handler): void {
    const registered = this.handlers.get(type) ?? new Set<Handler>()

    registered.add(handler)
    this.handlers.set(type, registered)
  }

  removeEventListener(type: string, handler: Handler): void {
    this.handlers.get(type)?.delete(handler)
  }

  get attached(): number {
    return [...this.handlers.values()].reduce((total, set) => total + set.size, 0)
  }

  dispatch(type: string, event: unknown): void {
    for (const handler of [...(this.handlers.get(type) ?? [])])
      (handler as (e: unknown) => void)(event)
  }
}

class FakeDocument extends FakeTarget {
  private readonly root: FakeElement

  constructor(root: FakeElement) {
    super()
    this.root = root
  }

  querySelectorAll(selector: string): FakeElement[] {
    return this.root.querySelectorAll(selector)
  }
}

const marker = (id: string, box: Box) =>
  new FakeElement({ [BLOCK_ATTRIBUTE]: id }).append(new FakeElement({}, box))

/** A page with two blocks on it, one above the fold and one a long way below. */
const page = () =>
  new FakeElement().append(
    marker('a', { top: 0, left: 0, width: 300, height: 200 }),
    marker('b', { top: 900, left: 0, width: 300, height: 200 }),
  )

const build = (root = page()) => {
  const posted: CanvasEvent[] = []
  const origins: string[] = []
  const frames: Array<() => void> = []
  const document = new FakeDocument(root)
  const window = new FakeTarget()

  const view = Object.assign(window, {
    document,
    parent: {
      postMessage: (message: unknown, origin: string) => {
        posted.push(message as CanvasEvent)
        origins.push(origin)
      },
    },
    requestAnimationFrame: (callback: () => void) => frames.push(callback),
  })

  return {
    root,
    document,
    window,
    posted,
    origins,
    /** Run whatever was deferred to the next frame. */
    nextFrame: () => {
      for (const callback of frames.splice(0)) callback()
    },
    view: view as unknown as Window,
  }
}

const posts = <T extends CanvasEvent['type']>(posted: readonly CanvasEvent[], type: T) =>
  posted.filter((event): event is Extract<CanvasEvent, { type: T }> => event.type === type)

type FakePress = {
  key: string
  metaKey: boolean
  ctrlKey: boolean
  shiftKey: boolean
  altKey: boolean
  target: FakeElement
  preventDefault: ReturnType<typeof vi.fn>
}

const press = (overrides: Partial<FakePress> = {}): FakePress => ({
  key: 'z',
  metaKey: false,
  ctrlKey: false,
  shiftKey: false,
  altKey: false,
  target: new FakeElement(),
  preventDefault: vi.fn(),
  ...overrides,
})

describe('connecting a frame to the editor', () => {
  it('announces itself, so the editor knows there is something to talk to', () => {
    const frame = build()

    connectCanvas({ editor: EDITOR, render: () => undefined, view: frame.view })

    expect(frame.posted[0]).toEqual({ type: 'assemora:ready' })
  })

  it('posts to the editor and to nobody else', () => {
    // A canvas holds a logged-in page, and a frame may be somewhere other than where
    // the editor thinks it is (SPEC.md §85).
    const frame = build()

    connectCanvas({ editor: EDITOR, render: () => undefined, view: frame.view })
    frame.document.dispatch('click', { target: new FakeElement(), preventDefault: vi.fn() })

    expect(new Set(frame.origins)).toEqual(new Set([EDITOR]))
  })

  it('connects nothing when nobody named themselves as the editor', () => {
    // `/preview` without `?editor=` is the site. A page anybody may embed must not
    // take instructions from whoever embedded it, nor broadcast what it is showing —
    // and it must certainly not swallow the clicks on its own links (SPEC.md §85).
    const frame = build()

    connectCanvas({ editor: '', render: () => undefined, view: frame.view })

    expect(frame.posted).toEqual([])
    expect(frame.window.attached).toBe(0)
    expect(frame.document.attached).toBe(0)
  })

  it('lets go of every listener when it is stopped', () => {
    const frame = build()

    connectCanvas({ editor: EDITOR, render: () => undefined, view: frame.view }).stop()

    expect(frame.window.attached).toBe(0)
    expect(frame.document.attached).toBe(0)
  })
})

describe('what the frame reports', () => {
  it('reports the block a click landed in, and does not let the page navigate', () => {
    const frame = build()
    const click = {
      target: frame.root.querySelectorAll(`[${BLOCK_ATTRIBUTE}]`)[0],
      preventDefault: vi.fn(),
    }

    connectCanvas({ editor: EDITOR, render: () => undefined, view: frame.view })
    frame.document.dispatch('click', click)

    expect(click.preventDefault).toHaveBeenCalled()
    expect(posts(frame.posted, 'assemora:selected')).toEqual([
      { type: 'assemora:selected', blockId: 'a' },
    ])
  })

  it('reports a click outside every block as nothing selected', () => {
    const frame = build()

    connectCanvas({ editor: EDITOR, render: () => undefined, view: frame.view })
    frame.document.dispatch('click', { target: new FakeElement(), preventDefault: vi.fn() })

    expect(posts(frame.posted, 'assemora:selected')).toEqual([
      { type: 'assemora:selected', blockId: null },
    ])
  })

  it('reports the crossing, never the movement', () => {
    // A pointer crossing a page costs one message per block, not one per pixel: the
    // editor already knows what block `id` is and where its box is, so all it needs
    // to be told is that the pointer is now in a different one.
    const frame = build()
    const [a, b] = frame.root.querySelectorAll(`[${BLOCK_ATTRIBUTE}]`)

    connectCanvas({ editor: EDITOR, render: () => undefined, view: frame.view })

    for (const target of [a, a, b, b, a]) frame.document.dispatch('pointermove', { target })

    expect(posts(frame.posted, 'assemora:hovered')).toEqual([
      { type: 'assemora:hovered', blockId: 'a' },
      { type: 'assemora:hovered', blockId: 'b' },
      { type: 'assemora:hovered', blockId: 'a' },
    ])
  })

  it('clears the hover when the pointer leaves the frame entirely', () => {
    const frame = build()
    const [a] = frame.root.querySelectorAll(`[${BLOCK_ATTRIBUTE}]`)

    connectCanvas({ editor: EDITOR, render: () => undefined, view: frame.view })
    frame.document.dispatch('pointermove', { target: a })
    frame.document.dispatch('pointerout', { relatedTarget: null })

    expect(posts(frame.posted, 'assemora:hovered').at(-1)).toEqual({
      type: 'assemora:hovered',
      blockId: null,
    })
  })

  it('keeps the hover when the pointer only moved to another element inside the frame', () => {
    const frame = build()
    const [a] = frame.root.querySelectorAll(`[${BLOCK_ATTRIBUTE}]`)

    connectCanvas({ editor: EDITOR, render: () => undefined, view: frame.view })
    frame.document.dispatch('pointermove', { target: a })
    frame.document.dispatch('pointerout', { relatedTarget: new FakeElement() })

    expect(posts(frame.posted, 'assemora:hovered')).toHaveLength(1)
  })

  it('reports where every block ended up when asked to measure', () => {
    const frame = build()

    connectCanvas({ editor: EDITOR, render: () => undefined, view: frame.view }).measure()

    expect(posts(frame.posted, 'assemora:geometry').at(-1)).toEqual({
      type: 'assemora:geometry',
      blocks: [
        { id: 'a', top: 0, left: 0, width: 300, height: 200 },
        { id: 'b', top: 900, left: 0, width: 300, height: 200 },
      ],
    })
  })

  it('re-measures on a scroll and on a resize, because the outlines are drawn over it', () => {
    const frame = build()

    connectCanvas({ editor: EDITOR, render: () => undefined, view: frame.view })
    frame.window.dispatch('scroll', {})
    frame.window.dispatch('resize', {})

    expect(posts(frame.posted, 'assemora:geometry')).toHaveLength(2)
  })
})

describe('the keys the frame hands over', () => {
  let frame: ReturnType<typeof build>

  beforeEach(() => {
    frame = build()
    connectCanvas({ editor: EDITOR, render: () => undefined, view: frame.view })
  })

  const pressed = () => posts(frame.posted, 'assemora:pressed')

  it('hands over a chord, with everything a shortcut is decided by', () => {
    // Clicking a block on the canvas moves focus into the frame, so this is the only
    // way ⌘Z ever reaches the editor after the click that chose what it is about.
    frame.document.dispatch('keydown', press({ key: 'z', metaKey: true }))

    expect(pressed()).toEqual([
      {
        type: 'assemora:pressed',
        press: { key: 'z', metaKey: true, ctrlKey: false, shiftKey: false, altKey: false },
      },
    ])
  })

  it('hands over the keys that cannot be text', () => {
    for (const key of ['Escape', 'Delete', 'Backspace']) {
      frame.document.dispatch('keydown', press({ key }))
    }

    expect(pressed().map((event) => event.press.key)).toEqual(['Escape', 'Delete', 'Backspace'])
  })

  it('hands over Alt with an arrow, which is how a block is moved', () => {
    frame.document.dispatch('keydown', press({ key: 'ArrowDown', altKey: true }))

    expect(pressed()).toHaveLength(1)
  })

  it('keeps what a person is typing', () => {
    // Not every keystroke is a command. Forwarding the rest would send what somebody
    // types inside an embedded page to another origin, to be thrown away there.
    for (const key of ['a', 'Z', ' ', 'Enter', 'ArrowDown', 'Tab', '1']) {
      frame.document.dispatch('keydown', press({ key }))
    }

    expect(pressed()).toEqual([])
  })

  it('keeps a press aimed at a field inside the frame', () => {
    const field = new FakeElement()

    field.tagName = 'INPUT'

    const editable = new FakeElement()

    editable.isContentEditable = true

    frame.document.dispatch('keydown', press({ key: 'Backspace', target: field }))
    frame.document.dispatch('keydown', press({ key: 'z', metaKey: true, target: field }))
    frame.document.dispatch('keydown', press({ key: 'Backspace', target: editable }))

    expect(pressed()).toEqual([])
  })

  it('keeps a modifier pressed on its own, which is the start of a chord and not one', () => {
    frame.document.dispatch('keydown', press({ key: 'Meta', metaKey: true }))
    frame.document.dispatch('keydown', press({ key: 'Shift', shiftKey: true }))
    frame.document.dispatch('keydown', press({ key: 'Alt', altKey: true }))
    frame.document.dispatch('keydown', press({ key: 'Control', ctrlKey: true }))

    expect(pressed()).toEqual([])
  })

  it('cancels the presses whose default would act on this page', () => {
    // Alt with an arrow scrolls this document on some platforms, and scrolling the
    // canvas while the block inside it moves is the press happening twice.
    const alt = press({ key: 'ArrowDown', altKey: true })
    const away = press({ key: 'Escape' })

    frame.document.dispatch('keydown', alt)
    frame.document.dispatch('keydown', away)

    expect(alt.preventDefault).toHaveBeenCalled()
    expect(away.preventDefault).toHaveBeenCalled()
  })

  it('leaves the browser its own chords', () => {
    // ⌘F and ⌘R belong to the browser, and a ⌘ chord in a document with nothing
    // editable focused does nothing anyway — so cancelling would take a working key
    // away to prevent nothing.
    const chord = press({ key: 'z', metaKey: true })

    frame.document.dispatch('keydown', chord)

    expect(chord.preventDefault).not.toHaveBeenCalled()
  })
})

describe('what the frame carries out', () => {
  const tree: BlockTree = { blocks: [] }

  const message = (
    data: CanvasInstruction,
    view: Window,
    overrides: Record<string, unknown> = {},
  ) => ({
    origin: EDITOR,
    source: view.parent,
    data,
    ...overrides,
  })

  it('draws the tree the editor sends', () => {
    const frame = build()
    const render = vi.fn()

    connectCanvas({ editor: EDITOR, render, view: frame.view })
    frame.window.dispatch(
      'message',
      message({ type: 'assemora:render', tree, selected: null }, frame.view),
    )

    expect(render).toHaveBeenCalledWith(tree)
  })

  it('measures when it is asked to', () => {
    const frame = build()

    connectCanvas({ editor: EDITOR, render: () => undefined, view: frame.view })
    frame.window.dispatch('message', message({ type: 'assemora:measure' }, frame.view))

    expect(posts(frame.posted, 'assemora:geometry')).toHaveLength(1)
  })

  it('brings a block into view when it is asked to', () => {
    const frame = build()

    connectCanvas({ editor: EDITOR, render: () => undefined, view: frame.view })
    frame.window.dispatch('message', message({ type: 'assemora:reveal', blockId: 'b' }, frame.view))

    expect(frame.root.querySelectorAll(`[${BLOCK_ATTRIBUTE}]`)[1]?.children[0]?.scrolled).toBe(true)
  })

  it('asks again a frame later for a block that has not been drawn yet', () => {
    // The editor reveals a block in the same breath as the render that created it,
    // and this frame has not drawn it when the instruction lands.
    const root = new FakeElement()
    const frame = build(root)

    connectCanvas({ editor: EDITOR, render: () => undefined, view: frame.view })
    frame.window.dispatch('message', message({ type: 'assemora:reveal', blockId: 'a' }, frame.view))

    root.append(marker('a', { top: 900, left: 0, width: 300, height: 200 }))
    frame.nextFrame()

    expect(root.querySelectorAll(`[${BLOCK_ATTRIBUTE}]`)[0]?.children[0]?.scrolled).toBe(true)
  })

  it('refuses an instruction from another origin', () => {
    const frame = build()
    const render = vi.fn()

    connectCanvas({ editor: EDITOR, render, view: frame.view })
    frame.window.dispatch(
      'message',
      message({ type: 'assemora:render', tree, selected: null }, frame.view, {
        origin: 'https://elsewhere.example',
      }),
    )

    expect(render).not.toHaveBeenCalled()
  })

  it('refuses an instruction from a window that is not the one framing it', () => {
    const frame = build()
    const render = vi.fn()

    connectCanvas({ editor: EDITOR, render, view: frame.view })
    frame.window.dispatch(
      'message',
      message({ type: 'assemora:render', tree, selected: null }, frame.view, { source: {} }),
    )

    expect(render).not.toHaveBeenCalled()
  })

  it('refuses its own events sent back at it', () => {
    const frame = build()
    const render = vi.fn()

    connectCanvas({ editor: EDITOR, render, view: frame.view })
    frame.window.dispatch('message', {
      origin: EDITOR,
      source: frame.view.parent,
      data: { type: 'assemora:selected', blockId: 'a' },
    })

    expect(render).not.toHaveBeenCalled()
    expect(posts(frame.posted, 'assemora:geometry')).toEqual([])
  })
})
