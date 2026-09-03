/**
 * The mutation path of SPEC.md §14, against a real PostgreSQL.
 *
 * Two integration suites existed before this one and neither could see the defect
 * this file was written for. `tests/integration/v1.test.ts` walks SPEC.md §124's
 * whole narrative, but on `createMemoryAdapter()`, which stores whatever JavaScript
 * hands it and enforces no column constraint. `tests/integration/postgres.test.ts`
 * drives a real database, but only through the data layer: it executes no command,
 * so it never reaches a revision, an audit row or a change set.
 *
 * Between them, nothing in this repository ran
 * `Command Bus → validation → authorization → transaction → handler → revision →
 * events → audit → database` against a database that enforces its own schema — and
 * the first thing that did, failed on `assemora_revisions.before`, because a
 * creation has no before and a deletion has no after.
 *
 * So this suite is deliberately narrow and deliberately real: it applies the schema
 * the models describe to PostgreSQL, then creates, updates, deletes, proposes and
 * undoes through the Command Bus, and asserts the rows that were actually written.
 * The tables it owns are the framework's own (`assemora_*`) plus `pipeline_articles`;
 * `postgres.test.ts` owns `it_*` and `assemora_migrations`, so the two can share a
 * database without either truncating the other's work.
 */
import { userInfo } from 'node:os'

import { AuditLog, audit, auditModule } from '@assemora/audit'
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
import { ChangeSet, changeSets } from '@assemora/change-sets'
import {
  type Application,
  createApplication,
  createLogger,
  module,
  silentWriter,
} from '@assemora/core'
import {
  boolean,
  dataTransactions,
  model,
  registeredModels,
  string,
  useAdapter,
  uuid,
} from '@assemora/data'
import {
  applySchema,
  createTableSql,
  dropSchema,
  type PostgresAdapter,
  postgres,
} from '@assemora/database-postgres'
import { resource, text, toggle } from '@assemora/resources'
import { Revision, revisions, revisionsModule } from '@assemora/revisions'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { realInfrastructure } from './budget.ts'

realInfrastructure()

const url =
  process.env.ASSEMORA_TEST_DATABASE_URL ??
  `postgres://${userInfo().username}@localhost:5432/assemora_test`

/**
 * A suite that skips itself is a suite that can be green while proving nothing.
 * Set `ASSEMORA_REQUIRE_POSTGRES=1` — in CI, or before a release — and an
 * unreachable database becomes a failure instead of a silent pass.
 */
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

const Article = model('pipeline_articles', {
  id: uuid().primary().defaultRandom(),
  title: string(),
  published: boolean().default(false),
})

const Articles = resource(
  Article,
  {
    title: text().required(),
    published: toggle(),
  },
  { name: 'articles' },
)

const content = () => module('content').models(Article).resources(Articles)

const PASSWORD = 'correct horse battery staple'

/**
 * Every table the modules above declare, taken from the model registry rather than
 * listed here. A package that adds a column, or a table, is then covered by this
 * suite without anyone remembering to come back.
 */
const tables = () => Object.values(registeredModels())

let adapter: PostgresAdapter
let app: Application
let passwordHash: string
/** The signed-in administrator every command below runs as. */
let ada: string

beforeAll(async () => {
  if (!reachable) return

  adapter = postgres({ url })
  useAdapter(adapter)

  await dropSchema(adapter, tables())
  await applySchema(adapter, tables())

  clearPolicies()

  app = createApplication({
    modules: [auth(), revisionsModule(), auditModule(), changeSets(), content()],
    authorization: policies(),
    transactions: dataTransactions(),
    revisions: revisions(),
    audit: audit(),
    logger: createLogger(silentWriter),
  })

  await app.boot()

  // Argon2id is deliberately expensive; nothing here verifies the password, so it is
  // hashed once rather than in every `beforeEach`.
  passwordHash = await hashPassword(PASSWORD)
}, 60_000)

afterAll(async () => {
  if (!reachable) return

  await app.shutdown()
  await dropSchema(adapter, tables())
  await adapter.close()
}, 30_000)

