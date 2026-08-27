/**
 * The frontend (SPEC.md §57, §59).
 *
 * This is the page a visitor would get, and it is also what Studio's canvas loads in
 * its iframe. There is one renderer, so a preview cannot drift from the real thing.
 *
 * `?editing=1` marks the blocks in the DOM and starts listening to the editor.
 * Without it this is an ordinary page that knows nothing about a builder.
 *
 * The frame's half of the canvas protocol is `useCanvasFrame` in `@assemora/react`,
 * which every frame shares: reporting ready, selections, crossings, key presses and
 * geometry, and carrying out a render, a measure and a reveal, is the same work in
 * every application, and five hand-written copies of it drifted the moment the
 * protocol grew a message. What is left here is what really is this application's:
 * which page to read, and which views draw it.
 */
import { AssemoraPage, createBlockRegistry, useCanvasFrame } from '@assemora/react'
import type { BlockTree } from '@assemora/schema'
import { StrictMode, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'

import { FaqView, HeroView, MissingView, SectionView } from './views.tsx'
import './theme.css'

const registry = createBlockRegistry(
  { hero: HeroView, section: SectionView, faq: FaqView },
  { fallback: MissingView },
)

const parameters = new URLSearchParams(location.search)
const pageId = parameters.get('page') ?? ''
const mode = parameters.get('mode') === 'draft' ? 'draft' : 'published'
const editing = parameters.get('editing') === '1'

/**
 * The one window this frame will talk to.
 *
 * The editor names itself when it opens the frame, and everything is checked against
 * that: a page anybody can embed must not take instructions from whoever embedded it,
 * and must not broadcast what it is showing (SPEC.md §85).
 */
const editor = parameters.get('editor') ?? ''

const Preview = () => {
  const [tree, setTree] = useState<BlockTree>({ blocks: [] })
  const [failure, setFailure] = useState<string>()

  useCanvasFrame({ editing, editor, tree, render: setTree })

  useEffect(() => {
    const load = async () => {
      const query = new URLSearchParams({ id: pageId, mode })
      const response = await fetch(`/api/queries/pages.get?${query.toString()}`, {
        credentials: 'include',
      })

      if (!response.ok) {
        setFailure(`The page could not be loaded (${response.status})`)
        return
      }

      setTree(((await response.json()) as { tree: BlockTree }).tree)
    }

    if (pageId !== '') void load()
  }, [])

  if (failure !== undefined) return <div className="missing">{failure}</div>

  return (
    <AssemoraPage
      page={{ tree }}
      blocks={registry}
      editing={editing}
      mediaUrl={(id) => `/api/media/by-id/${id}`}
    />
  )
}

const container = document.querySelector('#page')

if (container === null) throw new Error('The preview needs a #page element')

createRoot(container).render(
  <StrictMode>
    <Preview />
  </StrictMode>,
)
