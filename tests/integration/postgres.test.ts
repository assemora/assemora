/**
 * PostgreSQL integration tests (SPEC.md §95).
 *
 * They run the whole stack — `model()` → query builder → Query AST → the PostgreSQL
 * adapter → a real database — which is what SPEC.md §119 asks the data layer to
 * prove. The suite skips itself when no database is reachable, so a checkout without
 * PostgreSQL still passes `pnpm verify`.
 */
import { userInfo } from 'node:os'
import {
  belongsTo,
  boolean,
  enumOf,
  hasMany,
  hasOne,
  json,
  model,
  number,
  string,
  text,
  timestamp,
  transaction,
  useAdapter,
  uuid,
} from '@assemora/data'
import {
  applyMigrations,
  applySchema,
  dropSchema,
  migrationStatus,
  type PostgresAdapter,
  postgres,
  rollbackLastMigration,
} from '@assemora/database-postgres'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

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

type Metadata = { readonly source: string; readonly tags?: readonly string[] }

const User = model('it_users', {
  id: uuid().primary().defaultRandom(),
  email: string().unique(),
  displayName: string(),
  active: boolean().default(true),
  createdAt: timestamp().created(),
  posts: hasMany(() => Post, { foreignKey: 'authorId' }),
  latestPost: hasOne(() => Post, { foreignKey: 'authorId' }),
})

const Post = model(
  'it_posts',
  {
    id: uuid().primary().defaultRandom(),
    authorId: uuid(),
    title: text(),
    status: enumOf('draft', 'published'),
    views: number().default(0),
    metadata: json<Metadata>(),
    deletedAt: timestamp().nullable(),
    author: belongsTo(() => User, { foreignKey: 'authorId' }),
  },
  {
    softDeletes: true,
    scopes: {
      published: (query) => query.where('status', 'published'),
    },
  },
)

let adapter: PostgresAdapter

beforeAll(async () => {
  if (!reachable) return

  adapter = postgres({ url })
  useAdapter(adapter)

  await dropSchema(adapter, [Post.descriptor, User.descriptor])
  await applySchema(adapter, [User.descriptor, Post.descriptor])

  // Opens the pool up front. Without this the concurrency tests below measure
  // connection establishment as much as concurrency, and on a busy machine that
  // alone can outlast a test timeout.
  await Promise.all(Array.from({ length: 10 }, () => adapter.raw('select 1')))
}, 30_000)

afterAll(async () => {
  if (!reachable) return

  await dropSchema(adapter, [Post.descriptor, User.descriptor])
  await adapter.raw('drop table if exists "assemora_migrations"')
  await adapter.close()
}, 30_000)

beforeEach(async () => {
  if (!reachable) return

  await adapter.raw('truncate "it_posts", "it_users" cascade')
  adapter.diagnostics.reset()
}, 15_000)

const seed = async () => {
  const ada = await User.create({ email: 'ada@x.io', displayName: 'Ada' })
  const alan = await User.create({ email: 'alan@x.io', displayName: 'Alan', active: false })

  await Post.create({
    authorId: ada.id,
    title: 'First',
    status: 'published',
    views: 500,
    metadata: { source: 'import', tags: ['history'] },
  })
  await Post.create({
    authorId: ada.id,
    title: 'Second',
    status: 'draft',
    views: 10,
    metadata: { source: 'studio' },
  })
  await Post.create({
    authorId: alan.id,
    title: 'Third',
    status: 'published',
    views: 20,
    metadata: { source: 'import' },
  })

  return { ada, alan }
}

