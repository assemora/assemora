/**
 * Page and block commands (SPEC.md §60, §66, §70).
 *
 * Every builder operation Studio offers is one of these, which is the whole point:
 * if a person can do it with a mouse, an agent can do it through the same command,
 * with the same validation, the same policies and the same revision (SPEC.md §2).
 */
import {
  AssemoraError,
  type CommandContext,
  ConflictError,
  command,
  currentContext,
  isLocale,
  NotFoundError,
  ValidationError,
} from '@assemora/core'
import { UNSPECIFIED_LOCALE } from '@assemora/data'
import {
  type BlockTree,
  blockDesignPatch,
  boolean,
  emptyTree,
  json,
  number,
  string,
  uuid,
} from '@assemora/schema'

import { Page, type PageMeta } from './models.js'
import {
  addBlock,
  duplicateBlock,
  moveBlock,
  removeBlock,
  setBlockDesign,
  setBlockHidden,
  unfinishedBlocks,
  updateBlockProps,
} from './tree.js'

declare module '@assemora/core' {
  interface AssemoraEventPayloads {
    'page.created': { readonly pageId: string }
    'page.updated': { readonly pageId: string }
    'page.published': { readonly pageId: string; readonly slug: string }
    'page.translated': {
      readonly pageId: string
      readonly translationOf: string
      readonly locale: string
    }
  }
}

type LoadedPage = Awaited<ReturnType<typeof Page.findOrFail>>

/**
 * Reads a page and refuses to go on if someone else has written since.
 *
 * SPEC.md §66: a mutation may carry the version it believes is current, and a
 * mismatch is a 409 rather than a silent overwrite of somebody's newer work.
 */
const loadPage = async (id: string, expectedVersion?: number): Promise<LoadedPage> => {
  const page = await Page.find(id)

  if (page === null) throw new NotFoundError('page', id)

  if (expectedVersion !== undefined && page.version !== expectedVersion) {
    throw new ConflictError('This page has changed since it was read', {
      expectedVersion,
      currentVersion: page.version,
    })
  }

  return page
}

const snapshotOf = (page: LoadedPage) => page.toJSON()

const VERSIONED = { id: uuid(), expectedVersion: number().integer().optional() }

export const CreatePage = command('pages.create', {
  description: 'Creates an empty page',
  input: { slug: string().min(1), title: string().min(1), meta: json<PageMeta>().optional() },
  handle: async ({ slug, title, meta }, context) => {
    const page = await Page.create({
      slug,
      title,
      status: 'draft',
      // The language this is being written in, and nothing it translates. `slug` is
      // unique within a language, so the same address in another one is another page.
      locale: currentContext()?.locale ?? UNSPECIFIED_LOCALE,
      translationOf: null,
      draftTree: emptyTree(),
      publishedTree: null,
      meta: meta ?? {},
      version: 1,
      createdBy: context.actor?.id ?? null,
      updatedBy: context.actor?.id ?? null,
      publishedAt: null,
    })

    context.revise({
      entityType: 'pages',
      entityId: page.id,
      before: null,
      after: snapshotOf(page),
    })
    context.emit('page.created', { pageId: page.id })

    return { id: page.id, slug: page.slug, version: page.version }
  },
})

export const UpdatePage = command('pages.update', {
  description: 'Renames a page or changes its metadata',
  input: {
    ...VERSIONED,
    title: string().min(1).optional(),
    slug: string().min(1).optional(),
    meta: json<PageMeta>().optional(),
  },
  handle: async ({ id, expectedVersion, title, slug, meta }, context) => {
    const page = await loadPage(id, expectedVersion)
    const before = snapshotOf(page)

    await context.authorize('pages', 'update', before)

    await page.update({
      ...(title === undefined ? {} : { title }),
      ...(slug === undefined ? {} : { slug }),
      ...(meta === undefined ? {} : { meta }),
      version: page.version + 1,
      updatedBy: context.actor?.id ?? null,
    })

    context.revise({ entityType: 'pages', entityId: id, before, after: snapshotOf(page) })
    context.emit('page.updated', { pageId: id })

    return { id, version: page.version }
  },
})

export const PublishPage = command('pages.publish', {
  description: 'Makes the draft tree the one visitors see',
  input: VERSIONED,
  handle: async ({ id, expectedVersion }, context) => {
    const page = await loadPage(id, expectedVersion)
    const before = snapshotOf(page)

    await context.authorize('pages', 'publish', before)

    // A draft may hold a block nobody has filled in. What visitors see may not.
    const unfinished = unfinishedBlocks(page.draftTree)

    if (unfinished.length > 0) throw new ValidationError(unfinished)

    await page.update({
      status: 'published',
      publishedTree: page.draftTree,
      publishedAt: new Date(),
      version: page.version + 1,
      updatedBy: context.actor?.id ?? null,
    })

    context.revise({ entityType: 'pages', entityId: id, before, after: snapshotOf(page) })
    context.emit('page.published', { pageId: id, slug: page.slug })

    return { id, version: page.version, publishedAt: page.publishedAt }
  },
})

