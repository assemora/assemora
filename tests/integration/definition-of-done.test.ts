/**
 * SPEC.md §123 — the Definition of Done for Studio.
 *
 * "A user with no TypeScript knowledge must be able to: login, create content, edit
 * content, create page, add block, edit block, reorder blocks, preview, publish,
 * undo, upload media."
 *
 * Studio does each of those by sending exactly what this test sends. It is the whole
 * list, in order, against a real application — so the acceptance criterion for the
 * phase is checked rather than asserted.
 */

import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  auth,
  clearPolicies,
  hashPassword,
  Permission,
  policies,
  Role,
  RolePermission,
  User,
  UserRole,
} from '@assemora/auth'
import {
  clearRestorers,
  createApplication,
  createLogger,
  module,
  silentWriter,
} from '@assemora/core'
import { dataTransactions, model, string, useAdapter, uuid } from '@assemora/data'
import { createMemoryAdapter } from '@assemora/database'
import { clearStorage, localStorage, media, useStorage } from '@assemora/media'
import { block, clearBlockRegistry, Page, pages } from '@assemora/pages'
import { clearResourceRegistry, resource, richText, select, text } from '@assemora/resources'
import { revisions, revisionsModule } from '@assemora/revisions'
import type { BlockTree } from '@assemora/schema'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

const Note = model('notes', {
  id: uuid().primary().defaultRandom(),
  title: string(),
  body: string(),
  status: string().default('draft'),
})

const Notes = resource(Note as never, {
  title: text().required().searchable(),
  body: richText().required(),
  status: select('draft', 'published').required().filterable(),
})

const Hero = block('hero', { title: text().required() }, { label: 'Hero' })
const Section = block('section', { title: text() }, { label: 'Section', acceptsChildren: true })

let app: ReturnType<typeof createApplication>
let root: string
let actor: { type: 'user'; id: string }

const run = <T>(work: () => Promise<T>): Promise<T> => app.run({ source: 'rest', actor }, work)

const send = <T>(command: string, input: Record<string, unknown>): Promise<T> =>
  run(() => app.commands.execute(command, input)) as Promise<T>

const ask = <T>(query: string, input: Record<string, unknown> = {}): Promise<T> =>
  run(() => app.queries.execute(query, input)) as Promise<T>

beforeEach(async () => {
  clearPolicies()
  clearBlockRegistry()
  clearResourceRegistry()
  clearRestorers()
  clearStorage()

  root = await mkdtemp(join(tmpdir(), 'assemora-done-'))

  useAdapter(createMemoryAdapter())
  useStorage(localStorage({ root }))

  app = createApplication({
    modules: [
      auth(),
      pages({ blocks: [Hero, Section] }),
      media(),
      revisionsModule(),
      module('notes')
        .models(Note as never)
        .resources(Notes as never),
    ],
    authorization: policies(),
    transactions: dataTransactions(),
    revisions: revisions(),
    logger: createLogger(silentWriter),
  })

  await app.boot()

  // An administrator, the way an application seeds its first one.
  const admin = await User.create({
    email: 'ada@assemora.dev',
    name: 'Ada',
    passwordHash: await hashPassword('correct horse battery staple'),
    active: true,
    version: 1,
  })
  const role = await Role.create({ name: 'administrator', label: 'Administrator', version: 1 })
  const permission = await Permission.create({ name: '*', description: null })

  await UserRole.create({ userId: admin.id, roleId: role.id })
  await RolePermission.create({ roleId: role.id, permissionId: permission.id })

  actor = { type: 'user', id: admin.id }
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

describe('a person with no TypeScript can do all of it (SPEC.md §123)', () => {
  it('logs in', async () => {
    const session = await app.run({ source: 'rest' }, () =>
      app.commands.execute('auth.login', {
        email: 'ada@assemora.dev',
        password: 'correct horse battery staple',
      }),
    )

    expect(session).toMatchObject({ userId: actor.id })
    expect((session as { token: string }).token).toMatch(/^ses_/)
  })

  it('creates and edits content', async () => {
    const created = await send<{ id: string }>('entries.create', {
      resource: 'notes',
      data: { title: 'First', body: 'Something', status: 'draft' },
    })

    await send('entries.update', {
      resource: 'notes',
      id: created.id,
      data: { title: 'First, edited' },
    })

    const listed = await ask<{ data: { title: string }[] }>('entries.list', { resource: 'notes' })

    expect(listed.data).toEqual([expect.objectContaining({ title: 'First, edited' })])
  })

  it('creates a page, adds blocks, edits one, reorders them, previews, publishes and undoes', async () => {
    const page = await send<{ id: string; version: number }>('pages.create', {
      slug: 'home',
      title: 'Home',
    })

    // add block
    const hero = await send<{ blockId: string; version: number; tree: BlockTree }>('blocks.add', {
      id: page.id,
      type: 'hero',
      props: { title: 'Hello' },
    })
    const section = await send<{ blockId: string; version: number }>('blocks.add', {
      id: page.id,
      type: 'section',
      expectedVersion: hero.version,
      props: { title: 'More' },
    })

    expect(hero.tree.blocks).toHaveLength(1)

    // edit block
    const edited = await send<{ version: number; tree: BlockTree }>('blocks.update', {
      id: page.id,
      expectedVersion: section.version,
      blockId: hero.blockId,
      props: { title: 'Hello again' },
    })

    expect(edited.tree.blocks[0]?.props.title).toBe('Hello again')

    // reorder blocks
    const reordered = await send<{ version: number; tree: BlockTree }>('blocks.move', {
      id: page.id,
      expectedVersion: edited.version,
      blockId: section.blockId,
      index: 0,
    })

    expect(reordered.tree.blocks.map((entry) => entry.type)).toEqual(['section', 'hero'])

    // preview: the draft is readable before anything is published
    const draft = await ask<{ tree: BlockTree; hasUnpublishedChanges: boolean }>('pages.get', {
      id: page.id,
      mode: 'draft',
    })

    expect(draft.tree.blocks).toHaveLength(2)
    expect(draft.hasUnpublishedChanges).toBe(true)

    // publish
    await send('pages.publish', { id: page.id, expectedVersion: reordered.version })

    const live = await ask<{ tree: BlockTree }>('pages.get', { id: page.id, mode: 'published' })

    expect(live.tree.blocks.map((entry) => entry.type)).toEqual(['section', 'hero'])

    // undo — and the page goes back to the order before the move
    await send('revisions.undo', { entityType: 'pages', entityId: page.id })
    await send('revisions.undo', { entityType: 'pages', entityId: page.id })

    expect((await Page.findOrFail(page.id)).draftTree.blocks.map((entry) => entry.type)).toEqual([
      'hero',
      'section',
    ])
  })

  it('uploads media, and the library can be read back', async () => {
    const uploaded = await send<{ id: string; url: string }>('media.upload', {
      filename: 'note.txt',
      mimeType: 'text/plain',
      // Studio sends base64, which is the only way JSON carries bytes.
      data: Buffer.from('hello').toString('base64'),
    })

    expect(uploaded.url).toMatch(/^\/media\/\d{4}\/\d{2}\//)

    const library = await ask<{ data: { id: string; filename: string }[] }>('media.list')

    expect(library.data).toEqual([
      expect.objectContaining({ id: uploaded.id, filename: 'note.txt' }),
    ])
  })
})
