/**
 * The same Query AST, two adapters, one meaning (SPEC.md §30).
 *
 * The Query AST is the contract every layer above the database speaks. If the
 * in-memory adapter and PostgreSQL disagree about what a condition means, then every
 * test written against the memory adapter proves nothing about production — which is
 * how a JSON comparison came to match arrays in one and nothing at all in the other.
 */
import { userInfo } from 'node:os'

import {
  type ColumnDescriptor,
  type Condition,
  comparison,
  createMemoryAdapter,
  emptyQuery,
  group,
  joinTableDescriptor,
  jsonContains,
  jsonEquals,
  jsonLike,
  orComparison,
  pivotAddress,
  type RelationDescriptor,
  type RelationLoad,
  type TableDescriptor,
  withJoinTables,
} from '@assemora/database'
import {
  applySchema,
  dropSchema,
  type PostgresAdapter,
  postgres,
} from '@assemora/database-postgres'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { realInfrastructure } from './budget.ts'
import { isolate, schemaNamed } from './isolation.ts'

realInfrastructure()

const url =
  process.env.ASSEMORA_TEST_DATABASE_URL ??
  `postgres://${userInfo().username}@localhost:5432/assemora_test`

/** Where this file's tables live, and nobody else's (#28). */
const isolated = schemaNamed(import.meta.url)

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

const table: TableDescriptor = {
  name: 'conformance_docs',
  primaryKey: 'id',
  columns: [
    {
      name: 'id',
      type: 'uuid',
      isPrimary: true,
      isNullable: false,
      isUnique: false,
      isIndexed: false,
      hasDefault: false,
    },
    {
      name: 'title',
      type: 'string',
      isPrimary: false,
      isNullable: false,
      isUnique: false,
      isIndexed: false,
      hasDefault: false,
    },
    {
      name: 'views',
      type: 'integer',
      isPrimary: false,
      isNullable: true,
      isUnique: false,
      isIndexed: false,
      hasDefault: false,
    },
    {
      name: 'meta',
      type: 'json',
      isPrimary: false,
      isNullable: true,
      isUnique: false,
      isIndexed: false,
      hasDefault: false,
    },
  ],
  relations: [],
}

const rows = [
  {
    id: '11111111-1111-4111-8111-111111111111',
    title: 'Ada',
    views: 500,
    meta: { source: 'import', tags: ['history', 'maths'], origin: null, depth: { level: 2 } },
  },
  {
    id: '22222222-2222-4222-8222-222222222222',
    title: 'Alan',
    views: 20,
    meta: { source: 'studio', tags: [], origin: 'crm', depth: { level: 1 } },
  },
  {
    id: '33333333-3333-4333-8333-333333333333',
    title: 'Grace',
    views: null,
    meta: { source: 'import', tags: ['history'], depth: { level: 2 } },
  },
]

/**
 * A many-to-many, and a second many-to-many hanging off it (SPEC.md §23, §24).
 *
 * `belongsToMany` is the one relation that stores nothing on either table it links:
 * the pairs live in a table no model declares, derived by `joinTableDescriptor`. What
 * a load *means* is therefore decided outside both adapters, and these tables are what
 * lets the cases below ask whether the two then read the same rows out of it.
 */
const key: ColumnDescriptor = {
  name: 'id',
  type: 'uuid',
  isPrimary: true,
  isNullable: false,
  isUnique: false,
  isIndexed: false,
  hasDefault: false,
}

const label: ColumnDescriptor = { ...key, name: 'name', type: 'string', isPrimary: false }

const USERS = 'conformance_users'
const ROLES = 'conformance_roles'
const PERMISSIONS = 'conformance_permissions'
const TAGS = 'conformance_tags'

const manyToMany = (name: string, target: string): RelationDescriptor => ({
  name,
  kind: 'belongsToMany',
  target,
  // What `model()` describes for this kind. Neither table holds the column: the join
  // table does, and it is named by the derivation rather than by this.
  foreignKey: 'ignored',
  ownerKey: 'id',
})

const linkedTable = (name: string, relations: readonly RelationDescriptor[]): TableDescriptor => ({
  name,
  primaryKey: 'id',
  columns: [key, label],
  relations,
})

const permissions = linkedTable(PERMISSIONS, [])
const roles = linkedTable(ROLES, [
  manyToMany('permissions', PERMISSIONS),
  manyToMany('users', USERS),
])

