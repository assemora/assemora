/**
 * The frame's half of the canvas protocol (SPEC.md §59, ADR-0018).
 *
 * Studio's canvas is an iframe running the application's own frontend, so every
 * application that wants a builder has to hold up one end of a conversation: report
 * that it is ready, what was clicked, what the pointer is over, what was pressed and
 * where every block ended up, and carry out a render, a measure and a reveal.
 *
 * That was written out by hand in every frame — the playground, both starters, both
 * examples. Five copies of one protocol drift the moment it gains a message, and they
 * did: four of them still sent only `assemora:selected`, so a generated project had
 * no hover outline and no scroll-to-selection while Studio drew the rest of the
 * chrome. Nothing mechanical noticed, because five hand-written listeners all
 * compile. So the listener lives here, as one implementation with tests, and a frame
 * is the two lines that say which page it is drawing.
 *
 * It is deliberately not a component and it draws nothing. What the canvas shows is
 * the application's own page; this is only the wiring around it.
 */
import type { BlockTree } from '@assemora/schema'

import { type CanvasEvent, isCanvasInstruction } from './canvas.js'
import { blockAt, measureBlocks, revealBlock } from './measure.js'

export type CanvasFrameOptions = {
  /**
   * The origin the editor named itself with, and the only one this frame talks to.
   *
   * Checked in both directions: a page anybody may embed must not take instructions
   * from whoever embedded it, and must not broadcast what it is showing (SPEC.md §85).
   * An empty origin connects nothing at all rather than defaulting to `'*'`.
   */
  readonly editor: string
  /** The editor has sent a new tree. Draw it. */
  readonly render: (tree: BlockTree) => void
  /** The window the frame lives in. Defaults to this one; a test hands its own. */
  readonly view?: Window
}

export type CanvasFrame = {
  /**
   * Report where every block ended up.
   *
   * Called by the frame itself on scroll and resize, and by whoever drew the page
   * after every render: the editor's outlines are drawn over these boxes, so a render
   * that moves a block and does not re-measure leaves the outline behind.
   */
  readonly measure: () => void
  /** Detach every listener. */
  readonly stop: () => void
}

const TEXT_ENTRY = new Set(['INPUT', 'TEXTAREA', 'SELECT'])

/**
 * The keys that are a command in their own right, with no modifier held.
 *
 * Kept to the three that cannot be text. Plain arrows are not here: they scroll, and
 * taking scrolling away from a page three screens tall inside a small frame is a bad
 * trade for one modifier (the editor binds Alt with an arrow, which does cross).
 */
const COMMAND_KEYS = new Set(['escape', 'delete', 'backspace'])

/** A modifier pressed on its own is the start of a chord, not a chord. */
const MODIFIER_KEYS = new Set(['meta', 'control', 'alt', 'shift', 'altgraph', 'os'])

/**
 * Whether the press belongs to something a person is typing into.
 *
 * Structural rather than `instanceof HTMLElement`: this runs against the frame's own
 * document, but the same check is wanted wherever a target comes from, and a target
 * from another document fails an `instanceof` against this one's constructors.
 */
const isTextEntry = (target: unknown): boolean => {
  if (typeof target !== 'object' || target === null) return false

  const element = target as { tagName?: unknown; isContentEditable?: unknown }

  return (
    element.isContentEditable === true ||
    (typeof element.tagName === 'string' && TEXT_ENTRY.has(element.tagName))
  )
}

/**
 * Whether this press is aimed at the editor rather than at the page.
 *
 * Everything a person types stays in the frame. What crosses is what cannot be
 * typing: a chord, or one of the three keys that never produce a character.
 */
const isForEditor = (event: KeyboardEvent): boolean => {
  if (isTextEntry(event.target)) return false

  const key = event.key.toLowerCase()

  if (MODIFIER_KEYS.has(key)) return false

  return event.metaKey || event.ctrlKey || event.altKey || COMMAND_KEYS.has(key)
}

/**
 * Whether the frame should also stop the browser acting on a press it forwarded.
 *
 * The line is whose default it is. Alt with an arrow scrolls this document on some
 * platforms, and scrolling the canvas while the block inside it moves is the press
 * happening twice; Escape aborts the frame's in-flight loads; Backspace is history
 * navigation in older browsers. Those are this page's defaults and this page cancels
 * them. A ⌘ or Ctrl chord in a document with nothing editable focused does nothing at
 * all — but some of them are the *browser's* (find in page, reload), so cancelling
 * them would take a working key away to prevent nothing.
 */