/** Everything a tree edit owes the pipeline once it has produced a new tree. */
const commitTree = async (
  page: LoadedPage,
  before: Record<string, unknown>,
  tree: BlockTree,
  context: CommandContext,
  blockId?: string,
) => {
  await page.update({
    draftTree: tree,
    version: page.version + 1,
    updatedBy: context.actor?.id ?? null,
  })

  context.revise({ entityType: 'pages', entityId: page.id, before, after: snapshotOf(page) })
  context.emit('page.updated', { pageId: page.id })

  // The new tree comes back with the new version.
  //
  // An editor has to draw the result of what it just did, and a client that had to
  // re-read the page to learn it would spend a round trip per keystroke — and would
  // be tempted to keep its own copy of these operations instead, which is exactly the
  // duplicated business logic Studio must not have (SPEC.md §58).
  return {
    id: page.id,
    version: page.version,
    tree: page.draftTree,
    ...(blockId === undefined ? {} : { blockId }),
  }
}

/** Reads the page, checks the version and asks the policy — the three every edit owes. */
const openForEdit = async (
  id: string,
  expectedVersion: number | undefined,
  context: CommandContext,
) => {
  const page = await loadPage(id, expectedVersion)
  const before = snapshotOf(page)

  await context.authorize('pages', 'update', before)

  return { page, before }
}

export const AddBlock = command('blocks.add', {
  description: 'Adds a block to a page',
  subject: 'pages',
  input: {
    ...VERSIONED,
    type: string().min(1),
    props: json<Record<string, unknown>>().optional(),
    parentId: uuid().optional(),
    index: number().integer().optional(),
  },
  handle: async (values, context) => {
    const { page, before } = await openForEdit(values.id, values.expectedVersion, context)

    const added = addBlock(page.draftTree, {
      type: values.type,
      ...(values.props === undefined ? {} : { props: values.props }),
      ...(values.parentId === undefined ? {} : { parentId: values.parentId }),
      ...(values.index === undefined ? {} : { index: values.index }),
    })

    return commitTree(page, before, added.tree, context, added.id)
  },
})

export const UpdateBlock = command('blocks.update', {
  description: 'Changes the props of a block',
  subject: 'pages',
  input: { ...VERSIONED, blockId: uuid(), props: json<Record<string, unknown>>() },
  handle: async (values, context) => {
    const { page, before } = await openForEdit(values.id, values.expectedVersion, context)

    return commitTree(
      page,
      before,
      updateBlockProps(page.draftTree, values.blockId, values.props),
      context,
    )
  },
})

export const DesignBlock = command('blocks.design', {
  description: 'Sets the universal design controls of a block (SPEC.md §61)',
  subject: 'pages',
  input: {
    ...VERSIONED,
    blockId: uuid(),
    /** Merged into what is there. A control set to `null` goes back to the theme. */
    design: blockDesignPatch(),
  },
  handle: async (values, context) => {
    const { page, before } = await openForEdit(values.id, values.expectedVersion, context)

    return commitTree(
      page,
      before,
      setBlockDesign(page.draftTree, values.blockId, values.design),
      context,
    )
  },
})

export const MoveBlock = command('blocks.move', {
  description: 'Moves a block, possibly into another one',
  subject: 'pages',
  input: {
    ...VERSIONED,
    blockId: uuid(),
    parentId: uuid().optional(),
    index: number().integer().optional(),
  },
  handle: async (values, context) => {
    const { page, before } = await openForEdit(values.id, values.expectedVersion, context)

    const moved = moveBlock(page.draftTree, values.blockId, {
      ...(values.parentId === undefined ? {} : { parentId: values.parentId }),
      ...(values.index === undefined ? {} : { index: values.index }),
    })

    return commitTree(page, before, moved, context)
  },
})

export const RemoveBlock = command('blocks.remove', {
  description: 'Removes a block and everything inside it',
  subject: 'pages',
  input: { ...VERSIONED, blockId: uuid() },
  handle: async (values, context) => {
    const { page, before } = await openForEdit(values.id, values.expectedVersion, context)

    return commitTree(page, before, removeBlock(page.draftTree, values.blockId), context)
  },
})

export const DuplicateBlock = command('blocks.duplicate', {
  description: 'Copies a block beside itself, with new ids throughout',
  subject: 'pages',
  input: { ...VERSIONED, blockId: uuid() },
  handle: async (values, context) => {
    const { page, before } = await openForEdit(values.id, values.expectedVersion, context)
    const copied = duplicateBlock(page.draftTree, values.blockId)

    return commitTree(page, before, copied.tree, context, copied.id)
  },
})

export const HideBlock = command('blocks.hide', {
  description: 'Keeps a block in the tree and out of the rendered page',
  subject: 'pages',
  input: { ...VERSIONED, blockId: uuid(), hidden: boolean() },
  handle: async (values, context) => {
    const { page, before } = await openForEdit(values.id, values.expectedVersion, context)

    return commitTree(
      page,
      before,
      setBlockHidden(page.draftTree, values.blockId, values.hidden),
      context,
    )
  },
})

