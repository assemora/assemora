'use client'

/**
 * The editor's half of the conversation (SPEC.md §59).
 *
 * The protocol itself is `useCanvasFrame`, from `@assemora/react`: ready, selections,
 * crossings, key presses and geometry go out, and a render, a measure and a reveal
 * come in. Every frame in every Assemora application holds up the same end of it, so
 * it is written once, there — a copy in each project falls a version behind the next
 * time the protocol grows a message, and nothing mechanical notices, because a
 * listener that is merely out of date still compiles.
 *
 * Studio never reaches inside the frame; it draws its own chrome on top of the
 * geometry reported from here, so nothing the editor does changes what the page looks
 * like.
 *
 * This is the one file in `app/` that has to run in the browser, and it is marked as
 * such. Everything it renders — `AssemoraPage`, the block views — is the same code the
 * server renders for a visitor, which is what makes the preview accurate rather than
 * approximate.
 */
import { AssemoraPage, useCanvasFrame } from '@assemora/react'
import type { BlockTree } from '@assemora/schema'
import { useState } from 'react'

import { blocks } from '../blocks/registry.tsx'

export type CanvasProps = {
  /** Rendered on the server from the draft, then replaced by whatever the editor sends. */
  readonly tree: BlockTree
  readonly editing: boolean
  /**
   * The origin Studio is on.
   *
   * Every message is checked against it in both directions. A page anybody may embed
   * must not take instructions from whoever embedded it, and must not broadcast what
   * it is showing (SPEC.md §85).
   */
  readonly editor: string
}

export const Canvas = ({ tree, editing, editor }: CanvasProps) => {
  const [drawn, setDrawn] = useState(tree)

  useCanvasFrame({ editing, editor, tree: drawn, render: setDrawn })

  return <AssemoraPage page={{ tree: drawn }} blocks={blocks} editing={editing} />
}
