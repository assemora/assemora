/**
 * Reading pages (SPEC.md §15, §53).
 *
 * A page is read through the Query Bus, so the same validation, authorization and
 * naming apply as to everything else and no layer above needs to depend on this one
 * (ADR-0014). A browser reaches these through `server.mountQueries()`.
 */
import { NotFoundError, query } from '@assemora/core'
import { type BlockTree, emptyTree, enumOf, number, string, uuid } from '@assemora/schema'

import { Page } from './models.js'

export type PageMode = 'draft' | 'published'

/**
 * What a reader gets: one tree, already chosen.
 *
 * Handing back both trees would make every caller decide which one it meant, and a
 * visitor's renderer would be one mistake away from showing an unpublished draft.
 */
const project = (page: Awaited<ReturnType<typeof Page.findOrFail>>, mode: PageMode) => ({
  id: page.id,
  slug: page.slug,
  title: page.title,
  status: page.status,
  mode,
  tree: (mode === 'draft' ? page.draftTree : (page.publishedTree ?? emptyTree())) as BlockTree,
  meta: page.meta,
  /** Every mutation echoes this back as `expectedVersion` (SPEC.md §66). */
  version: page.version,
  /** True when the draft has moved on from what visitors see. */
  hasUnpublishedChanges:
    page.publishedTree === null ||
    JSON.stringify(page.draftTree) !== JSON.stringify(page.publishedTree),
  publishedAt: page.publishedAt,
  updatedAt: page.updatedAt,
  updatedBy: page.updatedBy,
})

export const ListPages = query('pages.list', {
  description: 'A page of pages, most recently changed first',
  input: {
    status: enumOf('draft', 'published', 'archived').optional(),
    search: string().optional(),
    page: number().integer().optional(),
    perPage: number().integer().optional(),
  },
  handle: async ({ status, search, page, perPage }) => {
    let found = Page.orderBy('updatedAt', 'desc')

    if (status !== undefined) found = found.where('status', status)
    if (search !== undefined && search !== '') found = found.whereLike('title', `%${search}%`)

    const listed = await found.paginate(page ?? 1, Math.min(perPage ?? 20, 100))

    return {
      ...listed,
      data: listed.data.map((item) => ({
        id: item.id,
        slug: item.slug,
        title: item.title,
        status: item.status,
        version: item.version,
        publishedAt: item.publishedAt,
        updatedAt: item.updatedAt,
      })),
    }
  },
})

export const GetPage = query('pages.get', {
  description: 'One page, with the draft tree or the published one',
  input: {
    id: uuid().optional(),
    slug: string().optional(),
    mode: enumOf('draft', 'published').optional(),
  },
  handle: async ({ id, slug, mode }) => {
    const found =
      id !== undefined
        ? await Page.find(id)
        : slug === undefined
          ? null
          : await Page.where('slug', slug).first()

    if (found === null) throw new NotFoundError('page', id ?? slug ?? '')

    // Published by default: a visitor's renderer must never show a draft because a
    // parameter was forgotten.
    return project(found, mode ?? 'published')
  },
})

export const pageQueries = [ListPages, GetPage] as const
