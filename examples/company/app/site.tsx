/**
 * The site: one registry, one renderer, two ways to fetch a page (SPEC.md §57, §59).
 *
 * The two readers below are the whole difference between a visitor and an editor.
 * Studio's canvas asks for a page by id, in draft, through the authorized query it
 * already has a session for. Everybody else asks for a slug through the public route,
 * which serves the published tree and refuses to serve anything else.
 */
import { AssemoraPage, createBlockRegistry } from '@assemora/react'
import type { BlockTree } from '@assemora/schema'

import {
  CtaView,
  FeatureView,
  HeroView,
  MissingView,
  OpeningsView,
  ProseView,
  SectionView,
  TeamView,
} from './blocks.tsx'

/**
 * Where a block declaration meets its component.
 *
 * The key is the block's `type` from `src/blocks.ts`, and this map is the only thing
 * joining the two. Add a block there, add its view here, and the builder can place it.
 */
export const blocks = createBlockRegistry(
  {
    hero: HeroView,
    section: SectionView,
    feature: FeatureView,
    prose: ProseView,
    cta: CtaView,
    team: TeamView,
    openings: OpeningsView,
  },
  { fallback: MissingView },
)

/** What a visitor gets: published, by slug, with no session (`src/routes.ts`). */
export const readPublished = async (slug: string): Promise<BlockTree> => {
  const response = await fetch(`/api/site/pages/${encodeURIComponent(slug)}`)

  if (!response.ok) throw new Error(`No published page at “${slug}” (${response.status})`)

  return ((await response.json()) as { tree: BlockTree }).tree
}

/** What the canvas gets: by id, in whichever mode it asked for, as the signed-in editor. */
export const readForEditor = async (id: string, mode: string): Promise<BlockTree> => {
  const query = new URLSearchParams({ id, mode })
  const response = await fetch(`/api/queries/pages.get?${query.toString()}`, {
    credentials: 'include',
  })

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
