/**
 * Where a page lives (SPEC.md §53).
 *
 * Draft and published trees are stored side by side, so what a visitor sees does not
 * change while an editor is still working. Neither is ever HTML: both are block trees
 * (SPEC.md §54, §125.14).
 */
import { enumOf, integer, json, model, string, timestamp, uuid } from '@assemora/data'
import type { BlockTree } from '@assemora/schema'

export type PageMeta = {
  readonly title?: string
  readonly description?: string
  readonly image?: string
  readonly noIndex?: boolean
}

export const Page = model('assemora_pages', {
  id: uuid().primary().defaultRandom(),
  slug: string().unique(),
  title: string(),
  status: enumOf('draft', 'published', 'archived').default('draft'),
  draftTree: json<BlockTree>(),
  publishedTree: json<BlockTree>().nullable(),
  meta: json<PageMeta>(),
  /** Bumped on every write; a mutation may state which one it expected (SPEC.md §66). */
  version: integer().default(1),
  createdBy: uuid().nullable(),
  updatedBy: uuid().nullable(),
  publishedAt: timestamp().nullable(),
  createdAt: timestamp().created(),
  updatedAt: timestamp().updated(),
})

export const pageModels = [Page] as const
