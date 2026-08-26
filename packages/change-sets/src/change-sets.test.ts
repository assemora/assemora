/**
 * Change sets (SPEC.md §73, §74, §75).
 *
 * The guarantee under test is one sentence from §75: production state does not
 * change before Apply. Everything else here exists to make that true and to keep it
 * true when the world moves underneath a proposal.
 */
import {
  command,
  createApplication,
  createLogger,
  ForbiddenError,
  module,
  permitAll,
  silentWriter,
} from '@assemora/core'
import {
  string as column,
  dataTransactions,
  integer,
  model,
  useAdapter,
  uuid,
} from '@assemora/data'
import { createMemoryAdapter } from '@assemora/database'
import { number, string } from '@assemora/schema'
import { beforeEach, describe, expect, it } from 'vitest'

import { ChangeSet } from './models.js'
import { changeSets } from './module.js'

const Note = model('notes', {
  id: uuid().primary().defaultRandom(),
  title: column(),
  version: integer().default(1),
})

const Rename = command('notes.rename', {
  description: 'Renames a note',
  input: { id: string(), title: string(), expectedVersion: number().integer().optional() },
  handle: async ({ id, title }, context) => {
    const note = await Note.findOrFail(id)
    const before = note.toJSON()

    await note.update({ title, version: note.version + 1 })
    context.revise({ entityType: 'notes', entityId: id, before, after: note.toJSON() })

    return { id, title }
  },
})

let app: ReturnType<typeof createApplication>
let noteId: string

const build = (authorization = permitAll()) => {
  app = createApplication({
    modules: [changeSets(), module('notes').models(Note).commands(Rename)],
    authorization,
    transactions: dataTransactions(),
    logger: createLogger(silentWriter),
  })

  return app.boot()
}

const as = <T>(type: 'agent' | 'user', work: () => Promise<T>): Promise<T> =>
  app.run({ source: type === 'agent' ? 'mcp' : 'studio', actor: { type, id: `${type}-1` } }, work)

const propose = (title = 'Rename it twice') =>
  as('agent', () =>
    app.commands.execute('changesets.propose', {
      title,
      commands: [
        { command: 'notes.rename', input: { id: noteId, title: 'Middle' } },
        { command: 'notes.rename', input: { id: noteId, title: 'Final' } },
      ],
    }),
  ) as Promise<{ id: string; changes: { summary: string }[]; status: string }>

beforeEach(async () => {
  useAdapter(createMemoryAdapter())
  await build()

  noteId = (await Note.create({ title: 'Original', version: 1 })).id
})

describe('proposing changes nothing (SPEC.md §75)', () => {
  it('stores the proposal and leaves the row alone', async () => {
    const proposal = await propose()

    expect(proposal.status).toBe('pending')
    expect((await Note.findOrFail(noteId)).title).toBe('Original')
  })

  it('describes each change as a line a person can read', async () => {
    const proposal = await propose()

    expect(proposal.changes.map((change) => change.summary)).toEqual([
      'notes — title: Original → Middle',
      'notes — title: Middle → Final',
    ])
  })

  it('previews the sequence, so the second command sees the first', async () => {
    const proposal = await propose()

    // 'Middle' only exists because the first command ran inside the preview.
    expect(proposal.changes[1]?.summary).toContain('Middle → Final')
  })

  it('records the version the diff was computed against', async () => {
    const proposal = await propose()
    const stored = await ChangeSet.findOrFail(proposal.id)

    expect(stored.baseVersions).toEqual({ [`notes:${noteId}`]: 1 })
  })

  it('refuses a proposal the proposer could not perform', async () => {
    await build({ authorize: async () => Promise.reject(new ForbiddenError('no')) })
    noteId = (await Note.create({ title: 'Original', version: 1 })).id

    await expect(propose()).rejects.toBeInstanceOf(ForbiddenError)
  })
})

