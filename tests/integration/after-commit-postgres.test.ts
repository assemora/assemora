/**
 * What "after the commit" means, against a database that can refuse a commit.
 *
 * SPEC.md §82 and ADR-0023 rest on one property: a job reaches the queue only once
 * the change it was scheduled for is durable. Nothing in this repository could see
 * that property. Moving the push *inside* the transaction — the last statement
 * before the commit instead of the first after it — left every suite green, because
 * every `TransactionPort` in the tests was a fake whose only failure mode was the
 * operation throwing. A commit that fails on its own is a different instant, and it
 * is the instant the whole design exists for.
 *
 * So this suite makes a real PostgreSQL fail at three of them:
 *
 * - a deferred constraint, checked at `commit` and nowhere earlier;
 * - a command that ran inside somebody else's `transaction()` which then rolled back;
 * - a nested command whose savepoint was undone by a caller that carried on.
 *
 * It owns `after_commit_notes` and `after_commit_parents` and truncates nothing else,
 * so it can share `assemora_test` with the suites beside it.
 */
import { userInfo } from 'node:os'

import {
  command,
  createApplication,
  job,
  module,
  permitAll,
  type QueuedJob,
  type QueuePort,
} from '@assemora/core'
import {
  dataTransactions,
  model,
  string as textColumn,
  transaction,
  useAdapter,
  uuid as uuidColumn,
} from '@assemora/data'
import {
  applySchema,
  dropSchema,
  type PostgresAdapter,
  postgres,
} from '@assemora/database-postgres'
import { string, uuid } from '@assemora/schema'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

const url =
  process.env.ASSEMORA_TEST_DATABASE_URL ??
  `postgres://${userInfo().username}@localhost:5432/assemora_test`

const required = process.env.ASSEMORA_REQUIRE_POSTGRES === '1'

const reachable = await (async () => {
  const probe = postgres({ url, pool: { connectionTimeoutMs: 1500 } })

  try {
    await probe.raw('select 1')
    return true
  } catch (error) {
    if (required) {
      throw new Error(
        `ASSEMORA_REQUIRE_POSTGRES is set but ${url} is unreachable: ${
          error instanceof Error ? error.message : String(error)
        }`,
      )
    }

    console.warn(`[integration] skipped: ${url} is unreachable`)

    return false
  } finally {
    await probe.close().catch(() => undefined)
  }
})()

const Parent = model('after_commit_parents', {
  id: uuidColumn().primary().defaultRandom(),
  label: textColumn(),
})

/**
 * `parentId` is a plain column rather than a `belongsTo`, because the constraint this
 * suite needs is one the schema builder does not write: a `deferrable initially
 * deferred` foreign key is checked at `commit` and not at `insert`, which is the only
 * way to make a statement succeed and the commit that follows it fail.
 */
const Note = model('after_commit_notes', {
  id: uuidColumn().primary().defaultRandom(),
  title: textColumn(),
  parentId: uuidColumn().nullable(),
})

const tables = [Parent.descriptor, Note.descriptor]

const DEFERRED_FOREIGN_KEY = `
  alter table "after_commit_notes"
  add constraint "after_commit_notes_parent_deferred"
  foreign key ("parent_id") references "after_commit_parents" ("id")
  deferrable initially deferred
`

const Index = job('notes.index', {
  input: { noteId: uuid() },
  handle: async () => undefined,
})

const Write = command('notes.write', {
  input: { title: string(), parentId: uuid().optional() },
  handle: async ({ title, parentId }, context) => {
    const note = await Note.create({ title, parentId: parentId ?? null })

    context.dispatch(Index({ noteId: note.id }))
    context.emit('note.written', { noteId: note.id })

    return { id: note.id }
  },
})

const Refuse = command('notes.refuse', {
  input: {},
  handle: async () => {
    throw new Error('the second command changed its mind')
  },
})

const WriteAndRefuse = command('notes.write-and-refuse', {
  input: { title: string() },
  handle: async ({ title }, context) => {
    const note = await Note.create({ title, parentId: null })

    context.dispatch(Index({ noteId: note.id }))
    context.emit('note.written', { noteId: note.id })

    throw new Error('the nested command changed its mind')
  },
})

/** Runs a command that fails, survives it, and commits anyway. */
const WriteTwice = command('notes.write-twice', {
  input: { title: string() },
  handle: async ({ title }, context) => {
    try {
      await context.execute('notes.write-and-refuse', { title: 'the nested note' })
    } catch {
      // An optional step. The caller decides the failure is survivable, which is what
      // makes this the hard half: the savepoint really was undone and the caller
      // really does commit.
    }

    const note = await Note.create({ title, parentId: null })

    context.dispatch(Index({ noteId: note.id }))

    return { id: note.id }
  },
})

