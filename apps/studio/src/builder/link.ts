/**
 * The editor's half of the canvas protocol (SPEC.md §59, ADR-0018).
 *
 * The frame's half is `connectCanvas` in `@assemora/react`, which every application
 * that wants a builder runs. This is the other end: what Studio listens for, who it
 * will listen to, and what it remembers about where a selection came from.
 *
 * Plain functions rather than hooks, for the same reason the frame's half is one: a
 * listener that takes the window it attaches to can be tested against a window that
 * does not exist, and the routing is where the mistakes are. The canvas itself is a
 * React component and cannot be, so as little as possible lives inside it.
 */
import { type BlockRect, isCanvasEvent, type KeyPress } from '@assemora/react'

/** The parts of a `MessageEvent` the editor reads. */
export type CanvasMessage = {
  readonly origin: string
  readonly source: unknown
  readonly data: unknown
}

/** What the editor does with each thing the frame reports. */
export type CanvasHandlers = {
  /** The frame is up and will carry out instructions. */
  readonly ready: () => void
  /** Something in the page was clicked — `null` when it was not a block. */
  readonly selected: (blockId: string | null) => void
  /** The pointer crossed into another block, or left every one of them. */
  readonly hovered: (blockId: string | null) => void
  readonly geometry: (blocks: readonly BlockRect[]) => void
  /**
   * A key pressed inside the frame.
   *
   * Clicking a block on the canvas is how a person picks the block a shortcut is
   * about, and it moves focus into the iframe — where Studio's own `keydown`
   * listener never hears it again.
   */
  readonly pressed: (press: KeyPress) => void
}

export type CanvasListener = {
  /** Studio's own window: the one that receives what the frame posts. */
  readonly view: {
    addEventListener(type: 'message', listener: (event: CanvasMessage) => void): void
    removeEventListener(type: 'message', listener: (event: CanvasMessage) => void): void
  }
  /**
   * The frame's window, read at delivery rather than held.
   *
   * The listener is attached before the iframe has one, and a reload replaces it.
   */
  readonly frame: () => unknown
  /** The origin the frame is served from, which is Studio's own. */
  readonly origin: string
  readonly on: CanvasHandlers
}

/**
 * Listens to one canvas frame, and to nothing else.
 *
 * A window receives whatever anybody sends it, so all three questions are asked: what
 * origin it came from, which window it was, and whether it is a message this half of
 * the protocol knows (SPEC.md §85). A frame that has not mounted yet is nobody, not a
 * wildcard — `null === null` would otherwise let a message with no source through.
 */
export const listenToCanvas = ({ view, frame, origin, on }: CanvasListener): (() => void) => {
  const onMessage = (event: CanvasMessage): void => {
    const source = frame()

    if (event.origin !== origin) return
    if (source === null || source === undefined || event.source !== source) return
    if (!isCanvasEvent(event.data)) return

    const message = event.data

    if (message.type === 'assemora:ready') on.ready()
    if (message.type === 'assemora:selected') on.selected(message.blockId)
    if (message.type === 'assemora:hovered') on.hovered(message.blockId)
    if (message.type === 'assemora:geometry') on.geometry(message.blocks)
    if (message.type === 'assemora:pressed') on.pressed(message.press)
  }

  view.addEventListener('message', onMessage)

  return () => view.removeEventListener('message', onMessage)
}

/**
 * What the editor knows about the selection it is showing.
 *
 * Selecting in the outline scrolls the canvas to the block; selecting *on* the canvas
 * does not, because the block is already on screen and scrolling the page under the
 * pointer that just clicked is hostile.
 */
export type Selection = {
  /** The block the frame itself reported, until the editor has accounted for it. */
  readonly reported: string | null
  /**
   * The selection already dealt with.
   *
   * The editor asks once per selection, and React runs an effect twice on mount in
   * development, so "have I answered this one" has to be part of the answer.
   */
  readonly seen: string | null
}

export const nothingSelected: Selection = { reported: null, seen: null }

/** The frame says this is what was clicked in the page. */
export const reportedByCanvas = (state: Selection, blockId: string | null): Selection => ({
  ...state,
  reported: blockId,
})

/**
 * Whether to scroll the frame to the selection, and what to remember afterwards.
 *
 * `reported` describes *one* selection and is spent on it. Held as a plain flag that
 * was written on every canvas click and never cleared, it was a latch instead: the
 * last block clicked on the canvas could never be revealed again for as long as the
 * page was open, so selecting it in the outline silently did nothing — for that block
 * alone, which is the kind of thing nobody reports as a bug because it looks like a
 * mistake of their own.
 */
export const revealFor = (
  state: Selection,
  selected: string | null,
): { readonly reveal: boolean; readonly next: Selection } => {
  // Nothing is selected, so there is nothing to reveal and nothing to remember: the
  // same block selected again afterwards is a new selection, not this one.
  if (selected === null) return { reveal: false, next: nothingSelected }

  if (state.seen === selected) return { reveal: false, next: state }

  return { reveal: state.reported !== selected, next: { reported: null, seen: selected } }
}