/**
 * A far side identified by something other than `id`.
 *
 * Which column of the target a join column copies is read back off the derivation in
 * both adapters — `keyBehind` in one, `linkedKey` in the other — so that a load looks
 * where the write put the row. Every other table here has a primary key called `id`,
 * so replacing either call with the literal `'id'` left both suites green: this table
 * is what makes that a failure.
 */
const slug: ColumnDescriptor = { ...key, name: 'slug', type: 'string' }
const tags: TableDescriptor = {
  name: TAGS,
  primaryKey: 'slug',
  // `id` is a column of this table and is not its key. It is here so that a load
  // joining on the literal `'id'` runs and answers with nothing, rather than failing
  // on a column the table does not have — the assertion should say what went wrong.
  columns: [slug, label, { ...key, isPrimary: false }],
  relations: [],
}

const users = linkedTable(USERS, [manyToMany('roles', ROLES), manyToMany('tags', TAGS)])

const relationOf = (table: TableDescriptor, name: string): RelationDescriptor => {
  const found = table.relations.find((relation) => relation.name === name)

  if (found === undefined) throw new Error(`"${table.name}" has no relation "${name}"`)

  return found
}

/**
 * Derived exactly once, and shared by the DDL, the seed and every read.
 *
 * `joinTableDescriptor` answers with a fresh descriptor each call, and the PostgreSQL
 * adapter refuses two different descriptors that claim one table name — so a suite
 * that derived its join tables twice would fail for a reason that has nothing to do
 * with what it is asking. `withJoinTables` is the one derivation everything here uses.
 */
const schema = withJoinTables([users, roles, permissions, tags])

const joinTableOf = (owner: TableDescriptor, relation: string): TableDescriptor => {
  // Only the name is wanted, and that is derived from the two table names alone — the
  // descriptor the schema already holds is the one everything must share.
  const { name } = joinTableDescriptor(owner, relationOf(owner, relation))
  const found = schema.find((candidate) => candidate.name === name)

  if (found === undefined) throw new Error(`"${name}" is not in the expanded schema`)

  return found
}

/** A valid uuid from one hex digit, so the fixture reads as identity rather than noise. */
const id = (digit: string): string =>
  `${digit.repeat(8)}-${digit.repeat(4)}-4${digit.repeat(3)}-8${digit.repeat(3)}-${digit.repeat(12)}`

const [ada, alan, grace] = [id('1'), id('2'), id('3')]
const [admin, editor, auditor] = [id('4'), id('5'), id('6')]
const [publish, remove] = [id('7'), id('8')]

/**
 * The link rows for one relation, addressed the way the pivot verbs address them.
 *
 * Spelling a derived column name out here would stop the fixture testing the
 * derivation and start it testing a copy. The descriptor `pivotAddress` hands back is
 * dropped on purpose — the one in `schema` is what everything else uses.
 */
const linkRows = (
  owner: TableDescriptor,
  relation: string,
  target: TableDescriptor,
  pairs: Readonly<Record<string, readonly string[]>>,
): Record<string, unknown>[] =>
  Object.entries(pairs).flatMap(([ownerId, targetIds]) => {
    const pivot = pivotAddress(owner, relationOf(owner, relation), { id: ownerId }, target)

    return targetIds.map((targetId) => ({
      [pivot.ownerColumn]: pivot.ownerValue,
      [pivot.relatedColumn]: targetId,
    }))
  })

/**
 * Ordered so a table arrives before anything that points a foreign key at it.
 *
 * Every table is seeded in the *reverse* of its key order, and every set of links in
 * the reverse of the order it is expected back in. A load has to order by the target's
 * key to answer with what the cases below state; one that handed back whatever order
 * it found the rows in would agree with them only by accident.
 */
const linked: readonly (readonly [TableDescriptor, readonly Record<string, unknown>[]])[] = [
  [
    users,
    [
      { id: grace, name: 'Grace' },
      { id: alan, name: 'Alan' },
      { id: ada, name: 'Ada' },
    ],
  ],
  [
    roles,
    [
      // Auditor is linked to nobody, so a target reached by nothing is a row neither
      // adapter loads.
      { id: auditor, name: 'auditor' },
      { id: editor, name: 'editor' },
      { id: admin, name: 'admin' },
    ],
  ],
  [
    permissions,
    [
      { id: remove, name: 'delete' },
      { id: publish, name: 'publish' },
    ],
  ],
  [
    tags,
    [
      { slug: 'sql', name: 'sql', id: id('9') },
      { slug: 'ml', name: 'ml', id: id('a') },
      { slug: 'history', name: 'history', id: id('b') },
    ],
  ],
  [
    joinTableOf(users, 'roles'),
    // Grace holds none, and `admin` is held by two owners at once.
    linkRows(users, 'roles', roles, { [ada]: [editor, admin], [alan]: [admin] }),
  ],
  [
    joinTableOf(roles, 'permissions'),
    linkRows(roles, 'permissions', permissions, {
      [admin]: [remove, publish],
      [editor]: [publish],
    }),
  ],
  [
    joinTableOf(users, 'tags'),
    linkRows(users, 'tags', tags, { [ada]: ['sql', 'history'], [alan]: ['ml'] }),
  ],
]

