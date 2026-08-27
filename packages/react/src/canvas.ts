/**
 * The canvas protocol (SPEC.md §59).
 *
 * The builder's canvas is an iframe running the application's own renderer, which is
 * what makes the preview accurate: CSS is isolated, the real components draw, and a
 * responsive preview is a real viewport rather than a simulation. The price is that
 * the editor and the page are two documents, and they need a way to talk.
 *
 * The messages live here so both ends read the same declaration — the frame ships
 * with the application, the editor is Studio, and neither depends on the other.
 *
 * The rule the shape follows: the frame reports *what happened in the page* and the
 * editor sends *instructions the frame carries out*. Nothing crosses that never has
 * to — the editor already holds the tree, so it can name a block, work out where its
 * neighbours are and label them itself, and the frame is not asked to describe them.
 */
import type { BlockTree } from '@assemora/schema'

export const CANVAS_ORIGIN_MESSAGE = 'assemora:canvas'

/**
 * One block's box, in the frame's viewport coordinates.
 *
 * The editor draws over the iframe element, and the iframe element *is* the frame's
 * viewport, so these land where the block is with no translation.
 *
 * There is deliberately no message for insertion points, because these are already
 * the answer. The editor holds the tree, so it knows which blocks are siblings and in
 * what order; the gap before the *n*th child of a parent is the space between the
 * *n-1*th box's bottom edge and the *n*th box's top edge (its top edge when *n* is
 * zero, the last box's bottom edge when *n* is the count), and a `+` dropped there
 * sends `blocks.add` with that same `n` as its `index`. Blocks laid out side by side
 * are the same sum read across instead of down, which the boxes also say. A message
 * describing gaps would restate what the editor can already work out, and would have
 * to be recomputed and resent on every scroll and resize alongside the boxes it was
 * derived from.
 */
export type BlockRect = {
  readonly id: string
  readonly top: number
  readonly left: number
  readonly width: number
  readonly height: number
}

/**
 * The parts of a key press a shortcut is decided by.
 *
 * A `KeyboardEvent` cannot cross a `postMessage`: it is not structured-cloneable, and
 * most of it — the target, `preventDefault`, `repeat`, the frame's own view — means
 * nothing in the other document anyway. These five fields are what a chord *is*.
 */
export type KeyPress = {
  readonly key: string
  readonly metaKey: boolean
  readonly ctrlKey: boolean
  readonly shiftKey: boolean
  readonly altKey: boolean
}

/** What the editor sends into the frame. */
export type CanvasInstruction =
  | { readonly type: 'assemora:render'; readonly tree: BlockTree; readonly selected: string | null }
  /**
   * Bring a block into view.
   *
   * Deliberately not called `select`: `assemora:render` already carries the
   * selection, so a second message that also meant "this is selected" would be two
   * statements of one fact, free to disagree. And revealing is not a consequence of
   * selecting — a click *inside* the canvas selects a block that is already on
   * screen, and scrolling under the pointer that just clicked is hostile. Selecting
   * in the outline reveals; selecting on the canvas does not. That is only sayable
   * if the two are separate messages.
   */
  | { readonly type: 'assemora:reveal'; readonly blockId: string }
  | { readonly type: 'assemora:measure' }

/** What the frame sends back. */
export type CanvasEvent =
  | { readonly type: 'assemora:ready' }
  | { readonly type: 'assemora:selected'; readonly blockId: string | null }
  /**
   * The block under the pointer, or `null` once the pointer has left every block.
   *
   * Only the id: the editor holds the tree and the registry, so it already knows the
   * block's type, its label and its box. Sent on change rather than on movement, so
   * a pointer crossing a page costs one message per block, not one per pixel.
   */
  | { readonly type: 'assemora:hovered'; readonly blockId: string | null }
  /**
   * A key press that landed in the frame instead of in the editor.
   *
   * Clicking a block on the canvas — the way a person picks the block a shortcut is
   * about — moves focus into the iframe, and a key event in one document never
   * reaches a listener on another. So the exact sequence somebody performs, click the
   * block then press ⌘Z, did nothing at all, silently. The frame has to hand the
   * press over or the keyboard is unreachable from the pane the change is about.
   *
   * The frame reports the press; it does not interpret it. Which chord means undo is
   * the editor's vocabulary, and a frame that knew it would be a second copy of the
   * shortcut table, free to fall behind the one Studio uses.
   *
   * Not every keystroke crosses — see `connectCanvas`, which decides. A person typing
   * inside the frame is not commanding the editor, and forwarding what they type
   * would send it to another origin to be thrown away.
   *
   * The editor tells a forwarded press from one of its own by where it arrives: this
   * comes in on `message`, not on `keydown`. It therefore carries no `preventDefault`
   * and needs none — the frame has already cancelled the presses whose default would
   * act on the page under them.
   */
  | { readonly type: 'assemora:pressed'; readonly press: KeyPress }
  | { readonly type: 'assemora:geometry'; readonly blocks: readonly BlockRect[] }

const EVENTS = new Set([
  'assemora:ready',
  'assemora:selected',
  'assemora:hovered',
  'assemora:pressed',
  'assemora:geometry',
])
const INSTRUCTIONS = new Set(['assemora:render', 'assemora:reveal', 'assemora:measure'])

const typeOf = (value: unknown): string | undefined => {
  const candidate = value as { type?: unknown }

  return typeof candidate === 'object' && candidate !== null && typeof candidate.type === 'string'
    ? candidate.type
    : undefined
}

/**
 * Each guard knows only its own half of the protocol.
 *
 * A window receives whatever anyone sends it, so "starts with assemora:" is not a
 * check — it would let the editor's own instructions come back at it as events.
 */
export const isCanvasEvent = (value: unknown): value is CanvasEvent =>
  EVENTS.has(typeOf(value) ?? '')

export const isCanvasInstruction = (value: unknown): value is CanvasInstruction =>
  INSTRUCTIONS.has(typeOf(value) ?? '')

/**
 * Sends one instruction into a canvas frame.
 *
 * `postMessage` takes `any`, so an editor calling it directly can send a message the
 * frame will silently drop — a typo in a message name is a feature that does nothing
 * rather than a compile error. This is the same call with the union in front of it.
 *
 * The origin is required and never `'*'`: a canvas holds a logged-in page, and a
 * frame may be somewhere other than where the editor thinks it is (SPEC.md §85).
 */
export const sendToCanvas = (
  frame: Window | null | undefined,
  instruction: CanvasInstruction,
  origin: string,
): void => {
  frame?.postMessage(instruction, origin)
}
