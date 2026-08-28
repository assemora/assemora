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
 * imitation of it.
 *
 * The conversation with the editor is `useCanvasFrame`, from `@assemora/react`.
 * Every frame in every Assemora application holds up the same end of it — ready,
 * selections, crossings, key presses, geometry, and the render, measure and reveal
 * that come back — so it is written once, there, rather than copied into each new
 * project to fall a version behind the next time it grows a message. Studio never
 * reaches inside the frame; it draws its chrome over the geometry reported from here.
 */
import { useCanvasFrame } from '@assemora/react'
import type { BlockTree } from '@assemora/schema'
import { StrictMode, useEffect, useState } from 'react'
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

const Preview = () => {
  const [tree, setTree] = useState<BlockTree>({ blocks: [] })
  const [failure, setFailure] = useState<string>()

  useCanvasFrame({ editing, editor, tree, render: setTree })

  // The canvas names a page by id and wants the draft; everybody else asks for a slug
  // and gets what is published. Two readers, because they are two different rights.
  useEffect(() => {
    const first = pageId === '' ? readPublished(slug) : readTree({ id: pageId, mode })

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
    <Preview />
  </StrictMode>,
)
