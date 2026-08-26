/**
 * Undo and redo (SPEC.md §60, §65).
 *
 * The stack is not kept anywhere: it is read back out of the history, so it survives
 * a reload, a second tab and an agent doing the undoing.
 */
import {
  command,
  createApplication,
  createLogger,
  module,
  permitAll,
  registerRestorer,
  silentWriter,
} from '@assemora/core'
import { dataTransactions, useAdapter } from '@assemora/data'
import { createMemoryAdapter } from '@assemora/database'
import { string } from '@assemora/schema'
import { beforeEach, describe, expect, it } from 'vitest'

import { revisionsModule } from './module.js'
import { revisions } from './store.js'

const ENTITY = '11111111-1111-4111-8111-111111111111'

let state: { title: string }
let app: ReturnType<typeof createApplication>

const run = async <T>(work: () => Promise<T>): Promise<T> =>
  await app.run({ source: 'cli', actor: { type: 'user', id: ENTITY } }, work)

/** Stands in for a real entity: the point of the test is the ordering, not the row. */
const Rename = command('notes.update', {
  description: 'Renames the note this test keeps in a variable',
  input: { title: string() },
  handle: async ({ title }, context) => {
    const before = { ...state }

    state = { title }

    context.revise({ entityType: 'notes', entityId: ENTITY, before, after: { ...state } })

    return { title }
  },
})

const edit = (title: string) => run(() => app.commands.execute(Rename, { title }))

beforeEach(async () => {
  useAdapter(createMemoryAdapter())
  state = { title: 'One' }

  app = createApplication({
    modules: [revisionsModule(), module('notes').commands(Rename)],
    authorization: permitAll(),
    transactions: dataTransactions(),
    revisions: revisions(),
    logger: createLogger(silentWriter),
  })

  await app.boot()

  registerRestorer('notes', async (_id, snapshot) => {
    state = { title: String((snapshot as { title?: string })?.title ?? state.title) }
  })
})

const undo = () =>
  run(() => app.commands.execute('revisions.undo', { entityType: 'notes', entityId: ENTITY }))
const redo = () =>
  run(() => app.commands.execute('revisions.redo', { entityType: 'notes', entityId: ENTITY }))

describe('undo walks back through the history', () => {
  it('reverses one change at a time', async () => {
    await edit('Two')
    await edit('Three')

    await undo()
    expect(state.title).toBe('Two')

    await undo()
    expect(state.title).toBe('One')
  })

  it('refuses when there is nothing left', async () => {
    await expect(undo()).rejects.toMatchObject({ code: 'NOTHING_TO_UNDO' })
  })

  it('does not undo its own undos', async () => {
    await edit('Two')

    await undo()
    await expect(undo()).rejects.toMatchObject({ code: 'NOTHING_TO_UNDO' })
  })
})

describe('redo puts back what undo took away', () => {
  it('walks forward again, in order', async () => {
    await edit('Two')
    await edit('Three')

    await undo()
    await undo()
    expect(state.title).toBe('One')

    await redo()
    expect(state.title).toBe('Two')

    await redo()
    expect(state.title).toBe('Three')
  })

  it('refuses when nothing has been undone', async () => {
    await edit('Two')

    await expect(redo()).rejects.toMatchObject({ code: 'NOTHING_TO_UNDO' })
  })

  it('stops once everything undone has been put back', async () => {
    await edit('Two')

    await undo()
    await redo()

    await expect(redo()).rejects.toMatchObject({ code: 'NOTHING_TO_UNDO' })
  })

  it('is forgotten once a new edit is made', async () => {
    await edit('Two')
    await edit('Three')

    await undo()
    expect(state.title).toBe('Two')

    await edit('Different')

    // The branch that held 'Three' is gone. Redoing it would overwrite an edit made
    // after the undo with a state the page left long ago.
    await expect(redo()).rejects.toMatchObject({ code: 'NOTHING_TO_UNDO' })

    await undo()
    expect(state.title).toBe('Two')
  })

  it('still walks back correctly after undo, redo and a fresh edit are mixed', async () => {
    await edit('Two')
    await edit('Three')

    await undo()
    await undo()
    expect(state.title).toBe('One')

    await redo()
    expect(state.title).toBe('Two')

    await edit('Four')
    expect(state.title).toBe('Four')

    await expect(redo()).rejects.toMatchObject({ code: 'NOTHING_TO_UNDO' })

    await undo()
    expect(state.title).toBe('Two')

    await undo()
    expect(state.title).toBe('One')
  })
})
