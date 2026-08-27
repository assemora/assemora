/**
 * Dry run (SPEC.md §73, ADR-0019).
 *
 * The point is that it is not a simulation: the real handler runs, the real rows are
 * written, and the transaction is undone. Anything a preview reports, the command
 * would actually do.
 */

import { string } from '@assemora/schema'
import { beforeEach, describe, expect, it } from 'vitest'
import { createApplication } from './application.js'
import { command } from './commands.js'
import { ForbiddenError } from './errors.js'
import { createLogger, silentWriter } from './logger.js'
import { module } from './module.js'
import { collectAudit, permitAll, type TransactionPort } from './ports.js'

/** A table that lives in a variable, and a transaction that can undo it. */
let rows: { id: string; title: string }[] = []

const transactions = (): TransactionPort => ({
  run: async (operation, options) => {
    const snapshot = rows.map((row) => ({ ...row }))

    try {
      const value = await operation()

      if (options?.rollback === true) rows = snapshot

      return value
    } catch (error) {
      rows = snapshot
      throw error
    }
  },

  // This fake models no nesting, so every commit is the outermost one.
  afterCommit: (work) => work(),
})

const Rename = command('notes.rename', {
  description: 'Renames a note',
  input: { id: string(), title: string() },
  handle: async ({ id, title }, context) => {
    const row = rows.find((entry) => entry.id === id)

    if (row === undefined) throw new Error('no such note')

    const before = { ...row }

    row.title = title
    context.revise({ entityType: 'notes', entityId: id, before, after: { ...row } })
    context.emit('notes.renamed', { id })

    return { id, title }
  },
})

const Upload = command('files.upload', {
  description: 'Writes a file, which a transaction cannot undo',
  input: { name: string() },
  previewable: false,
  handle: async ({ name }) => ({ name }),
})

let app: ReturnType<typeof createApplication>
let audit: ReturnType<typeof collectAudit>

const build = (authorization = permitAll()) => {
  audit = collectAudit()

  app = createApplication({
    modules: [module('notes').commands(Rename, Upload)],
    authorization,
    transactions: transactions(),
    audit,
    logger: createLogger(silentWriter),
  })

  return app.boot()
}

const run = <T>(work: () => Promise<T>): Promise<T> =>
  app.run({ source: 'mcp', actor: { type: 'agent', id: 'content-agent' } }, work)

beforeEach(async () => {
  rows = [{ id: 'one', title: 'Before' }]
  await build()
})

describe('a preview changes nothing (SPEC.md §73)', () => {
  it('leaves the row exactly as it found it', async () => {
    await run(() => app.commands.dryRun('notes.rename', { id: 'one', title: 'After' }))

    expect(rows[0]?.title).toBe('Before')
  })

  it('still answers with what the handler returned', async () => {
    const preview = await run(() =>
      app.commands.dryRun('notes.rename', { id: 'one', title: 'After' }),
    )

    expect(preview.result).toEqual({ id: 'one', title: 'After' })
    expect(preview.command).toBe('notes.rename')
  })

  it('describes the change field by field, not as two documents', async () => {
    const preview = await run(() =>
      app.commands.dryRun('notes.rename', { id: 'one', title: 'After' }),
    )

    expect(preview.changes).toEqual([
      {
        entityType: 'notes',
        entityId: 'one',
        before: { id: 'one', title: 'Before' },
        after: { id: 'one', title: 'After' },
        patch: { title: { from: 'Before', to: 'After' } },
      },
    ])
  })

  it('names the events it would emit, and emits none of them', async () => {
    let heard = 0

    app.events.on('notes.renamed', () => {
      heard += 1
    })

    const preview = await run(() =>
      app.commands.dryRun('notes.rename', { id: 'one', title: 'After' }),
    )

    expect(preview.events).toEqual(['notes.renamed'])
    expect(heard).toBe(0)
  })

  it('is recorded as previewed, which is neither a success nor a failure', async () => {
    await run(() => app.commands.dryRun('notes.rename', { id: 'one', title: 'After' }))

    expect(audit.entries).toEqual([expect.objectContaining({ outcome: 'previewed' })])
  })
})

describe('a preview is not a way around anything', () => {
  it('passes authorization, so a forbidden command cannot be previewed either', async () => {
    await build({ authorize: async () => Promise.reject(new ForbiddenError('no')) })

    await expect(
      run(() => app.commands.dryRun('notes.rename', { id: 'one', title: 'After' })),
    ).rejects.toBeInstanceOf(ForbiddenError)
  })

  it('passes validation', async () => {
    await expect(run(() => app.commands.dryRun('notes.rename', { id: 1 }))).rejects.toThrow()
  })

  it('refuses a command that reaches outside the database', async () => {
    await expect(
      run(() => app.commands.dryRun('files.upload', { name: 'x.png' })),
    ).rejects.toMatchObject({ code: 'NOT_PREVIEWABLE' })
  })

  it('refuses a command nobody registered', async () => {
    await expect(run(() => app.commands.dryRun('notes.nowhere', {}))).rejects.toMatchObject({
      code: 'UNKNOWN_COMMAND',
    })
  })

  it('lets the real command through afterwards, unchanged', async () => {
    await run(() => app.commands.dryRun('notes.rename', { id: 'one', title: 'After' }))
    await run(() => app.commands.execute('notes.rename', { id: 'one', title: 'After' }))

    expect(rows[0]?.title).toBe('After')
  })
})

describe('a batch is previewed as a sequence (SPEC.md §74)', () => {
  it('lets the second command see what the first one did', async () => {
    const previews = await run(() =>
      app.commands.dryRunAll([
        { command: 'notes.rename', input: { id: 'one', title: 'Middle' } },
        { command: 'notes.rename', input: { id: 'one', title: 'Last' } },
      ]),
    )

    // The second saw 'Middle', which only exists because the first ran and was not
    // undone before it.
    expect(previews[1]?.changes[0]?.patch).toEqual({ title: { from: 'Middle', to: 'Last' } })
  })

  it('undoes the whole sequence, not each step', async () => {
    await run(() =>
      app.commands.dryRunAll([
        { command: 'notes.rename', input: { id: 'one', title: 'Middle' } },
        { command: 'notes.rename', input: { id: 'one', title: 'Last' } },
      ]),
    )

    expect(rows[0]?.title).toBe('Before')
  })

  it('refuses the batch before running any of it when one step cannot be previewed', async () => {
    await expect(
      run(() =>
        app.commands.dryRunAll([
          { command: 'notes.rename', input: { id: 'one', title: 'Middle' } },
          { command: 'files.upload', input: { name: 'x.png' } },
        ]),
      ),
    ).rejects.toMatchObject({ code: 'NOT_PREVIEWABLE' })

    expect(rows[0]?.title).toBe('Before')
  })

  it('fails the batch if a later step fails, and undoes the earlier ones', async () => {
    await expect(
      run(() =>
        app.commands.dryRunAll([
          { command: 'notes.rename', input: { id: 'one', title: 'Middle' } },
          { command: 'notes.rename', input: { id: 'nowhere', title: 'x' } },
        ]),
      ),
    ).rejects.toThrow()

    expect(rows[0]?.title).toBe('Before')
  })
})