let pg: PostgresAdapter

const memory = createMemoryAdapter({
  [table.name]: rows,
  ...Object.fromEntries(linked.map(([descriptor, seeded]) => [descriptor.name, seeded])),
})

beforeAll(async () => {
  if (!reachable) return

  pg = postgres({ url, schema: isolated })
  await isolate(pg, isolated)
  await dropSchema(pg, [table, ...schema])
  await applySchema(pg, [table, ...schema])

  for (const row of rows) {
    await pg.raw(
      `insert into "conformance_docs" ("id", "title", "views", "meta") values ($1, $2, $3, $4)`,
      [row.id, row.title, row.views, JSON.stringify(row.meta)],
    )
  }

  // Seeded through the Query AST rather than through SQL: the join table's columns are
  // derived, and naming them by hand here would be a second opinion about them.
  for (const [descriptor, seeded] of linked) {
    for (const row of seeded) {
      await pg.execute(
        { ...emptyQuery(descriptor.name, 'insert'), data: row },
        { table: descriptor },
      )
    }
  }
}, 30_000)

afterAll(async () => {
  if (!reachable) return

  await dropSchema(pg, [table, ...schema])
  await pg.close()
}, 30_000)

const idsFrom = async (
  adapter: { execute: <T>(query: never, context: never) => Promise<T> },
  where: readonly Condition[],
): Promise<string[]> => {
  const found = await adapter.execute<Record<string, unknown>[]>(
    { ...emptyQuery(table.name), where, order: [{ field: 'id', direction: 'asc' }] } as never,
    { table } as never,
  )

  return found.map((row) => String(row.id))
}

const CASES: [string, Condition[]][] = [
  ['a scalar column', [comparison('title', '=', 'Ada')]],
  ['a null column', [comparison('views', 'is null')]],
  ['a range', [comparison('views', 'between', [10, 100])]],
  ['membership', [comparison('title', 'in', ['Ada', 'Grace'])]],
  ['a pattern', [comparison('title', 'like', 'A%')]],
  ['or across two columns', [comparison('title', '=', 'Ada'), orComparison('views', '=', 20)]],
  [
    'a group',
    [
      comparison('title', 'like', '%a%'),
      group([comparison('views', '>', 100), orComparison('views', 'is null')]),
    ],
  ],
  ['a JSON scalar', [jsonEquals('meta', ['source'], 'import')]],
  ['a JSON scalar that matches nothing', [jsonEquals('meta', ['source'], 'nowhere')]],
  ['a nested JSON scalar', [jsonEquals('meta', ['depth', 'level'], 2)]],
  ['a JSON array', [jsonEquals('meta', ['tags'], ['history'])]],
  ['an empty JSON array', [jsonEquals('meta', ['tags'], [])]],
  ['an explicit JSON null', [jsonEquals('meta', ['origin'], null)]],
  ['a missing JSON key', [jsonEquals('meta', ['nothing'], 'x')]],
  ['a JSON object', [jsonEquals('meta', ['depth'], { level: 1 })]],
  ['JSON containment', [jsonContains('meta', { source: 'import' })]],
  ['JSON containment of an array element', [jsonContains('meta', { tags: ['history'] })]],
  ['a JSON pattern', [jsonLike('meta', ['source'], '%mpor%')]],
]

describe.skipIf(!reachable)('the same AST means the same thing in both adapters', () => {
  for (const [name, where] of CASES) {
    it(`agrees on ${name}`, async () => {
      const fromMemory = await idsFrom(memory as never, where)
      const fromPostgres = await idsFrom(pg as never, where)

      expect(fromPostgres).toEqual(fromMemory)
    })
  }
})

type Loaded = Record<string, unknown>

const loadedFrom = (
  adapter: { execute: <T>(query: never, context: never) => Promise<T> },
  from: TableDescriptor,
  load: readonly RelationLoad[],
  where: readonly Condition[] = [],
): Promise<Loaded[]> =>
  adapter.execute<Loaded[]>(
    {
      ...emptyQuery(from.name),
      where,
      with: load,
      order: [{ field: 'name', direction: 'asc' }],
    } as never,
    // The join tables are deliberately absent: nothing declares them, and an adapter
    // that cannot derive one cannot load the relation at all.
    {
      table: from,
      related: { [USERS]: users, [ROLES]: roles, [PERMISSIONS]: permissions, [TAGS]: tags },
    } as never,
  )

