/**
 * Pages, blocks, revisions and concurrency (SPEC.md §114).
 *
 * The flow this walks is the one SPEC.md §60 lists as builder operations, performed
 * entirely through commands — which is the point: what Studio does with a mouse, an
 * agent does with the same call, and both leave the same revision behind.
 */
import {
  ConflictError,
  clearRestorers,
  createApplication,
  createLogger,
  permitAll,
  silentWriter,
} from '@assemora/core'
import { dataTransactions, useAdapter } from '@assemora/data'
import { createMemoryAdapter } from '@assemora/database'
import { block, clearBlockRegistry, Page, pages } from '@assemora/pages'
import { select, text } from '@assemora/resources'
import { Revision, revisions, revisionsModule } from '@assemora/revisions'
import { blockIds, findBlock } from '@assemora/schema'
import { beforeEach, describe, expect, it } from 'vitest'

const Hero = block('hero', {
  title: text().required(),
  variant: select('centered', 'split'),
})

const Section = block('section', { title: text() }, { acceptsChildren: true, maxChildren: 1 })

let app: ReturnType<typeof createApplication>

const run = <T>(operation: () => Promise<T>): Promise<T> =>
  app.run(
    { source: 'studio', actor: { type: 'user', id: '11111111-1111-4111-8111-111111111111' } },
    operation,
  )

const execute = (name: string, input: Record<string, unknown>) =>
  run(() => app.commands.execute(name, input)) as Promise<Record<string, unknown>>

const newPage = async () =>
  (await execute('pages.create', { slug: 'home', title: 'Home' })) as {
    id: string
    version: number
  }

/** The same, in a named language, for the multilingual suite at the foot of this file. */
const newPageIn = async (locale: string) =>
  (await app.run(
    {
      source: 'studio',
      locale,
      actor: { type: 'user', id: '11111111-1111-4111-8111-111111111111' },
    },
    () => app.commands.execute('pages.create', { slug: 'home', title: 'Home' }),
  )) as { id: string; version: number }

beforeEach(() => {
  clearBlockRegistry()
  clearRestorers()
  useAdapter(createMemoryAdapter({}))

  app = createApplication({
    modules: [pages({ blocks: [Hero, Section] }), revisionsModule()],
    authorization: permitAll(),
    transactions: dataTransactions(),
    revisions: revisions(),
    logger: createLogger(silentWriter),
  })

  return app.boot()
})

describe('a page starts empty and stays a tree (SPEC.md §53, §54)', () => {
  it('is created as a draft with no blocks', async () => {
    const created = await newPage()
    const page = await Page.findOrFail(created.id)

    expect(page.status).toBe('draft')
    expect(page.draftTree).toEqual({ blocks: [] })
    expect(page.publishedTree).toBeNull()
    expect(page.version).toBe(1)
  })

  it('never stores HTML, whatever is put in it', async () => {
    const created = await newPage()

    await execute('blocks.add', {
      id: created.id,
      type: 'hero',
      props: { title: '<script>alert(1)</script>', variant: 'centered' },
    })

    const page = await Page.findOrFail(created.id)

    expect(page.draftTree.blocks[0]?.type).toBe('hero')
    expect(page.draftTree.blocks[0]?.props.title).toBe('<script>alert(1)</script>')
  })
})