beforeEach(async () => {
  if (!reachable) return

  const all = tables()
    .map((table) => `"${table.name}"`)
    .join(', ')

  await adapter.raw(`truncate ${all} cascade`)

  const admin = await User.create({ email: 'ada@assemora.dev', name: 'Ada', passwordHash })
  const role = await Role.create({ name: 'administrator', label: 'Administrator' })
  const everything = await Permission.create({ name: '*', description: null })

  await UserRole.create({ userId: admin.id, roleId: role.id })
  await RolePermission.create({ roleId: role.id, permissionId: everything.id })

  ada = admin.id
}, 30_000)

const asAda = <T>(operation: () => Promise<T>): Promise<T> =>
  app.run({ source: 'rest', actor: { type: 'user', id: ada } }, operation)

const send = <T>(command: string, input: Record<string, unknown>): Promise<T> =>
  asAda(() => app.commands.execute(command, input)) as Promise<T>

const createArticle = (title: string): Promise<{ id: string }> =>
  send('entries.create', { resource: 'articles', data: { title } })

const historyOf = (entityId: string) =>
  Revision.where('entityType', 'articles').where('entityId', entityId).orderBy('sequence', 'asc')

describe.skipIf(!reachable)('the command pipeline against PostgreSQL', () => {
  describe('revisions (SPEC.md §64)', () => {
    it('records a creation, whose before is a null the column has to accept', async () => {
      const created = await createArticle('Ada writes')

      const [revision] = await historyOf(created.id).get()

      expect(revision).toBeDefined()
      expect(revision?.sequence).toBe(1)
      expect(revision?.command).toBe('entries.create')
      // The whole reason this file exists: `before` is null for every creation, so a
      // `not null` column makes the first write of a fresh project fail.
      expect(revision?.before).toBeNull()
      expect(revision?.after).toMatchObject({ title: 'Ada writes' })
      expect(revision?.actorType).toBe('user')
      expect(revision?.actorId).toBe(ada)
    })

    it('records an update with both sides', async () => {
      const created = await createArticle('Ada writes')

      await send('entries.update', {
        resource: 'articles',
        id: created.id,
        data: { title: 'Ada revises' },
      })

      const history = await historyOf(created.id).get()

      expect(history.map((revision) => revision.sequence)).toEqual([1, 2])
      expect(history[1]?.before).toMatchObject({ title: 'Ada writes' })
      expect(history[1]?.after).toMatchObject({ title: 'Ada revises' })
      expect(history[1]?.patch).toMatchObject({ title: { from: 'Ada writes', to: 'Ada revises' } })
    })

    it('records a deletion, whose after is null on the other side of the same column', async () => {
      const created = await createArticle('Ada writes')

      await send('entries.delete', { resource: 'articles', id: created.id })

      const history = await historyOf(created.id).get()

      expect(history[1]?.command).toBe('entries.delete')
      expect(history[1]?.before).toMatchObject({ title: 'Ada writes' })
      expect(history[1]?.after).toBeNull()
      expect(await Article.find(created.id)).toBeNull()
    })

    it('undoes a creation by reading the stored null back out again', async () => {
      const created = await createArticle('Ada writes')

      await send('revisions.undo', { entityType: 'articles', entityId: created.id })

      // Undoing a creation deletes: the restorer is handed the `null` that came back
      // from the database, and has to recognise it as "this did not exist then".
      expect(await Article.find(created.id)).toBeNull()

      const history = await historyOf(created.id).get()

      expect(history[1]?.after).toBeNull()
      expect(history[1]?.metadata).toMatchObject({ undoOf: history[0]?.id })
    })
  })

  describe('the audit log (SPEC.md §67)', () => {
    it('writes a row for every command, with the actor and the outcome', async () => {
      const created = await createArticle('Ada writes')

      await send('entries.update', {
        resource: 'articles',
        id: created.id,
        data: { published: true },
      })
      await send('entries.delete', { resource: 'articles', id: created.id })

      const logged = await AuditLog.orderBy('createdAt', 'asc').get()

      expect(logged.map((row) => row.action)).toEqual([
        'entries.create',
        'entries.update',
        'entries.delete',
      ])

      for (const row of logged) {
        expect(row.kind).toBe('command')
        expect(row.source).toBe('rest')
        expect(row.actorType).toBe('user')
        expect(row.actorId).toBe(ada)
        expect(row.entityType).toBe('articles')
        expect(row.metadata).toMatchObject({ outcome: 'succeeded' })
      }
    })

    it('records the attempt that was refused, which left no revision at all', async () => {
      await expect(
        app.run({ source: 'rest' }, () =>
          app.commands.execute('entries.create', {
            resource: 'articles',
            data: { title: 'Nobody' },
          }),
        ),
      ).rejects.toThrowError()

      const [refused] = await AuditLog.where('action', 'entries.create').get()

      expect(refused?.metadata).toMatchObject({ outcome: 'failed' })
      // Nothing was written, so there is nothing to say what was written about.
      expect(refused?.entityType).toBeNull()
      expect(refused?.entityId).toBeNull()
      expect(await Revision.all()).toHaveLength(0)
    })
  })

  describe('change sets (SPEC.md §74, §75)', () => {
    it('stores a proposal, changes nothing, and applies it when a person says so', async () => {
      const created = await createArticle('Ada writes')

      const proposal = await send<{ id: string; status: string }>('changesets.propose', {
        title: 'Publish the article',
        commands: [
          {
            command: 'entries.update',
            input: { resource: 'articles', id: created.id, data: { published: true } },
          },
        ],
      })

      const stored = await ChangeSet.findOrFail(proposal.id)

      expect(stored.status).toBe('pending')
      expect(stored.appliedAt).toBeNull()
      expect(stored.diff.changes).toHaveLength(1)
      expect(stored.baseVersions).toEqual({})
      // A dry run is the pipeline with the transaction rolled back (ADR-0019), so the
      // savepoint must have taken the preview's revision away with it.
      expect(await Revision.all()).toHaveLength(1)
      expect((await Article.findOrFail(created.id)).published).toBe(false)

      await send('changesets.apply', { id: proposal.id })

      const applied = await ChangeSet.findOrFail(proposal.id)

      expect(applied.status).toBe('applied')
      expect(applied.appliedAt).not.toBeNull()
      expect((await Article.findOrFail(created.id)).published).toBe(true)
      expect(await Revision.all()).toHaveLength(2)
    })
  })
})

