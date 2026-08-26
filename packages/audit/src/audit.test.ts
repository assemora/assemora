/**
 * The audit log (SPEC.md §67, §76).
 *
 * The entries that matter most are the ones no revision records: an attempt that
 * was refused changed nothing, and "who tried" is exactly what an audit log is for.
 */
import {
  command,
  createApplication,
  createLogger,
  ForbiddenError,
  module,
  silentWriter,
} from '@assemora/core'
import { string as column, dataTransactions, model, useAdapter, uuid } from '@assemora/data'
import { createMemoryAdapter } from '@assemora/database'
import { string } from '@assemora/schema'
import { beforeEach, describe, expect, it } from 'vitest'

import { AuditLog } from './models.js'
import { auditModule } from './module.js'
import { audit } from './store.js'

const Note = model('notes', { id: uuid().primary().defaultRandom(), title: column() })

const Rename = command('notes.rename', {
  description: 'Renames a note',
  input: { id: string(), title: string() },
  handle: async ({ id, title }, context) => {
    const note = await Note.findOrFail(id)
    const before = note.toJSON()

    await note.update({ title })
    context.revise({ entityType: 'notes', entityId: id, before, after: note.toJSON() })

    return { id }
  },
})

const Explode = command('notes.explode', {
  description: 'Fails, on purpose',
  input: {},
  handle: async () => {
    throw new Error('the handler gave up')
  },
})

let app: ReturnType<typeof createApplication>
let noteId: string

const build = (options: Parameters<typeof audit>[0] = {}) => {
  app = createApplication({
    modules: [auditModule(), module('notes').models(Note).commands(Rename, Explode)],
    authorization: {
      authorize: async (request) => {
        if (request.command === 'notes.forbidden') throw new ForbiddenError('no')
      },
    },
    transactions: dataTransactions(),
    audit: audit(options),
    logger: createLogger(silentWriter),
  })

  return app.boot()
}

const run = <T>(work: () => Promise<T>): Promise<T> =>
  app.run({ source: 'mcp', actor: { type: 'agent', id: 'content-agent' } }, work)

beforeEach(async () => {
  useAdapter(createMemoryAdapter())
  await build()

  noteId = (await Note.create({ title: 'One' })).id
})

describe('what a command leaves behind (SPEC.md §67)', () => {
  it('records who asked, from where, and what they touched', async () => {
    await run(() => app.commands.execute('notes.rename', { id: noteId, title: 'Two' }))

    const entry = await AuditLog.orderBy('createdAt', 'desc').firstOrFail()

    expect(entry).toMatchObject({
      actorType: 'agent',
      actorId: 'content-agent',
      source: 'mcp',
      action: 'notes.rename',
      entityType: 'notes',
      entityId: noteId,
    })
    expect(entry.metadata.outcome).toBe('succeeded')
    expect(entry.requestId).toHaveLength(36)
  })

  it('records an attempt that failed, which no revision would', async () => {
    await expect(run(() => app.commands.execute('notes.explode', {}))).rejects.toThrow()

    const entry = await AuditLog.where('action', 'notes.explode').firstOrFail()

    expect(entry.metadata.outcome).toBe('failed')
    expect(entry.metadata.reason).toBe('the handler gave up')
    expect(entry.entityType).toBeNull()
  })

  it('records a refused command, which is the entry that matters most', async () => {
    const Forbidden = command('notes.forbidden', {
      description: 'Never allowed',
      input: {},
      handle: async () => ({}),
    })

    app.commands.register(Forbidden, 'notes')

    await expect(run(() => app.commands.execute('notes.forbidden', {}))).rejects.toBeInstanceOf(
      ForbiddenError,
    )

    expect((await AuditLog.where('action', 'notes.forbidden').firstOrFail()).metadata.outcome).toBe(
      'failed',
    )
  })

  it('records invalid input, refused before anything ran', async () => {
    await expect(run(() => app.commands.execute('notes.rename', { id: 1 }))).rejects.toThrow()

    expect((await AuditLog.where('action', 'notes.rename').firstOrFail()).metadata.reason).toBe(
      'VALIDATION_ERROR',
    )
  })

  it('leaves failures out when an application asks it to', async () => {
    useAdapter(createMemoryAdapter())
    await build({ failures: false })

    await expect(run(() => app.commands.execute('notes.explode', {}))).rejects.toThrow()

    expect(await AuditLog.count()).toBe(0)
  })

  it('ties every entry of one request together', async () => {
    await run(async () => {
      await app.commands.execute('notes.rename', { id: noteId, title: 'Two' })
      await app.commands.execute('notes.rename', { id: noteId, title: 'Three' })
    })

    const entries = await AuditLog.get()

    expect(entries).toHaveLength(2)
    expect(new Set(entries.map((entry) => entry.requestId)).size).toBe(1)
  })
})

describe('a broken audit log does not break the command', () => {
  it('lets the command succeed and says so in the log instead', async () => {
    useAdapter(createMemoryAdapter())

    app = createApplication({
      modules: [module('notes').models(Note).commands(Rename)],
      authorization: { authorize: async () => undefined },
      transactions: dataTransactions(),
      audit: { record: () => Promise.reject(new Error('the log is on fire')) },
      logger: createLogger(silentWriter),
    })

    await app.boot()

    const created = await Note.create({ title: 'One' })

    await expect(
      run(() => app.commands.execute('notes.rename', { id: created.id, title: 'Two' })),
    ).resolves.toMatchObject({ id: created.id })

    expect((await Note.findOrFail(created.id)).title).toBe('Two')
  })
})
