/**
 * `@assemora/react` — the renderer (SPEC.md §57).
 *
 * ```tsx
 * const registry = createBlockRegistry({ hero: HeroView, faq: FaqView })
 *
 * <AssemoraPage page={page} blocks={registry} />
 * ```
 *
 * It depends on `@assemora/schema` and on React, and on nothing else. That is what
 * lets a site put it in a browser bundle without the server layer coming along, and
 * why the block tree types live in `schema` rather than in `pages` (ADR-0016).
 */

export {
  type BlockRect,
  CANVAS_ORIGIN_MESSAGE,
  type CanvasEvent,
  type CanvasInstruction,
  isCanvasEvent,
  isCanvasInstruction,
  type KeyPress,
  sendToCanvas,
} from './canvas.js'
export { DESIGN_CLASS, DesignWrapper, type DesignWrapperProps } from './design.js'
export {
  type CanvasFrame,
  type CanvasFrameOptions,
  connectCanvas,
  type UseCanvasFrameOptions,
} from './frame.js'
export { blockAt, measureBlocks, revealBlock } from './measure.js'
export {
  AssemoraPage,
  type AssemoraPageProps,
  BLOCK_ATTRIBUTE,
  EMPTY_ATTRIBUTE,
  HIDDEN_ATTRIBUTE,
  type RenderablePage,
  TYPE_ATTRIBUTE,
} from './page.js'
export {
  type BlockRegistry,
  type BlockRegistryOptions,
  type BlockView,
  type BlockViewProps,
  type BlockViews,
  createBlockRegistry,
} from './registry.js'
export { useCanvasFrame } from './use-canvas-frame.js'