/** A queue that records instead of running, so a test can see what was handed over. */
const recordingQueue = (): QueuePort & { readonly pushed: QueuedJob[] } => {
  const pushed: QueuedJob[] = []

  return {
    pushed,
    push: async (jobs) => {
      pushed.push(...jobs)
    },
  }
}

let adapter: PostgresAdapter
let queue: ReturnType<typeof recordingQueue>
let notified: string[]
let app: ReturnType<typeof createApplication>

beforeAll(async () => {
  if (!reachable) return

  adapter = postgres({ url })
  useAdapter(adapter)

  await dropSchema(adapter, tables)
  await applySchema(adapter, tables)
  await adapter.raw(DEFERRED_FOREIGN_KEY)
}, 60_000)

afterAll(async () => {
  if (!reachable) return

  await app.shutdown()
  await dropSchema(adapter, tables)
  await adapter.close()
}, 30_000)

beforeEach(async () => {
  if (!reachable) return

  await adapter.raw('truncate "after_commit_notes", "after_commit_parents" cascade')

  queue = recordingQueue()
  notified = []

  app = createApplication({
    authorization: permitAll(),
    transactions: dataTransactions(),
    queue,
    modules: [module('notes').commands(Write, Refuse, WriteAndRefuse, WriteTwice).jobs(Index)],
  })

  app.events.on('note.written', (payload) => {
    notified.push((payload as { noteId: string }).noteId)
  })
}, 30_000)

const asAda = <T>(operation: () => Promise<T>): Promise<T> =>
  app.run({ source: 'studio', actor: { type: 'user', id: 'ada' } }, operation)

const MISSING_PARENT = '00000000-0000-4000-8000-000000000001'

describe.skipIf(!reachable)('work that waits for the outermost commit', () => {
  it('queues the job and notifies the listener once the row is durable', async () => {
    const written = await asAda(() => app.commands.execute(Write, { title: 'Ada writes' }))
    const id = (written as { id: string }).id

    expect(await Note.find(id)).not.toBeNull()
    expect(queue.pushed.map((queued) => queued.name)).toEqual(['notes.index'])
    expect(queue.pushed[0]?.payload).toEqual({ noteId: id })
    expect(notified).toEqual([id])
  })

  it('queues nothing when the commit itself is what fails', async () => {
    // The insert succeeds — a deferred key is not checked until `commit` — so the
    // handler returns, the revisions are recorded and the pipeline reaches its step 6
    // with a transaction that is about to be refused. This is the instant a fake
    // transaction port cannot reproduce, and the one the flush has to be after.
    await expect(
      asAda(() => app.commands.execute(Write, { title: 'Ada writes', parentId: MISSING_PARENT })),
    ).rejects.toThrowError()

    expect(await Note.all()).toEqual([])
    expect(queue.pushed).toEqual([])
    expect(notified).toEqual([])
  })

  it('queues nothing when the transaction the command ran inside is undone', async () => {
    // No nested commands at all: two top-level commands inside somebody else's
    // transaction. Each one's own `run` is a savepoint, so the first commits and
    // would hand its job over at its own step 6 — while the row it wrote is still
    // the outer transaction's to take back, which is exactly what happens.
    await expect(
      asAda(() =>
        transaction(async () => {
          await app.commands.execute(Write, { title: 'Ada writes' })
          await app.commands.execute(Refuse, {})
        }),
      ),
    ).rejects.toThrow('the second command changed its mind')

    expect(await Note.all()).toEqual([])
    expect(queue.pushed).toEqual([])
    expect(notified).toEqual([])
  })

  it('queues nothing for a nested command whose caller survived its failure', async () => {
    const written = await asAda(() => app.commands.execute(WriteTwice, { title: 'the outer note' }))
    const id = (written as { id: string }).id

    const titles = (await Note.all()).map((note) => note.title)

    // The nested savepoint really was released against a violated key, so its row is
    // gone. Its job used to be sitting in the caller's array by then, and went to
    // Redis when the caller committed.
    expect(titles).toEqual(['the outer note'])
    expect(queue.pushed).toHaveLength(1)
    expect(queue.pushed[0]?.payload).toEqual({ noteId: id })
    expect(notified).toEqual([])
  })
})

describe('the suite reports whether it actually ran', () => {
  it('says so out loud rather than passing quietly', () => {
    expect(typeof reachable).toBe('boolean')

    if (!reachable) {
      expect(required).toBe(false)
    }
  })
})
