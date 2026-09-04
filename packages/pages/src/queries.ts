/**
 * Reading pages (SPEC.md §15, §53).
 *
 * A page is read through the Query Bus, so the same validation, authorization and
 * naming apply as to everything else and no layer above needs to depend on this one
 * (ADR-0014). A browser reaches these through `server.mountQueries()`.
 */
import { NotFoundError, query } from '@assemora/core'
import {
  array,
  type BlockTree,
  blockTree,
  boolean,
  emptyTree,
  enumOf,
  json,
  number,
  object,
  string,
  timestamp,
  uuid,
} from '@assemora/schema'

import { Page, type PageMeta } from './models.js'

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
  /**
   * Which language this page is actually written in, and which page it is one language
   * of (SPEC.md §131).
   *
   * Beside the id for the reason a resource read carries them: a reader that cannot tell
   * a translation from a fallback has been handed the wrong answer without being told,
   * and a link to another language needs the entry rather than the row.
   */
  locale: page.locale,
  translationOf: page.translationOf,
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
  output: {
    data: array(
      object({
        id: uuid(),
        slug: string(),
        title: string(),
        status: enumOf('draft', 'published', 'archived'),
        locale: string(),
        translationOf: uuid().nullable(),
        version: number(),
        publishedAt: timestamp().nullable(),
        updatedAt: timestamp(),
      }),
    ),
    total: number(),
    page: number(),
    perPage: number(),
    lastPage: number(),
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
        locale: item.locale,
        translationOf: item.translationOf,
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
  output: {
    id: uuid(),
    slug: string(),
    title: string(),
    status: enumOf('draft', 'published', 'archived'),
    locale: string(),
    translationOf: uuid().nullable(),
    mode: enumOf('draft', 'published'),
    tree: blockTree(),
    meta: json<PageMeta>(),
    version: number(),
    hasUnpublishedChanges: boolean(),
    publishedAt: timestamp().nullable(),
    updatedAt: timestamp(),
    updatedBy: uuid().nullable(),
  },
  handle: async ({ id, slug, mode }) => {
    const found =
      id !== undefined
        ? await Page.find(id)
        : slug === undefined
          ? null
          : await Page.where('slug', slug).first()

    if (found === null) throw new NotFoundError('page', id ?? slug ?? '')

    /**
     * A translation nobody has published yet is not what a visitor gets (SPEC.md §131).
     *
     * `pages.translate` copies the original's blocks so a translator has something to
     * work on, and leaves the copy unpublished — so between making it and finishing it,
     * this row exists, has no published tree, and would answer a visitor with an empty
     * page. Worse than the fallback it replaced: before the translation existed, the
     * reader got the original.
     *
     * So a request for the published page steps back to the original, which is what the
     * site showed a minute earlier and what it should go on showing until somebody says
     * the translation is ready.
     */
    if ((mode ?? 'published') === 'published' && found.publishedTree === null) {
      const original = found.translationOf === null ? null : await Page.find(found.translationOf)

      if (original !== null && original.publishedTree !== null) {
        return project(original, 'published')
      }
    }

    // Published by default: a visitor's renderer must never show a draft because a
    // parameter was forgotten.
    return project(found, mode ?? 'published')
  },
})

export const ListPageTranslations = query('pages.translations', {
  description: 'Which languages a page is written in, and which of them are out of date',
  input: { id: uuid() },
  output: {
    translations: array(
      object({
        id: uuid(),
        locale: string(),
        slug: string(),
        status: enumOf('draft', 'published', 'archived'),
        isOriginal: boolean(),
        updatedAt: timestamp(),
        stale: boolean().nullable(),
      }),
    ),
  },
  handle: async ({ id }, context) => {
    const named = await Page.find(id)

    if (named === null) throw new NotFoundError('page', id)

    // The page itself decides who may be told about its other languages, the way
    // `revisions.list` asks about the entity it is the history of (ADR-0015).
    await context.authorize('pages', 'read', named.toJSON())

    const entry = named.translationOf ?? named.id
    const every = await Page.allLocales().get()
    const rows = every.filter((one) => (one.translationOf ?? one.id) === entry)
    const original = rows.find((one) => one.translationOf === null)

    return {
      translations: rows.map((one) => ({
        id: one.id,
        locale: one.locale,
        slug: one.slug,
        status: one.status,
        isOriginal: one.translationOf === null,
        updatedAt: one.updatedAt,
        /**
         * Written before the original last changed.
         *
         * A page stamps `updatedAt` on every write, so unlike a resource this is always
         * answerable — and it is the question a translator's screen is made of: which of
         * these has the original moved on from.
         */
        stale:
          one.translationOf === null || original === undefined
            ? null
            : new Date(one.updatedAt).getTime() < new Date(original.updatedAt).getTime(),
      })),
    }
  },
})

export const pageQueries = [ListPages, GetPage, ListPageTranslations] as const
