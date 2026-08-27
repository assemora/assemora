/**
 * The entry document, for both audiences (SPEC.md §59).
 *
 * `/preview` on its own is the site: it reads `?slug=` (or `home`) from the public
 * route and renders it. `/preview?page=<id>&editing=1&editor=<origin>` is the builder
 * canvas: it reads the draft through the authorized query and holds up one end of the
 * canvas protocol — `useCanvasFrame`, from `@assemora/react`, which every Assemora
 * frame shares rather than writing out again: ready, selections, crossings, key
 * presses and geometry go out, and a render, a measure and a reveal come in.
 *
 * One bundle, one renderer, one set of block views. That is what makes the preview
 * accurate rather than approximate.
 */
import { useCanvasFrame } from '@assemora/react'
import type { BlockTree } from '@assemora/schema'
import { StrictMode, useEffect, useState } from 'react'
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

const Page = () => {
  const [tree, setTree] = useState<BlockTree>({ blocks: [] })
  const [failure, setFailure] = useState<string>()

  useCanvasFrame({ editing, editor, tree, render: setTree })

  useEffect(() => {
    const first = pageId === '' ? readPublished(slug) : readForEditor(pageId, mode)

    first
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
    <Page />
  </StrictMode>,
)
