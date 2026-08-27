/**
 * The entry document, for both audiences (SPEC.md §57, §59).
 *
 * `/preview` on its own is the site: it takes `?slug=` — or `home`, which is what the
 * seed publishes — and reads the published tree from the public route in
 * `src/routes.ts`. No session, no query parameter to remember, nothing to configure.
 *
 * `/preview?page=<id>&editing=1&editor=<origin>` is the other audience: Studio's
 * builder canvas, which names a page by id and reads the *draft* as the signed-in
 * editor. That is the whole reason the canvas is an iframe pointed here — one
 * renderer, one set of block views, so what an editor sees is the site rather than an
 * imitation of it. While editing, three messages go back — "I am ready", "this block
 * was clicked", "here is where every block is" — and one comes in: the tree to draw.
 * Studio never reaches inside the frame; it draws its selection outline on top of the
 * geometry this file reports.
 */
import { blockAt, type CanvasEvent, isCanvasInstruction, measureBlocks } from '@assemora/react'
import type { BlockTree } from '@assemora/schema'
import { StrictMode, useCallback, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'

import { readPublished, readTree, Site } from './main.tsx'

const parameters = new URLSearchParams(location.search)
const pageId = parameters.get('page') ?? ''
/** The page a visitor gets when the URL names none. The seed publishes this one. */
const slug = parameters.get('slug') ?? 'home'
const mode = parameters.get('mode') === 'draft' ? 'draft' : 'published'
const editing = parameters.get('editing') === '1'

/**
 * The one window this frame will talk to.
 *
 * The editor names itself when it opens the frame, and every message is checked
 * against it in both directions. A page anybody may embed must not take instructions
 * from whoever embedded it, and must not broadcast what it is showing (SPEC.md §85).
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

  // The canvas names a page by id and wants the draft; everybody else asks for a slug
  // and gets what is published. Two readers, because they are two different rights.
  useEffect(() => {
    const first = pageId === '' ? readPublished(slug) : readTree({ id: pageId, mode })

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
    // The outline is drawn over the frame, so a scroll inside it moves every box.
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