export const UnpublishPage = command('pages.unpublish', {
  description: 'Takes a page off the site without touching its draft',
  input: VERSIONED,
  handle: async ({ id, expectedVersion }, context) => {
    const page = await loadPage(id, expectedVersion)
    const before = snapshotOf(page)

    await context.authorize('pages', 'unpublish', before)

    await page.update({
      status: 'draft',
      publishedTree: null,
      publishedAt: null,
      version: page.version + 1,
      updatedBy: context.actor?.id ?? null,
    })

    context.revise({ entityType: 'pages', entityId: id, before, after: snapshotOf(page) })
    context.emit('page.updated', { pageId: id })

    return { id, version: page.version }
  },
})

export const ArchivePage = command('pages.archive', {
  description: 'Files a page away: off the site, out of the list, still restorable',
  input: VERSIONED,
  handle: async ({ id, expectedVersion }, context) => {
    const page = await loadPage(id, expectedVersion)
    const before = snapshotOf(page)

    await context.authorize('pages', 'archive', before)

    await page.update({
      status: 'archived',
      publishedTree: null,
      publishedAt: null,
      version: page.version + 1,
      updatedBy: context.actor?.id ?? null,
    })

    context.revise({ entityType: 'pages', entityId: id, before, after: snapshotOf(page) })
    context.emit('page.updated', { pageId: id })

    return { id, version: page.version }
  },
})

export const DeletePage = command('pages.delete', {
  description: 'Deletes a page. Its revisions outlive it',
  input: VERSIONED,
  handle: async ({ id, expectedVersion }, context) => {
    const page = await loadPage(id, expectedVersion)
    const before = snapshotOf(page)

    await context.authorize('pages', 'delete', before)

    await page.delete()

    context.revise({ entityType: 'pages', entityId: id, before, after: null })
    context.emit('page.updated', { pageId: id })

    return { id }
  },
})

export const TranslatePage = command('pages.translate', {
  description: 'Writes a page in another language, starting from a copy of this one',
  input: {
    id: uuid(),
    locale: string().min(1),
    /** Its own address, where the translation wants one. Defaults to the original's. */
    slug: string().min(1).optional(),
    title: string().min(1).optional(),
  },
  handle: async ({ id, locale, slug, title }, context) => {
    const served = currentContext()?.locales

    if (!isLocale(served, locale)) {
      throw new AssemoraError(
        'UNKNOWN_LOCALE',
        `"${locale}" is not a language this deployment serves${
          served === undefined ? '' : ` (${served.locales.join(', ')})`
        }.`,
        { status: 400 },
      )
    }

    const source = await loadPage(id)

    await context.authorize('pages', 'update', snapshotOf(source))

    if (source.locale === locale) {
      throw new AssemoraError('ALREADY_IN_LOCALE', `This page is already written in "${locale}".`, {
        status: 409,
      })
    }

    /**
     * A translation of a translation belongs to the original, or the fallback — which
     * groups by `translationOf` — would see two pages where the site has one.
     */
    const original = source.translationOf ?? id

    const already = await Page.allLocales()
      .where('translationOf', original)
      .where('locale', locale)
      .first()

    if (already !== null) {
      throw new AssemoraError(
        'TRANSLATION_EXISTS',
        `This page is already translated into "${locale}". Edit that translation instead: ${already.id}.`,
        { status: 409 },
      )
    }

    /**
     * The draft tree, copied — and no published one.
     *
     * A translator edits the original's blocks in place, which is the only way a page of
     * text gets translated at all. It starts unpublished on purpose: a translation that
     * went live the moment it was made would put the *original's* words under the new
     * language's address, and say they were a translation. Until it is published,
     * `pages.get` answers a visitor with the original, which is the truth.
     */
    const made = await Page.create({
      slug: slug ?? source.slug,
      title: title ?? source.title,
      status: 'draft',
      draftTree: source.draftTree,
      publishedTree: null,
      meta: source.meta,
      version: 1,
      locale,
      translationOf: original,
      createdBy: context.actor?.id ?? null,
      updatedBy: context.actor?.id ?? null,
      publishedAt: null,
    })

    // Its own history, because a translation is a row (SPEC.md §64, §131).
    context.revise({
      entityType: 'pages',
      entityId: made.id,
      before: null,
      after: snapshotOf(made),
    })
    context.emit('page.translated', { pageId: made.id, translationOf: original, locale })

    return { id: made.id, slug: made.slug, locale, version: made.version }
  },
})

export const pageCommands = [
  CreatePage,
  UpdatePage,
  PublishPage,
  UnpublishPage,
  ArchivePage,
  DeletePage,
  AddBlock,
  UpdateBlock,
  MoveBlock,
  RemoveBlock,
  DuplicateBlock,
  HideBlock,
  DesignBlock,
  TranslatePage,
] as const
