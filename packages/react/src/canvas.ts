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
 */
import type { BlockTree } from '@assemora/schema'

export const CANVAS_ORIGIN_MESSAGE = 'assemora:canvas'

export type BlockRect = {
  readonly id: string
  readonly top: number
  readonly left: number
  readonly width: number
  readonly height: number
}

/** What the editor sends into the frame. */
export type CanvasInstruction =
  | { readonly type: 'assemora:render'; readonly tree: BlockTree; readonly selected: string | null }
  | { readonly type: 'assemora:select'; readonly blockId: string | null }
  | { readonly type: 'assemora:measure' }

/** What the frame sends back. */
export type CanvasEvent =
  | { readonly type: 'assemora:ready' }
  | { readonly type: 'assemora:selected'; readonly blockId: string | null }
  | { readonly type: 'assemora:geometry'; readonly blocks: readonly BlockRect[] }

const EVENTS = new Set(['assemora:ready', 'assemora:selected', 'assemora:geometry'])
const INSTRUCTIONS = new Set(['assemora:render', 'assemora:select', 'assemora:measure'])

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