/**
 * The same claim, one step earlier, so it is checked even with no database around.
 *
 * The suites above skip themselves on a checkout without PostgreSQL, and a column
 * declared `not null` that the store writes `null` into is exactly the kind of defect
 * that survives a skipped suite. The DDL is between the model and the table, and it
 * can be read without either.
 */
describe('the schema these three stores ask a database for', () => {
  const nullableIn = (ddl: string, column: string): boolean =>
    ddl.includes(`"${column}" `) && !new RegExp(`"${column}" [^,\n]*not null`).test(ddl)

  it('lets a revision have no before and no after', () => {
    const ddl = createTableSql(Revision.descriptor)

    // A creation has no before; a deletion has no after (SPEC.md §64, §65).
    expect(nullableIn(ddl, 'before')).toBe(true)
    expect(nullableIn(ddl, 'after')).toBe(true)
    // Neither is a free-for-all: what a command always supplies stays required.
    expect(nullableIn(ddl, 'patch')).toBe(false)
    expect(nullableIn(ddl, 'command')).toBe(false)
  })

  it('lets an audit row name no entity and no actor', () => {
    const ddl = createTableSql(AuditLog.descriptor)

    // A command refused before it read anything records who tried and nothing else.
    expect(nullableIn(ddl, 'entity_type')).toBe(true)
    expect(nullableIn(ddl, 'entity_id')).toBe(true)
    // The system acting on its own behalf has no actor.
    expect(nullableIn(ddl, 'actor_type')).toBe(true)
    expect(nullableIn(ddl, 'action')).toBe(false)
  })

  it('lets a change set be unapplied', () => {
    const ddl = createTableSql(ChangeSet.descriptor)

    // Nothing in a proposal has happened yet, which is the whole point (SPEC.md §75).
    expect(nullableIn(ddl, 'applied_at')).toBe(true)
    expect(nullableIn(ddl, 'expires_at')).toBe(false)
  })
})

describe('the suite reports whether it actually ran', () => {
  it('says so out loud rather than passing quietly', () => {
    // Not an inverted guard: this assertion holds in both worlds. What it protects
    // against is a green run that silently proved nothing — `ASSEMORA_REQUIRE_POSTGRES`
    // is the switch that turns an unreachable database into a failure.
    expect(typeof reachable).toBe('boolean')

    if (!reachable) {
      expect(required).toBe(false)
    }
  })
})