describe('applying is what changes anything', () => {
  it('runs every proposed command, in order', async () => {
    const proposal = await propose()

    await as('user', () => app.commands.execute('changesets.apply', { id: proposal.id }))

    expect((await Note.findOrFail(noteId)).title).toBe('Final')
  })

  it('closes the change set and stamps when', async () => {
    const proposal = await propose()

    await as('user', () => app.commands.execute('changesets.apply', { id: proposal.id }))

    const stored = await ChangeSet.findOrFail(proposal.id)

    expect(stored.status).toBe('applied')
    expect(stored.appliedAt).toBeInstanceOf(Date)
  })

  it('refuses to apply twice', async () => {
    const proposal = await propose()

    await as('user', () => app.commands.execute('changesets.apply', { id: proposal.id }))

    await expect(
      as('user', () => app.commands.execute('changesets.apply', { id: proposal.id })),
    ).rejects.toMatchObject({ code: 'CHANGE_SET_CLOSED' })
  })
})

describe('a proposal goes stale when the world moves (SPEC.md §66, §74)', () => {
  it('declines a diff computed against an older version, and writes nothing', async () => {
    const proposal = await propose()

    // Somebody else edits the same note in the meantime.
    await as('user', () =>
      app.commands.execute('notes.rename', { id: noteId, title: 'Somebody else' }),
    )

    const outcome = (await as('user', () =>
      app.commands.execute('changesets.apply', { id: proposal.id }),
    )) as { status: string; applied: boolean; changed: string[] }

    expect(outcome).toMatchObject({ status: 'conflicted', applied: false })
    expect(outcome.changed).toEqual([`notes:${noteId}`])
    expect((await Note.findOrFail(noteId)).title).toBe('Somebody else')
  })

  it('remembers that it conflicted, so it cannot be retried into a surprise', async () => {
    const proposal = await propose()

    await as('user', () =>
      app.commands.execute('notes.rename', { id: noteId, title: 'Somebody else' }),
    )
    await as('user', () => app.commands.execute('changesets.apply', { id: proposal.id }))

    // Declining has to survive the command that declined — which is why it is an
    // outcome and not an exception.
    expect((await ChangeSet.findOrFail(proposal.id)).status).toBe('conflicted')

    await expect(
      as('user', () => app.commands.execute('changesets.apply', { id: proposal.id })),
    ).rejects.toMatchObject({ code: 'CHANGE_SET_CLOSED' })
  })

  it('expires, and says so rather than applying something old', async () => {
    const proposal = (await as('agent', () =>
      app.commands.execute('changesets.propose', {
        title: 'Already stale',
        commands: [{ command: 'notes.rename', input: { id: noteId, title: 'Late' } }],
        ttlMs: 1,
      }),
    )) as { id: string }

    await new Promise((resolve) => setTimeout(resolve, 5))

    const outcome = (await as('user', () =>
      app.commands.execute('changesets.apply', { id: proposal.id }),
    )) as { status: string; applied: boolean }

    expect(outcome).toMatchObject({ status: 'expired', applied: false })
    expect((await ChangeSet.findOrFail(proposal.id)).status).toBe('expired')
    expect((await Note.findOrFail(noteId)).title).toBe('Original')
  })
})

describe('rejecting', () => {
  it('closes it and runs nothing', async () => {
    const proposal = await propose()

    await as('user', () =>
      app.commands.execute('changesets.reject', { id: proposal.id, reason: 'not now' }),
    )

    expect((await ChangeSet.findOrFail(proposal.id)).status).toBe('rejected')
    expect((await Note.findOrFail(noteId)).title).toBe('Original')
  })

  it('refuses to apply what was rejected', async () => {
    const proposal = await propose()

    await as('user', () => app.commands.execute('changesets.reject', { id: proposal.id }))

    await expect(
      as('user', () => app.commands.execute('changesets.apply', { id: proposal.id })),
    ).rejects.toMatchObject({ code: 'CHANGE_SET_CLOSED' })
  })
})

describe('reading proposals', () => {
  it('lists them with a count rather than the whole diff', async () => {
    await propose('One')

    const listed = (await as('user', () => app.queries.execute('changesets.list', {}))) as {
      data: { title: string; changes: number; status: string }[]
    }

    expect(listed.data).toEqual([
      expect.objectContaining({ title: 'One', changes: 2, status: 'pending' }),
    ])
  })

  it('hands back every line on a single read', async () => {
    const proposal = await propose()

    const one = (await as('user', () =>
      app.queries.execute('changesets.get', { id: proposal.id }),
    )) as { changes: unknown[]; commands: unknown[] }

    expect(one.changes).toHaveLength(2)
    expect(one.commands).toHaveLength(2)
  })
})