/**
 * A loaded tree reduced to the names at each hop, in the order it arrived in.
 *
 * Deliberately not sorted. A `belongsToMany` is loaded through a join table, which has
 * no order of its own, so the two adapters had one each — PostgreSQL by the target's
 * key, the memory adapter by whatever order it stored the rows in — and a comparison
 * that sorted first proved they agreed on the *membership* while they disagreed about
 * `user.roles[0]`. `RelationLoad` now states the order, and this is where it is
 * checked. A relation loaded as anything but an array — `null`, or missing — is left
 * as it is, so the failure shows what arrived instead.
 */
const shapeOf = (value: unknown, load: readonly RelationLoad[]): unknown => {
  if (!Array.isArray(value)) return value

  return value.map((row: Loaded) => ({
    name: String(row.name),
    ...Object.fromEntries(
      load.map((hop) => [hop.relation, shapeOf(row[hop.relation], hop.nested)]),
    ),
  }))
}

/**
 * The cases ADR-0013 asks a new relation kind to arrive with (SPEC.md §23).
 *
 * Each states what the load means rather than comparing one adapter to the other:
 * two adapters that agree on the wrong answer agree on nothing worth having.
 */
const RELATION_CASES: [string, TableDescriptor, RelationLoad[], Condition[], unknown][] = [
  [
    'loading a many-to-many',
    users,
    [{ relation: 'roles', nested: [] }],
    [],
    [
      { name: 'Ada', roles: [{ name: 'admin' }, { name: 'editor' }] },
      { name: 'Alan', roles: [{ name: 'admin' }] },
      { name: 'Grace', roles: [] },
    ],
  ],
  [
    'an owner with nothing linked',
    users,
    [{ relation: 'roles', nested: [] }],
    [comparison('name', '=', 'Grace')],
    // An empty array, never null and never absent: the question was asked and the
    // answer is that Grace holds no roles.
    [{ name: 'Grace', roles: [] }],
  ],
  [
    'a target two owners share',
    users,
    [{ relation: 'roles', nested: [] }],
    [comparison('name', 'in', ['Ada', 'Alan'])],
    [
      { name: 'Ada', roles: [{ name: 'admin' }, { name: 'editor' }] },
      { name: 'Alan', roles: [{ name: 'admin' }] },
    ],
  ],
  [
    'a many-to-many nested inside a many-to-many',
    users,
    [{ relation: 'roles', nested: [{ relation: 'permissions', nested: [] }] }],
    [comparison('name', '=', 'Ada')],
    [
      {
        name: 'Ada',
        roles: [
          // Ordered by the permission's key, which is neither the order the links were
          // written in nor the order the names sort in: `publish` is 7777, `delete` is
          // 8888.
          { name: 'admin', permissions: [{ name: 'publish' }, { name: 'delete' }] },
          { name: 'editor', permissions: [{ name: 'publish' }] },
        ],
      },
    ],
  ],
  [
    'the same join table read from the other end',
    roles,
    [{ relation: 'users', nested: [] }],
    [],
    [
      { name: 'admin', users: [{ name: 'Ada' }, { name: 'Alan' }] },
      { name: 'auditor', users: [] },
      { name: 'editor', users: [{ name: 'Ada' }] },
    ],
  ],
  [
    'a far side keyed by something other than `id`',
    users,
    [{ relation: 'tags', nested: [] }],
    [],
    [
      // Reached through `slug`, which is what the join column copies, and ordered by
      // it: `history` before `sql`. The `id` column those rows also carry is not the
      // key, and an adapter that joined on it would answer with nothing.
      { name: 'Ada', tags: [{ name: 'history' }, { name: 'sql' }] },
      { name: 'Alan', tags: [{ name: 'ml' }] },
      { name: 'Grace', tags: [] },
    ],
  ],
]

describe.skipIf(!reachable)('a many-to-many means the same thing in both adapters', () => {
  for (const [name, from, load, where, expected] of RELATION_CASES) {
    it(`agrees on ${name}`, async () => {
      expect(shapeOf(await loadedFrom(memory as never, from, load, where), load)).toEqual(expected)
      expect(shapeOf(await loadedFrom(pg as never, from, load, where), load)).toEqual(expected)
    })
  }
})
