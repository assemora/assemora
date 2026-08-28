/**
 * The public site (SPEC.md §57).
 *
 * One renderer draws a page, and it is this one. Studio's builder canvas loads this
 * very bundle inside its iframe, so a preview cannot drift from what a visitor sees —
 * there is no second implementation for it to drift from (SPEC.md §59).
 *
 * `preview.tsx` is the document that mounts what is here and adds the editor's half
 * of the conversation. Everything the page *looks like* is in this file and in
 * `app/blocks/`.
 */
import { AssemoraPage, type BlockViewProps, createBlockRegistry } from '@assemora/react'
import type { BlockTree } from '@assemora/schema'

import { HeroView } from './blocks/hero.tsx'
import { RichTextView } from './blocks/rich-text.tsx'

/**
 * Drawn where a block type has no view here.
 *
 * A stored page outlives the code that renders it: a block dropped from this project
 * is still in every tree that used it, and a visitor should never be shown a silent
 * gap where one used to be.
 */
const Missing = ({ block }: BlockViewProps) => (
  <p className="missing">No view is registered for a “{block.type}” block.</p>
)

/**
 * Where a block declaration meets its component.
 *
 * The key is the block's type from `src/blocks/`, and this map is the only thing
 * joining the two. Add a block there, add its view here, and the builder can place
 * it.
 */
export const blocks = createBlockRegistry(
  { hero: HeroView, richText: RichTextView },
  { fallback: Missing },
)

/**
 * What a visitor gets: the published tree, by slug, with no session at all.
 *
 * `src/routes.ts` is the other half, and it says why this is a route rather than a
 * policy. Nothing here is authenticated, so `/preview` and `/preview?slug=about` are
 * pages anybody can open.
 */
export const readPublished = async (slug: string): Promise<BlockTree> => {
  const response = await fetch(`/api/site/pages/${encodeURIComponent(slug)}`)

  if (response.status === 404) throw new Error(`No page is published at “${slug}”.`)
  if (!response.ok) throw new Error(`The page could not be loaded (${response.status})`)

  return ((await response.json()) as { tree: BlockTree }).tree
}

/**
 * What the builder's canvas gets: one page by id, in whichever mode it asked for,
 * through the Query Bus the way Studio and an agent reach it (ADR-0014).
 *
 * The session cookie goes with it because a draft is not public: reading is denied by
 * default like every other operation (SPEC.md §50), and the editor looking at the
 * canvas is the actor being authorized. Signed out, this is a 403 — which is correct,
 * and is why the visitor's path above does not use it.
 */
export const readTree = async (parameters: Record<string, string>): Promise<BlockTree> => {
  const query = new URLSearchParams(parameters)
  const response = await fetch(`/api/queries/pages.get?${query.toString()}`, {
    credentials: 'include',
  })

  if (response.status === 403) {
    throw new Error('Sign in to Studio at /studio: an unpublished draft is not public.')
  }

  if (!response.ok) throw new Error(`The page could not be loaded (${response.status})`)

  return ((await response.json()) as { tree: BlockTree }).tree
}

export type SiteProps = {
  readonly tree: BlockTree
  /** Marks each block in the DOM so the builder can find it. Off for a visitor. */
  readonly editing?: boolean
}

export const Site = ({ tree, editing = false }: SiteProps) => (
  <AssemoraPage page={{ tree }} blocks={blocks} editing={editing} />
)
