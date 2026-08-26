/**
 * The entry document, for both audiences (SPEC.md §59).
 *
 * `/preview` on its own is the site: it reads `?slug=` (or `home`) from the public
 * route and renders it. `/preview?page=<id>&editing=1&editor=<origin>` is the builder
 * canvas: it reads the draft through the authorized query and starts the conversation
 * Studio's editor is on the other end of.
 *
 * One bundle, one renderer, one set of block views. That is what makes the preview
 * accurate rather than approximate.
 */
import { blockAt, type CanvasEvent, isCanvasInstruction, measureBlocks } from '@assemora/react'
import type { BlockTree } from '@assemora/schema'
import { StrictMode, useCallback, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'

import { readForEditor, readPublished, Site } from './site.tsx'
import './theme.css'

const parameters = new URLSearchParams(location.search)
const pageId = parameters.get('page') ?? ''
const slug = parameters.get('slug') ?? 'home'
const mode = parameters.get('mode') === 'draft' ? 'draft' : 'published'
const editing = parameters.get('editing') === '1'

/**
 * The one window this frame will talk to. A page anybody may embed must not take
 * instructions from whoever embedded it, nor broadcast what it is showing.
 */
const editor = parameters.get('editor') ?? ''

const post = (event: CanvasEvent): void => {
  if (editing && editor !== '') parent.postMessage(event, editor)
}

const Page = () => {
  const [tree, setTree] = useState<BlockTree>({ blocks: [] })
  const [failure, setFailure] = useState<string>()

  const measure = useCallback(() => {
    post({ type: 'assemora:geometry', blocks: measureBlocks(document) })
  }, [])

  useEffect(() => {
    const first = pageId === '' ? readPublished(slug) : readForEditor(pageId, mode)

    first
      .then(setTree)
      .catch((error: unknown) => setFailure(error instanceof Error ? error.message : String(error)))
  }, [])

  useEffect(() => {
    if (!editing) return

    const onMessage = (event: MessageEvent) => {
      if (event.origin !== editor || event.source !== parent) return
      if (isCanvasInstruction(event.data) && event.data.type === 'assemora:render') {
        setTree(event.data.tree)
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
    window.addEventListener('scroll', measure, { passive: true })

    post({ type: 'assemora:ready' })

    return () => {
      window.removeEventListener('message', onMessage)
      document.removeEventListener('click', onClick, true)
      window.removeEventListener('resize', measure)
      window.removeEventListener('scroll', measure)
    }
  }, [measure])

  // Every render moves the boxes the editor outlines, so the tree is the dependency
  // even though the measuring does not read it.
  // biome-ignore lint/correctness/useExhaustiveDependencies: measuring follows the render
  useEffect(() => {
    const timer = setTimeout(measure, 0)

    return () => clearTimeout(timer)
  }, [tree, measure])

  if (failure !== undefined) return <p className="missing">{failure}</p>

  return <Site tree={tree} editing={editing} />
}

const container = document.querySelector('#site')

if (container === null) throw new Error('index.html needs a #site element to render into')

createRoot(container).render(
  <StrictMode>
    <Page />
  </StrictMode>,
)
