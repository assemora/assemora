'use client'

/**
 * The editor's half of the conversation (SPEC.md §59).
 *
 * Three messages go out — "I am ready", "this block was clicked", "here is where every
 * block is" — and one comes in: the tree to draw. Studio never reaches inside the
 * frame; it draws its own selection outline on top of the geometry reported here, so
 * nothing the editor does changes what the page looks like.
 *
 * This is the one file in `app/` that has to run in the browser, and it is marked as
 * such. Everything it renders — `AssemoraPage`, the block views — is the same code the
 * server renders for a visitor, which is what makes the preview accurate rather than
 * approximate.
 */
import {
  AssemoraPage,
  blockAt,
  type CanvasEvent,
  isCanvasInstruction,
  measureBlocks,
} from '@assemora/react'
import type { BlockTree } from '@assemora/schema'
import { useCallback, useEffect, useState } from 'react'

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

  const post = useCallback(
    (event: CanvasEvent) => {
      if (editing && editor !== '') parent.postMessage(event, editor)
    },
    [editing, editor],
  )

  const measure = useCallback(() => {
    post({ type: 'assemora:geometry', blocks: measureBlocks(document) })
  }, [post])

  useEffect(() => {
    if (!editing) return

    const onMessage = (event: MessageEvent) => {
      if (event.origin !== editor || event.source !== parent) return
      if (isCanvasInstruction(event.data) && event.data.type === 'assemora:render') {
        setDrawn(event.data.tree)
      }
    }

    // The editor selects a block; a link inside the canvas must not navigate away.
    const onClick = (event: MouseEvent) => {
      event.preventDefault()
      post({ type: 'assemora:selected', blockId: blockAt(event.target) })
    }

    window.addEventListener('message', onMessage)
    document.addEventListener('click', onClick, true)
    window.addEventListener('resize', measure)
    // The outline is drawn over the frame, so a scroll inside it moves every box.
    window.addEventListener('scroll', measure, { passive: true })

    post({ type: 'assemora:ready' })

    return () => {
      window.removeEventListener('message', onMessage)
      document.removeEventListener('click', onClick, true)
      window.removeEventListener('resize', measure)
      window.removeEventListener('scroll', measure)
    }
  }, [editing, editor, measure, post])

  // Every render moves the boxes the editor outlines, so the tree is the dependency
  // even though the measuring does not read it.
  // biome-ignore lint/correctness/useExhaustiveDependencies: measuring follows the render
  useEffect(() => {
    const timer = setTimeout(measure, 0)

    return () => clearTimeout(timer)
  }, [drawn, measure])

  return <AssemoraPage page={{ tree: drawn }} blocks={blocks} editing={editing} />
}
