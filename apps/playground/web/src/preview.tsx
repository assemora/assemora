/**
 * The frontend (SPEC.md §57, §59).
 *
 * This is the page a visitor would get, and it is also what Studio's canvas loads in
 * its iframe. There is one renderer, so a preview cannot drift from the real thing.
 *
 * `?editing=1` marks the blocks in the DOM and starts listening to the editor.
 * Without it this is an ordinary page that knows nothing about a builder.
 */
import {
  AssemoraPage,
  blockAt,
  type CanvasEvent,
  type CanvasInstruction,
  createBlockRegistry,
  isCanvasInstruction,
  measureBlocks,
} from '@assemora/react'
import type { BlockTree } from '@assemora/schema'
import { StrictMode, useCallback, useEffect, useRef, useState } from 'react'
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

const post = (event: CanvasEvent): void => {
  if (editing && editor !== '') parent.postMessage(event, editor)
}

const Preview = () => {
  const [tree, setTree] = useState<BlockTree>({ blocks: [] })
  const [failure, setFailure] = useState<string>()
  const frame = useRef<HTMLDivElement>(null)

  const measure = useCallback(() => {
    post({ type: 'assemora:geometry', blocks: measureBlocks(document) })
  }, [])

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

  useEffect(() => {
    if (!editing) return

    const onMessage = (event: MessageEvent) => {
      if (event.origin !== editor || event.source !== parent) return
      if (!isCanvasInstruction(event.data)) return

      const instruction = event.data as CanvasInstruction

      if (instruction.type === 'assemora:render') setTree(instruction.tree)
      if (instruction.type === 'assemora:measure') measure()
    }

    const onClick = (event: MouseEvent) => {
      // The editor selects; a link inside the canvas must not navigate the frame.
      event.preventDefault()
      post({ type: 'assemora:selected', blockId: blockAt(event.target) })
    }

    window.addEventListener('message', onMessage)
    document.addEventListener('click', onClick, true)
    window.addEventListener('resize', measure)
    // The editor draws its outline over the frame, so a scroll inside the frame moves
    // every box it is drawing.
    window.addEventListener('scroll', measure, { passive: true })

    post({ type: 'assemora:ready' })

    return () => {
      window.removeEventListener('message', onMessage)
      document.removeEventListener('click', onClick, true)
      window.removeEventListener('resize', measure)
      window.removeEventListener('scroll', measure)
    }
  }, [measure])

  // Every render moves the boxes the editor draws its outlines from, so the tree is
  // the dependency even though the measuring does not read it.
  // biome-ignore lint/correctness/useExhaustiveDependencies: measuring follows the render
  useEffect(() => {
    const timer = setTimeout(measure, 0)

    return () => clearTimeout(timer)
  }, [tree, measure])

  if (failure !== undefined) return <div className="missing">{failure}</div>

  return (
    <div ref={frame}>
      <AssemoraPage
        page={{ tree }}
        blocks={registry}
        editing={editing}
        mediaUrl={(id) => `/api/media/by-id/${id}`}
      />
    </div>
  )
}

const container = document.querySelector('#page')

if (container === null) throw new Error('The preview needs a #page element')

createRoot(container).render(
  <StrictMode>
    <Preview />
  </StrictMode>,
)