const isOurs = (event: KeyboardEvent): boolean => !(event.metaKey || event.ctrlKey)

/** A connection to nobody: the frame was opened without an editor to answer. */
const IDLE: CanvasFrame = {
  measure: () => undefined,
  stop: () => undefined,
}

export const connectCanvas = ({
  editor,
  render,
  view = window,
}: CanvasFrameOptions): CanvasFrame => {
  if (editor === '') return IDLE

  const doc = view.document

  const post = (event: CanvasEvent): void => {
    view.parent.postMessage(event, editor)
  }

  const measure = (): void => {
    post({ type: 'assemora:geometry', blocks: measureBlocks(doc) })
  }

  const reveal = (blockId: string): void => {
    // The editor reveals a block in the same breath as the render that created it,
    // and this frame has not drawn it yet when the instruction lands. A frame later
    // it has, and asking twice is cheaper than making the editor wait.
    if (!revealBlock(blockId, doc)) {
      view.requestAnimationFrame(() => revealBlock(blockId, doc))
    }
  }

  const onMessage = (event: MessageEvent<unknown>): void => {
    if (event.origin !== editor || event.source !== view.parent) return
    if (!isCanvasInstruction(event.data)) return

    const instruction = event.data

    if (instruction.type === 'assemora:render') render(instruction.tree)
    if (instruction.type === 'assemora:measure') measure()
    if (instruction.type === 'assemora:reveal') reveal(instruction.blockId)
  }

  const onClick = (event: MouseEvent): void => {
    // The editor selects; a link inside the canvas must not navigate the frame.
    event.preventDefault()
    post({ type: 'assemora:selected', blockId: blockAt(event.target) })
  }

  // The pointer moves far more often than it crosses a boundary, so what is sent is
  // the crossing. The editor already knows what block `id` is and where its box is;
  // it needs to be told only that the pointer is now in a different one.
  let hovered: string | null = null

  const hover = (blockId: string | null): void => {
    if (blockId === hovered) return

    hovered = blockId
    post({ type: 'assemora:hovered', blockId })
  }

  const onPointerMove = (event: PointerEvent): void => hover(blockAt(event.target))

  // Leaving the frame entirely: no element is entered, so nothing is hovered. The
  // editor would otherwise keep an outline on the last block the pointer touched.
  const onPointerOut = (event: PointerEvent): void => {
    if (event.relatedTarget === null) hover(null)
  }

  const onKeyDown = (event: KeyboardEvent): void => {
    if (!isForEditor(event)) return
    if (isOurs(event)) event.preventDefault()

    post({
      type: 'assemora:pressed',
      press: {
        key: event.key,
        metaKey: event.metaKey,
        ctrlKey: event.ctrlKey,
        shiftKey: event.shiftKey,
        altKey: event.altKey,
      },
    })
  }

  view.addEventListener('message', onMessage)
  doc.addEventListener('click', onClick, true)
  doc.addEventListener('pointermove', onPointerMove, true)
  doc.addEventListener('pointerout', onPointerOut, true)
  doc.addEventListener('keydown', onKeyDown, true)
  view.addEventListener('resize', measure)
  // The editor draws its outline over the frame, so a scroll inside the frame moves
  // every box it is drawing.
  view.addEventListener('scroll', measure, { passive: true })

  post({ type: 'assemora:ready' })

  return {
    measure,
    stop: () => {
      view.removeEventListener('message', onMessage)
      doc.removeEventListener('click', onClick, true)
      doc.removeEventListener('pointermove', onPointerMove, true)
      doc.removeEventListener('pointerout', onPointerOut, true)
      doc.removeEventListener('keydown', onKeyDown, true)
      view.removeEventListener('resize', measure)
      view.removeEventListener('scroll', measure)
    },
  }
}

export type UseCanvasFrameOptions = {
  /** `?editing=1`. Without it this is an ordinary page that knows nothing of a builder. */
  readonly editing: boolean
  /** `?editor=` — the origin Studio named itself with. */
  readonly editor: string
  /**
   * The tree currently drawn.
   *
   * Read only to know that it changed: every render moves the boxes the editor draws
   * its outlines from, so a re-measure follows one.
   */
  readonly tree: BlockTree
  /** The editor has sent a new tree. Draw it. */
  readonly render: (tree: BlockTree) => void
}
