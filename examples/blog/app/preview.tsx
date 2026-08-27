/**
 * The document Studio's builder canvas frames (SPEC.md §59).
 *
 * Without `?editing=1` this is an ordinary page that knows nothing about a builder,
 * which is what a visitor gets. With it, this frame holds up one end of the canvas
 * protocol — `useCanvasFrame`, from `@assemora/react`, which every Assemora frame
 * shares rather than writing out again: ready, selections, crossings, key presses and
 * geometry go out, and a render, a measure and a reveal come in. Studio never reaches
 * inside the frame; it draws its chrome over the geometry reported from here.
 */
import { useCanvasFrame } from '@assemora/react'
import type { BlockTree } from '@assemora/schema'
import { StrictMode, useEffect, useState } from 'react'
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

const Preview = () => {
  const [tree, setTree] = useState<BlockTree>({ blocks: [] })
  const [failure, setFailure] = useState<string>()

  useCanvasFrame({ editing, editor, tree, render: setTree })

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
