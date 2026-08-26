/**
 * Where a block declaration meets its component.
 *
 * The key is the block's type from `src/blocks/`, and this map is the only thing
 * joining the two. Add a block there, add its view here, and the builder can place
 * it — in Studio and over MCP, without either of them being told.
 *
 * One registry, imported by both the server-rendered pages and the builder canvas, so
 * a preview cannot drift from what a visitor sees: there is no second implementation
 * for it to drift from (SPEC.md §59).
 */
import { type BlockViewProps, createBlockRegistry } from '@assemora/react'

import { HeroView } from './hero.tsx'
import { RichTextView } from './rich-text.tsx'

/**
 * Drawn where a block type has no view here.
 *
 * A stored page outlives the code that renders it: a block dropped from this project
 * is still in every tree that used it, and a visitor should never be shown a silent
 * gap where one used to be.
 */
const Missing = ({ block }: BlockViewProps) => (
  <p className="missing">No view is registered for a “{block.type}” block.</p>
)

export const blocks = createBlockRegistry(
  { hero: HeroView, richText: RichTextView },
  { fallback: Missing },
)