describe.skipIf(!reachable)('PostgreSQL adapter', () => {
  describe('CRUD', () => {
    it('writes a row and reads it back with its types intact', async () => {
      const created = await User.create({ email: 'ada@x.io', displayName: 'Ada' })

      expect(created.id).toMatch(/^[0-9a-f-]{36}$/)

      const found = await User.findOrFail(created.id)

      expect(found.email).toBe('ada@x.io')
      expect(found.active).toBe(true)
      expect(found.createdAt).toBeInstanceOf(Date)
    })

    it('updates only the columns that changed', async () => {
      const user = await User.create({ email: 'ada@x.io', displayName: 'Ada' })

      user.displayName = 'Augusta'
      await user.save()

      const reloaded = await User.findOrFail(user.id)

      expect(reloaded.displayName).toBe('Augusta')
      expect(reloaded.email).toBe('ada@x.io')
    })

    it('deletes a row', async () => {
      const user = await User.create({ email: 'ada@x.io', displayName: 'Ada' })
      await user.delete()

      expect(await User.find(user.id)).toBeNull()
      expect(await User.count()).toBe(0)
    })

    it('turns a unique violation into an Assemora error, without leaking the statement', async () => {
      await User.create({ email: 'ada@x.io', displayName: 'Ada' })

      const failure = await User.create({ email: 'ada@x.io', displayName: 'Other' }).catch(
        (error: unknown) => error,
      )

      expect(failure).toMatchObject({
        code: 'UNIQUE_VIOLATION',
        status: 409,
        details: { constraint: expect.stringContaining('email') },
      })

      // The driver's own message carries the SQL and every parameter value with it,
      // and none of that may reach a caller or a log (SPEC.md §85).
      const message = (failure as Error).message
      expect(message).not.toContain('insert into')
      expect(message).not.toContain('ada@x.io')
    })

    it('turns a foreign key violation into an Assemora error', async () => {
      const failure = await Post.create({
        authorId: '00000000-0000-4000-8000-000000000000',
        title: 'Orphan',
        status: 'draft',
        metadata: { source: 'api' },
      }).catch((error: unknown) => error)

      expect(failure).toMatchObject({ code: 'FOREIGN_KEY_VIOLATION', status: 409 })
    })

    it('turns a check violation into an Assemora error', async () => {
      const { ada } = await seed()

      // Written through the adapter, so what is asserted is the translation the
      // adapter performs — not the driver's own error.
      const failure = await adapter
        .raw(
          `insert into "it_posts" ("id", "author_id", "title", "status", "views", "metadata") values (gen_random_uuid(), $1, 'X', 'nonsense', 0, '{}')`,
          [ada.id],
        )
        .catch((error: unknown) => error)

      expect(failure).toMatchObject({ code: 'CHECK_VIOLATION', status: 422 })
      expect((failure as Error).message).not.toContain('insert into')
    })
  })

  describe('the adapter refuses what would otherwise be lost', () => {
    it('rejects a column the table does not have instead of dropping it', async () => {
      const failure = await adapter
        .execute(
          {
            model: 'it_users',
            operation: 'insert',
            where: [],
            order: [],
            with: [],
            data: { email: 'ghost@x.io', displayName: 'Ghost', nickname: 'silently-dropped' },
          },
          { table: User.descriptor },
        )
        .catch((error: unknown) => error)

      expect(failure).toMatchObject({ code: 'UNKNOWN_FIELD', status: 500 })
      expect(await User.count()).toBe(0)
    })

    it('rejects an unknown column on update too', async () => {
      const user = await User.create({ email: 'ada@x.io', displayName: 'Ada' })

      const failure = await adapter
        .execute(
          {
            model: 'it_users',
            operation: 'update',
            where: [],
            order: [],
            with: [],
            data: { nickname: 'nope' },
          },
          { table: User.descriptor },
        )
        .catch((error: unknown) => error)

      expect(failure).toMatchObject({ code: 'UNKNOWN_FIELD' })
      expect((await User.findOrFail(user.id)).displayName).toBe('Ada')
    })
  })

  describe('querying', () => {
    it('filters, orders and limits', async () => {
      await seed()

      const found = await Post.where('views', '>', 15).orderBy('views', 'desc').take(1)

      expect(found.map((post) => post.title)).toEqual(['First'])
    })

    it('applies a scope', async () => {
      await seed()

      expect(await Post.published().count()).toBe(2)
    })

    it('groups conditions the way the AST says', async () => {
      await seed()

      const found = await Post.where('status', 'published')
        .where((query) => query.where('views', '>', 100).orWhere('title', 'Third'))
        .orderBy('title')

      expect(found.map((post) => post.title)).toEqual(['First', 'Third'])
    })

    it('paginates', async () => {
      await seed()

      const page = await Post.orderBy('title').paginate(2, 1)

      expect(page).toMatchObject({ total: 3, page: 2, perPage: 1, lastPage: 3 })
      expect(page.data.map((post) => post.title)).toEqual(['Second'])
    })
  })

  describe('relations', () => {
    it('loads a hasMany relation', async () => {
      const { ada } = await seed()

      const [user] = await User.where('id', ada.id).with('posts')
      const posts = (user as unknown as { posts: { title: string }[] }).posts

      expect(posts.map((post) => post.title).sort()).toEqual(['First', 'Second'])
    })

    it('loads a belongsTo relation', async () => {
      await seed()

      const [post] = await Post.where('title', 'First').with('author')

      expect((post as unknown as { author: { displayName: string } }).author.displayName).toBe(
        'Ada',
      )
    })

    it('loads a nested path', async () => {
      const { ada } = await seed()

      const [user] = await User.where('id', ada.id).with('posts.author')
      const posts = (user as unknown as { posts: { author: { displayName: string } }[] }).posts

      expect(posts[0]?.author.displayName).toBe('Ada')
    })

    it('loads a hasOne relation as a single row', async () => {
      const { ada } = await seed()

      // The same foreign key as `posts`, read through the other relation kind.
      const [user] = await User.where('id', ada.id).with('latestPost')
      const latest = (user as unknown as { latestPost: { title: string } | null }).latestPost

      expect(latest).not.toBeNull()
      expect(typeof latest?.title).toBe('string')
    })

    it('loads relations in batches rather than one query per row (SPEC.md §89)', async () => {
      await seed()

      adapter.diagnostics.reset()
      const users = await User.with('posts')

      expect(users).toHaveLength(2)
      // One statement for the parents, one for the relation — never one per row.
      expect(adapter.diagnostics.statementCount()).toBe(2)
    })
  })

  describe('JSONB', () => {
    it('reads a key out of a document', async () => {
      await seed()

      const found = await Post.whereJson('metadata', 'source', 'studio')

      expect(found.map((post) => post.title)).toEqual(['Second'])
    })

    it('asks whether a document contains a fragment', async () => {
      await seed()

      const found = await Post.whereJsonContains('metadata', { source: 'import' }).orderBy('title')

      expect(found.map((post) => post.title)).toEqual(['First', 'Third'])
    })

    it('round-trips a nested document', async () => {
      const { ada } = await seed()

      const post = await Post.create({
        authorId: ada.id,
        title: 'Nested',
        status: 'draft',
        metadata: { source: 'api', tags: ['a', 'b'] },
      })

      expect((await Post.findOrFail(post.id)).metadata).toEqual({
        source: 'api',
        tags: ['a', 'b'],
      })
    })
  })

  describe('transactions', () => {
    it('commits everything the operation did', async () => {
      await transaction(async () => {
        await User.create({ email: 'ada@x.io', displayName: 'Ada' })
        await User.create({ email: 'alan@x.io', displayName: 'Alan' })
      })

      expect(await User.count()).toBe(2)
    })

    it('rolls everything back when the operation throws', async () => {
      await expect(
        transaction(async () => {
          await User.create({ email: 'ada@x.io', displayName: 'Ada' })
          throw new Error('no good')
        }),
      ).rejects.toThrowError('no good')

      expect(await User.count()).toBe(0)
    })

    it('discards the writes of a nested transaction when the outer one rolls back', async () => {
      await expect(
        transaction(async () => {
          await User.create({ email: 'outer@x.io', displayName: 'Outer' })

          await transaction(async () => {
            await User.create({ email: 'inner@x.io', displayName: 'Inner' })
          })

          throw new Error('the outer operation failed')
        }),
      ).rejects.toThrowError('the outer operation failed')

      // A nested transaction is a savepoint on the same connection, not a second
      // transaction of its own; otherwise the inner write would survive the rollback.
      expect(await User.count()).toBe(0)
    })

    it('keeps the outer writes when only the nested transaction fails', async () => {
      await transaction(async () => {
        await User.create({ email: 'outer@x.io', displayName: 'Outer' })

        await transaction(async () => {
          await User.create({ email: 'inner@x.io', displayName: 'Inner' })
          throw new Error('the nested operation failed')
        }).catch(() => undefined)
      })

      const survivors = await User.all()

      expect(survivors.map((user) => user.email)).toEqual(['outer@x.io'])
    })

    it('keeps two concurrent transactions apart', async () => {
      // Sequential tests pass even if the current transaction were a single shared
      // variable. Only overlapping ones show whether AsyncLocalStorage really scopes
      // it per operation (SPEC.md §33).
      const committed = transaction(async () => {
        await User.create({ email: 'keeper@x.io', displayName: 'Keeper' })
        await new Promise((resolve) => setTimeout(resolve, 60))
        await User.create({ email: 'keeper2@x.io', displayName: 'Keeper 2' })
      })

      const discarded = transaction(async () => {
        await new Promise((resolve) => setTimeout(resolve, 20))
        await User.create({ email: 'ghost@x.io', displayName: 'Ghost' })
        throw new Error('this one fails')
      }).catch(() => undefined)

      await Promise.all([committed, discarded])

      const survivors = (await User.all()).map((user) => user.email).sort()

      expect(survivors).toEqual(['keeper2@x.io', 'keeper@x.io'])
    }, 20_000)

    it('rolls back when the database itself refuses the write', async () => {
      await User.create({ email: 'ada@x.io', displayName: 'Ada' })

      await expect(
        transaction(async () => {
          await User.create({ email: 'grace@x.io', displayName: 'Grace' })
          await User.create({ email: 'ada@x.io', displayName: 'Clash' })
        }),
      ).rejects.toThrowError()

      expect(await User.count()).toBe(1)
    })
  })

  describe('soft deletes', () => {
    it('marks instead of removing, and restores', async () => {
      const { ada } = await seed()
      const post = await Post.where('authorId', ada.id).where('title', 'Second').firstOrFail()

      await post.delete()

      expect(await Post.count()).toBe(2)
      expect(await Post.withTrashed().count()).toBe(3)
      expect(await Post.onlyTrashed().count()).toBe(1)

      const trashed = await Post.onlyTrashed().firstOrFail()
      await trashed.restore()

      expect(await Post.count()).toBe(3)
    })
  })

  describe('concurrency', () => {
    it('keeps parallel writes consistent', async () => {
      const users = await Promise.all(
        Array.from({ length: 10 }, (_, index) =>
          User.create({ email: `user${index}@x.io`, displayName: `User ${index}` }),
        ),
      )

      expect(new Set(users.map((user) => user.id)).size).toBe(10)
      expect(await User.count()).toBe(10)
    }, 20_000)

    it('lets only one of two racing inserts win a unique column', async () => {
      const attempts = await Promise.allSettled([
        User.create({ email: 'same@x.io', displayName: 'First' }),
        User.create({ email: 'same@x.io', displayName: 'Second' }),
      ])

      expect(attempts.filter((attempt) => attempt.status === 'fulfilled')).toHaveLength(1)
      expect(attempts.filter((attempt) => attempt.status === 'rejected')).toMatchObject([
        { reason: { code: 'UNIQUE_VIOLATION' } },
      ])
      // Counted by the value under test rather than by the whole table, so a write
      // that outlived another test cannot make this one lie.
      expect(await User.where('email', 'same@x.io').count()).toBe(1)
    }, 20_000)
  })

  describe('introspection', () => {
    it('reports the real types, keys and names of what is actually there', async () => {
      const schema = await adapter.introspect()
      const users = schema.tables.find((table) => table.name === 'it_users')

      expect(users?.primaryKey).toBe('id')

      const byName = new Map(users?.columns.map((column) => [column.name, column]))

      // Reported in the same naming domain a descriptor uses, not as `display_name`.
      expect([...byName.keys()]).toEqual(
        expect.arrayContaining(['id', 'email', 'displayName', 'active', 'createdAt']),
      )
      expect(byName.get('id')).toMatchObject({ type: 'uuid', isPrimary: true, isNullable: false })
      expect(byName.get('email')).toMatchObject({ type: 'string', isUnique: true })
      expect(byName.get('active')).toMatchObject({ type: 'boolean' })
      expect(byName.get('createdAt')).toMatchObject({ type: 'timestamp' })
    })
  })

  describe('migrations', () => {
    const migration = {
      name: '0001_add_tagline',
      up: ['alter table "it_users" add column if not exists "tagline" text'],
      down: ['alter table "it_users" drop column if exists "tagline"'],
    }

    const hasColumn = async () => {
      const result = await adapter.raw(
        `select 1 from information_schema.columns where table_name = 'it_users' and column_name = 'tagline'`,
      )

      return result.rowCount === 1
    }

    it('applies, reports and rolls back', async () => {
      expect(await applyMigrations(adapter, [migration])).toEqual(['0001_add_tagline'])
      expect(await hasColumn()).toBe(true)

      expect(await migrationStatus(adapter, [migration])).toMatchObject([
        { name: '0001_add_tagline', applied: true },
      ])

      // Running again is a no-op, which is what makes deploys repeatable.
      expect(await applyMigrations(adapter, [migration])).toEqual([])

      expect(await rollbackLastMigration(adapter, [migration])).toBe('0001_add_tagline')
      expect(await hasColumn()).toBe(false)
      expect(await migrationStatus(adapter, [migration])).toMatchObject([{ applied: false }])
    })

    it('rolls a failing migration back and reports it as an Assemora error', async () => {
      const broken = {
        name: '0002_broken',
        up: [
          'alter table "it_users" add column if not exists "temporary" text',
          'alter table "it_users" add column "temporary" text',
        ],
      }

      const failure = await applyMigrations(adapter, [broken]).catch((error: unknown) => error)

      expect(failure).toMatchObject({ code: expect.stringMatching(/^[A-Z_]+$/) })
      expect((failure as Error).message).not.toContain('alter table')

      // Nothing of a failed migration survives, and it is not recorded as applied.
      const columns = await adapter.raw(
        `select 1 from information_schema.columns where table_name = 'it_users' and column_name = 'temporary'`,
      )
      expect(columns.rowCount).toBe(0)
      expect(await migrationStatus(adapter, [broken])).toMatchObject([{ applied: false }])
    })

    it('refuses to roll back a migration that declares no down statements', async () => {
      const oneWay = { name: '0003_one_way', up: ['select 1'] }

      await applyMigrations(adapter, [oneWay])

      await expect(rollbackLastMigration(adapter, [oneWay])).rejects.toThrowError(
        'declares no down statements',
      )

      await adapter.raw(`delete from "assemora_migrations" where name = '0003_one_way'`)
    })

    it('reports nothing to roll back when nothing was applied', async () => {
      expect(await rollbackLastMigration(adapter, [{ name: 'never', up: [], down: [] }])).toBeNull()
    })
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
