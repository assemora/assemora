/**
 * The document Studio's builder canvas frames (SPEC.md §59).
 *
 * Without `?editing=1` this is an ordinary page that knows nothing about a builder,
 * which is what a visitor gets. With it, three messages go out — ready, selected,
 * geometry — and one comes in: the tree to draw. Studio never reaches inside the
 * frame; it draws its selection outline over the geometry reported from here.
 */
import { blockAt, type CanvasEvent, isCanvasInstruction, measureBlocks } from '@assemora/react'
import type { BlockTree } from '@assemora/schema'
import { StrictMode, useCallback, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'

import { readTree, Site } from './site.tsx'

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

const Preview = () => {
  const [tree, setTree] = useState<BlockTree>({ blocks: [] })
  const [failure, setFailure] = useState<string>()

  const measure = useCallback(() => {
    post({ type: 'assemora:geometry', blocks: measureBlocks(document) })
  }, [])

  // The canvas names a page by id; anything else asks for a slug. Both go through the
  // same *authorized* query, so this document is the builder's preview rather than
  // the site: signed out it says so rather than drawing anything. The public surface
  // of this example is the two routes in `src/routes.ts` — and `examples/company`
  // shows the other arrangement, where `/preview` really is what a visitor opens.
  useEffect(() => {
    readTree(pageId === '' ? { slug, mode } : { id: pageId, mode })
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
    <Preview />
  </StrictMode>,
)