describe('the builder operations of SPEC.md §60', () => {
  it('adds, edits, moves, duplicates, hides and removes', async () => {
    const created = await newPage()

    const added = (await execute('blocks.add', {
      id: created.id,
      type: 'hero',
      props: { title: 'One', variant: 'centered' },
    })) as { blockId: string; version: number }

    await execute('blocks.update', {
      id: created.id,
      blockId: added.blockId,
      props: { title: 'Renamed' },
    })

    const second = (await execute('blocks.add', {
      id: created.id,
      type: 'section',
      props: { title: 'Two' },
    })) as { blockId: string }

    await execute('blocks.move', { id: created.id, blockId: second.blockId, index: 0 })

    const copied = (await execute('blocks.duplicate', {
      id: created.id,
      blockId: added.blockId,
    })) as { blockId: string }

    await execute('blocks.hide', { id: created.id, blockId: copied.blockId, hidden: true })

    const page = await Page.findOrFail(created.id)

    expect(page.draftTree.blocks.map((node) => node.type)).toEqual(['section', 'hero', 'hero'])
    expect(findBlock(page.draftTree, added.blockId)?.props.title).toBe('Renamed')
    expect(findBlock(page.draftTree, copied.blockId)?.hidden).toBe(true)
    expect(new Set(blockIds(page.draftTree)).size).toBe(3)

    await execute('blocks.remove', { id: created.id, blockId: copied.blockId })

    expect((await Page.findOrFail(created.id)).draftTree.blocks).toHaveLength(2)
  })

  it('refuses an invalid tree through the command, not only in the editor', async () => {
    const created = await newPage()

    // A prop that could never be right is refused at once; one that is merely not
    // written yet is not (SPEC.md §55).
    await expect(
      execute('blocks.add', {
        id: created.id,
        type: 'hero',
        props: { title: 'x', variant: 'nonsense' },
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' })

    const section = (await execute('blocks.add', {
      id: created.id,
      type: 'section',
      props: { title: 'Holder' },
    })) as { blockId: string }

    await execute('blocks.add', {
      id: created.id,
      type: 'hero',
      props: { title: 'Inside', variant: 'split' },
      parentId: section.blockId,
    })

    await expect(
      execute('blocks.add', {
        id: created.id,
        type: 'hero',
        props: { title: 'Too many', variant: 'split' },
        parentId: section.blockId,
      }),
    ).rejects.toMatchObject({ code: 'INVALID_BLOCK_TREE' })
  })
})

describe('draft and published are separate (SPEC.md §53)', () => {
  it('leaves visitors on the published tree while the draft moves on', async () => {
    const created = await newPage()

    await execute('blocks.add', {
      id: created.id,
      type: 'hero',
      props: { title: 'Published', variant: 'centered' },
    })
    await execute('pages.publish', { id: created.id })

    const published = await Page.findOrFail(created.id)

    expect(published.status).toBe('published')
    expect(published.publishedTree?.blocks).toHaveLength(1)
    expect(published.publishedAt).toBeInstanceOf(Date)

    await execute('blocks.add', {
      id: created.id,
      type: 'hero',
      props: { title: 'Still a draft', variant: 'split' },
    })

    const later = await Page.findOrFail(created.id)

    expect(later.draftTree.blocks).toHaveLength(2)
    expect(later.publishedTree?.blocks).toHaveLength(1)
  })
})

describe('optimistic concurrency (SPEC.md §66)', () => {
  it('refuses a write that expected an older version', async () => {
    const created = await newPage()

    await execute('pages.update', { id: created.id, expectedVersion: 1, title: 'First edit' })

    await expect(
      execute('pages.update', { id: created.id, expectedVersion: 1, title: 'Second edit' }),
    ).rejects.toThrowError(ConflictError)

    expect((await Page.findOrFail(created.id)).title).toBe('First edit')
  })

  it('says which version it found, so a client can reload and retry', async () => {
    const created = await newPage()
    await execute('pages.update', { id: created.id, expectedVersion: 1, title: 'First' })

    const failure = await execute('pages.update', {
      id: created.id,
      expectedVersion: 1,
      title: 'Second',
    }).catch((error: unknown) => error)

    expect(failure).toMatchObject({
      code: 'CONFLICT',
      status: 409,
      details: { expectedVersion: 1, currentVersion: 2 },
    })
  })

  it('lets a write through when no version was stated', async () => {
    const created = await newPage()
    await execute('pages.update', { id: created.id, expectedVersion: 1, title: 'First' })

    await expect(execute('pages.update', { id: created.id, title: 'Blind' })).resolves.toBeDefined()
  })
})

describe('revisions and restore (SPEC.md §64, §65)', () => {
  it('records every change with what actually differed', async () => {
    const created = await newPage()
    await execute('pages.update', { id: created.id, expectedVersion: 1, title: 'Renamed' })

    const history = await Revision.where('entityId', created.id).oldest().get()

    expect(history).toHaveLength(2)
    expect(history[0]).toMatchObject({ command: 'pages.create', before: null })
    expect(history[1]?.command).toBe('pages.update')
    expect(history[1]?.patch.title).toEqual({ from: 'Home', to: 'Renamed' })
    expect(history[1]?.actorId).toBe('11111111-1111-4111-8111-111111111111')
  })

  it('puts a page back the way a revision left it', async () => {
    const created = await newPage()

    await execute('blocks.add', {
      id: created.id,
      type: 'hero',
      props: { title: 'Wanted', variant: 'centered' },
    })
    await execute('blocks.add', {
      id: created.id,
      type: 'hero',
      props: { title: 'Regretted', variant: 'split' },
    })

    expect((await Page.findOrFail(created.id)).draftTree.blocks).toHaveLength(2)

    const history = await Revision.where('entityId', created.id).oldest().get()
    const withOneBlock = history[1]

    // `restore` means "make it look the way it did then", which is the revision's
    // `after` — the state it left behind (SPEC.md §65).
    await execute('revisions.restore', { id: withOneBlock?.id ?? '' })

    const restored = await Page.findOrFail(created.id)

    expect(restored.draftTree.blocks).toHaveLength(1)
    expect(restored.draftTree.blocks[0]?.props.title).toBe('Wanted')
  })

  it('records the restore as a change of its own', async () => {
    const created = await newPage()
    await execute('pages.update', { id: created.id, expectedVersion: 1, title: 'Renamed' })

    const history = await Revision.where('entityId', created.id).oldest().get()

    await execute('revisions.restore', { id: history[0]?.id ?? '', to: 'after' })

    const after = await Revision.where('entityId', created.id).oldest().get()

    expect(after).toHaveLength(3)
    expect(after[2]?.metadata.restoredFrom).toBe(history[0]?.id)
    expect((await Page.findOrFail(created.id)).title).toBe('Home')
  })

  it('hands the editor the tree an undo produced, not only a version', async () => {
    const created = await newPage()

    await execute('blocks.add', {
      id: created.id,
      type: 'hero',
      props: { title: 'One', variant: 'centered' },
    })

    const undone = (await execute('revisions.undo', {
      entityType: 'pages',
      entityId: created.id,
    })) as { tree?: { blocks: unknown[] }; version?: number }

    // The builder redraws from what the command answered. Without the tree it would
    // have to re-read the page after every undo.
    expect(undone.tree?.blocks).toHaveLength(0)
    expect(undone.version).toBe(3)
    expect(Object.keys(JSON.parse(JSON.stringify(undone)))).toContain('tree')
  })

  it('undoes the last change, and puts it back again (SPEC.md §60)', async () => {
    const created = await newPage()

    await execute('pages.update', { id: created.id, expectedVersion: 1, title: 'Second' })
    await execute('pages.update', { id: created.id, expectedVersion: 2, title: 'Third' })

    const undo = () => execute('revisions.undo', { entityType: 'pages', entityId: created.id })
    const redo = () => execute('revisions.redo', { entityType: 'pages', entityId: created.id })
    const title = async () => (await Page.findOrFail(created.id)).title

    await undo()
    expect(await title()).toBe('Second')

    await undo()
    expect(await title()).toBe('Home')

    await redo()
    expect(await title()).toBe('Second')

    await redo()
    expect(await title()).toBe('Third')

    await expect(redo()).rejects.toMatchObject({ code: 'NOTHING_TO_UNDO' })
  })

  it('refuses to publish a page holding a block nobody finished (SPEC.md §55)', async () => {
    const created = await newPage()

    await execute('blocks.add', { id: created.id, type: 'hero', props: { variant: 'centered' } })

    await expect(execute('pages.publish', { id: created.id })).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    })

    await execute('blocks.update', {
      id: created.id,
      blockId: (await Page.findOrFail(created.id)).draftTree.blocks[0]?.id ?? '',
      props: { title: 'Now it has one' },
    })

    await expect(execute('pages.publish', { id: created.id })).resolves.toMatchObject({
      id: created.id,
    })
  })

  it('undoes a creation by taking the page away again (SPEC.md §65)', async () => {
    const created = await newPage()

    await execute('revisions.undo', { entityType: 'pages', entityId: created.id })

    expect(await Page.find(created.id)).toBeNull()
  })

  it('puts back a page that was deleted, from the revision that deleted it', async () => {
    const created = await newPage()

    await execute('blocks.add', {
      id: created.id,
      type: 'hero',
      props: { title: 'Worth keeping', variant: 'centered' },
    })
    await execute('pages.delete', { id: created.id })

    expect(await Page.find(created.id)).toBeNull()

    // Undoing the deletion is an ordinary undo: the page comes back as it was.
    await execute('revisions.undo', { entityType: 'pages', entityId: created.id })

    const restored = await Page.findOrFail(created.id)

    expect(restored.slug).toBe('home')
    expect(restored.draftTree.blocks[0]?.props.title).toBe('Worth keeping')
  })

  it('records what the page actually was, not what the revision happened to hold', async () => {
    const created = await newPage()

    await execute('pages.update', { id: created.id, expectedVersion: 1, title: 'Second' })
    await execute('pages.update', { id: created.id, expectedVersion: 2, title: 'Third' })

    const history = await Revision.where('entityId', created.id).oldest().get()

    // Restoring the state at revision #2 while the page says 'Third'.
    await execute('revisions.restore', { id: history[1]?.id ?? '', to: 'after' })

    // Ordered by sequence, because four commands can commit inside one millisecond.
    const written = await Revision.where('entityId', created.id)
      .orderBy('sequence', 'desc')
      .firstOrFail()

    expect((written.before as { title: string }).title).toBe('Third')
    expect((written.after as { title: string }).title).toBe('Second')
  })

  it('reads history and compares two points through queries', async () => {
    const created = await newPage()
    await execute('pages.update', { id: created.id, expectedVersion: 1, title: 'Renamed' })

    const listed = (await run(() =>
      app.queries.execute('revisions.list', { entityType: 'pages', entityId: created.id }),
    )) as { total: number }

    expect(listed.total).toBe(2)

    const history = await Revision.where('entityId', created.id).oldest().get()

    const compared = (await run(() =>
      app.queries.execute('revisions.compare', {
        from: history[0]?.id ?? '',
        to: history[1]?.id ?? '',
      }),
    )) as { patch: Record<string, unknown> }

    expect(compared.patch.title).toEqual({ from: 'Home', to: 'Renamed' })
  })

  it('refuses to restore something nothing knows how to restore', async () => {
    clearRestorers()

    const created = await newPage()
    const history = await Revision.where('entityId', created.id).oldest().get()

    await expect(execute('revisions.restore', { id: history[0]?.id ?? '' })).rejects.toMatchObject({
      code: 'NOT_RESTORABLE',
    })
  })
})

describe('a page per language (SPEC.md §131)', () => {
  /** The same harness, with three languages instead of one. */
  const multilingual = () => {
    clearBlockRegistry()
    clearRestorers()
    useAdapter(createMemoryAdapter({}))

    app = createApplication({
      modules: [pages({ blocks: [Hero, Section] }), revisionsModule()],
      authorization: permitAll(),
      transactions: dataTransactions(),
      revisions: revisions(),
      logger: createLogger(silentWriter),
      locales: ['uk', 'en'],
    })

    return app.boot()
  }

  const speaking = <T>(locale: string, operation: () => Promise<T>): Promise<T> =>
    app.run(
      {
        source: 'studio',
        locale,
        actor: { type: 'user', id: '11111111-1111-4111-8111-111111111111' },
      },
      operation,
    )

  const command = (locale: string, name: string, input: Record<string, unknown>) =>
    speaking(locale, () => app.commands.execute(name, input)) as Promise<Record<string, unknown>>

  const read = (locale: string, input: Record<string, unknown>) =>
    speaking(locale, () => app.queries.execute('pages.get', input)) as Promise<
      Record<string, unknown>
    >

  beforeEach(multilingual)

  it('writes a page in the language it was made in', async () => {
    const made = await command('uk', 'pages.create', { slug: 'about', title: 'Про нас' })
    const page = await read('uk', { id: made.id })

    expect(page.locale).toBe('uk')
    expect(page.translationOf).toBeNull()
  })

  it('lets two languages share an address, which a globally unique slug could not', async () => {
    const made = await command('uk', 'pages.create', { slug: 'about', title: 'Про нас' })

    const translated = await command('uk', 'pages.translate', { id: made.id, locale: 'en' })

    expect(translated.slug).toBe('about')
    expect(translated.locale).toBe('en')
  })

  it('starts a translation from the original’s blocks, unpublished', async () => {
    const made = await newPageIn('uk')

    await command('uk', 'blocks.add', { id: made.id, type: 'hero', props: { title: 'Привіт' } })
    await command('uk', 'pages.publish', { id: made.id })

    const translated = (await command('uk', 'pages.translate', {
      id: made.id,
      locale: 'en',
    })) as { id: string }

    const draft = await read('en', { id: translated.id, mode: 'draft' })

    expect(draft.status).toBe('draft')
    expect(JSON.stringify(draft.tree)).toContain('Привіт')
  })

  it('answers a visitor with the original until the translation is published', async () => {
    const made = await newPageIn('uk')

    await command('uk', 'blocks.add', { id: made.id, type: 'hero', props: { title: 'Привіт' } })
    await command('uk', 'pages.publish', { id: made.id })

    const before = await read('en', { slug: 'home' })

    // No English row at all yet: the ordinary fallback.
    expect(before.locale).toBe('uk')

    const translated = (await command('uk', 'pages.translate', {
      id: made.id,
      locale: 'en',
    })) as { id: string }

    const during = await read('en', { slug: 'home' })

    /**
     * The English row exists now and is a draft. Answering with *it* would put an empty
     * page under the English address — worse than the fallback it replaced, because a
     * minute earlier the reader got the original.
     */
    expect(during.locale).toBe('uk')
    expect(JSON.stringify(during.tree)).toContain('Привіт')

    // Publishing the translation is what makes it the English page: nothing about the
    // *words* had to change for that, which is exactly the state a half-done translation
    // is in.
    await command('en', 'pages.publish', { id: translated.id })

    const after = await read('en', { slug: 'home' })

    expect(after.locale).toBe('en')
  })

  it('says which languages a page is written in', async () => {
    const made = await newPageIn('uk')

    await command('uk', 'pages.translate', { id: made.id, locale: 'en' })

    const answer = (await speaking('uk', () =>
      app.queries.execute('pages.translations', { id: made.id }),
    )) as { translations: readonly { locale: string; isOriginal: boolean }[] }

    expect(answer.translations.map((one) => one.locale).sort()).toEqual(['en', 'uk'])
    expect(answer.translations.find((one) => one.locale === 'uk')?.isOriginal).toBe(true)
  })

  it('refuses a second translation into a language that has one', async () => {
    const made = await newPageIn('uk')

    await command('uk', 'pages.translate', { id: made.id, locale: 'en' })

    await expect(command('uk', 'pages.translate', { id: made.id, locale: 'en' })).rejects.toThrow(
      /already translated/,
    )
  })

  it('refuses a language this deployment does not serve', async () => {
    const made = await newPageIn('uk')

    await expect(command('uk', 'pages.translate', { id: made.id, locale: 'de' })).rejects.toThrow(
      /not a language this deployment serves/,
    )
  })

  it('hangs a translation of a translation off the original', async () => {
    const made = await newPageIn('uk')
    const english = (await command('uk', 'pages.translate', { id: made.id, locale: 'en' })) as {
      id: string
    }

    const answer = (await speaking('en', () =>
      app.queries.execute('pages.translations', { id: english.id }),
    )) as { translations: readonly { locale: string }[] }

    expect(answer.translations).toHaveLength(2)
  })
})
