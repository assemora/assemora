/**
 * `/preview` — the document Studio's builder canvas frames (SPEC.md §59).
 *
 * The canvas is an iframe pointed at `/preview` *on Studio's own origin*, which is
 * why `next.config.ts` forwards `/studio` here rather than sending a browser to two
 * places: same origin, so the iframe and the editor may speak, and so this request
 * arrives carrying the editor's session cookie.
 *
 * That cookie is the whole reason this route is server-rendered. A draft is
 * unpublished work, so it is read as *the person looking at it* and not as the
 * frontend's read-only token — if they may not see the draft, neither may the canvas.
 * The tree then goes to a client component, which owns the conversation with the
 * editor and re-renders on every edit without another round trip.
 */
import { type BlockTree, emptyTree } from '@assemora/schema'
import { cookies } from 'next/headers'

import { readDraft } from '../lib/assemora.ts'
import { Canvas } from './canvas.tsx'

/**
 * Rendered per request, never at build time.
 *
 * The content lives in Assemora, so baking this page into the bundle would freeze it
 * at whatever the database held when somebody ran `next build` — and that build may
 * be in CI, where the API is not running at all. A CMS page is dynamic by nature;
 * add `revalidate` if you want it cached for a while instead.
 */
export const dynamic = 'force-dynamic'

type SearchParams = Promise<Record<string, string | string[] | undefined>>

/** A repeated query parameter is a mistake, not a list: take the first. */
const one = (value: string | string[] | undefined): string =>
  Array.isArray(value) ? (value[0] ?? '') : (value ?? '')

/**
 * An empty tree rather than an error page.
 *
 * Studio sends the tree in over `postMessage` on every edit, so a refused read costs
 * the canvas its first paint and nothing else — where an exception would replace the
 * builder's canvas with a stack trace nobody can see inside an iframe.
 */
const draft = async (pageId: string): Promise<BlockTree> => {
  if (pageId === '') return emptyTree()

  try {
    return (await readDraft(pageId, (await cookies()).toString())).tree
  } catch {
    return emptyTree()
  }
}

const Preview = async ({ searchParams }: { searchParams: SearchParams }) => {
  const parameters = await searchParams
  // Studio names the page `page`, asks for `editing=1`, and names itself in `editor`
  // so that both ends can refuse to talk to anybody else.
  const pageId = one(parameters.page)

  return (
    <Canvas
      tree={await draft(pageId)}
      editing={one(parameters.editing) === '1'}
      editor={one(parameters.editor)}
    />
  )
}

export default Preview
