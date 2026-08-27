/**
 * Dry run (SPEC.md §73, ADR-0019).
 *
 * The point is that it is not a simulation: the real handler runs, the real rows are
 * written, and the transaction is undone. Anything a preview reports, the command
 * would actually do.
 */

import { string } from '@assemora/schema'
import { beforeEach, describe, expect, it } from 'vitest'
import { type Application, createApplication } from './application.js'
import { command, type Preview } from './commands.js'
import { ForbiddenError } from './errors.js'
import { createLogger, type LogRecord, silentWriter } from './logger.js'
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

/**
 * A transaction port that models nesting, which the fake above deliberately does not
 * (ADR-0023).
 *
 * The nesting is where the hole was. `TransactionPort.afterCommit` registers against
 * the OUTERMOST commit — right for a command that is committing, and the exact
 * opposite of right for one being previewed, because a preview is a savepoint inside
 * somebody else's transaction. A handler reaching for the port itself therefore
 * handed its work to the command doing the previewing, which then committed it.
 *
 * So this fake reproduces that faithfully: a *nested* rollback drops rows and nothing
 * else, and only the outermost transaction decides whether the pending work runs.
 */
const nestedTransactions = (): TransactionPort => {
  let depth = 0
  let pending: (() => Promise<void>)[] = []

  return {
    run: async (operation, options) => {
      const outermost = depth === 0

      depth += 1

      try {
        const value = await operation()

        depth -= 1

        if (outermost) {
          const work = options?.rollback === true ? [] : pending

          pending = []

          for (const item of work) await item()
        }

        return value
      } catch (error) {
        depth -= 1
        if (outermost) pending = []
        throw error
      }
    },

    afterCommit: async (work) => {
      if (depth === 0) return work()

      pending.push(work)
    },
  }
}

describe('after-commit work is withheld from a preview (SPEC.md §73, §75, ADR-0023)', () => {
  /** Process state a transaction cannot undo: a registry, a cache, a mounted thing. */
  let live: string[]
  let failures: LogRecord[]

  const Register = command('registry.add', {
    description: 'Writes a row and registers what it describes once that row is durable',
    input: { name: string() },
    handle: async ({ name }, context) => {
      context.afterCommit(() => {
        live.push(name)
      })

      context.revise({ entityType: 'registry', entityId: name, before: null, after: { name } })

      return { name }
    },
  })

  const Explodes = command('registry.explodes', {
    description: 'Registers after-commit work that throws',
    input: {},
    handle: async (_input, context) => {
      context.afterCommit(() => {
        throw new Error('the registry refused')
      })

      return { ok: true }
    },
  })

  /** What `changesets.propose` is: a command that previews other commands. */
  const Propose = command('proposals.make', {
    description: 'Previews a command from inside a command',
    input: { name: string() },
    handle: async ({ name }, context) =>
      context.preview([{ command: 'registry.add', input: { name } }]),
  })

  const Applies = command('proposals.apply', {
    description: 'Runs a command from inside a command, and then fails',
    input: { name: string() },
    handle: async ({ name }, context) => {
      await context.execute('registry.add', { name })

      throw new Error('the applier changed its mind')
    },
  })

  let previewing: Application

  beforeEach(async () => {
    live = []
    failures = []

    previewing = createApplication({
      modules: [module('registry').commands(Register, Explodes, Propose, Applies)],
      authorization: permitAll(),
      transactions: nestedTransactions(),
      logger: createLogger((record) => {
        if (record.level === 'error') failures.push(record)
      }),
    })

    await previewing.boot()
  })

  it('runs the work when the command really commits', async () => {
    await previewing.commands.execute('registry.add', { name: 'testimonials' })

    expect(live).toEqual(['testimonials'])
  })

  it('runs nothing for a top-level dry run', async () => {
    await previewing.commands.dryRun('registry.add', { name: 'testimonials' })

    expect(live).toEqual([])
  })

  /**
   * The one the authors did not write, and the one that matters.
   *
   * `changesets.propose` is a command whose handler previews other commands, and it is
   * how an agent's mutation arrives by default (SPEC.md §75). A handler that registered
   * its after-commit work with the transaction port would have it committed here — the
   * preview's rollback is a savepoint, and the registration is on the proposer's list.
   */
  it('runs nothing when a command previews another command', async () => {
    const previews = (await previewing.commands.execute('proposals.make', {
      name: 'testimonials',
    })) as readonly Preview[]

    expect(previews[0]?.changes).toHaveLength(1)
    expect(live).toEqual([])
  })

  it('runs nothing when the command that ran it is itself undone', async () => {
    await expect(
      previewing.commands.execute('proposals.apply', { name: 'testimonials' }),
    ).rejects.toThrow('the applier changed its mind')

    expect(live).toEqual([])
  })

  it('logs a failure rather than failing a command that has already committed', async () => {
    await expect(previewing.commands.execute('registry.explodes', {})).resolves.toEqual({
      ok: true,
    })

    expect(failures.map((record) => record.message)).toContain('After-commit work failed')
  })
})
