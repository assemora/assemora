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
  type Condition,
  comparison,
  createMemoryAdapter,
  emptyQuery,
  group,
  jsonContains,
  jsonEquals,
  jsonLike,
  orComparison,
  type TableDescriptor,
} from '@assemora/database'
import {
  applySchema,
  dropSchema,
  type PostgresAdapter,
  postgres,
} from '@assemora/database-postgres'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

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

let pg: PostgresAdapter

const memory = createMemoryAdapter({ [table.name]: rows })

beforeAll(async () => {
  if (!reachable) return

  pg = postgres({ url })
  await dropSchema(pg, [table])
  await applySchema(pg, [table])

  for (const row of rows) {
    await pg.raw(
      `insert into "conformance_docs" ("id", "title", "views", "meta") values ($1, $2, $3, $4)`,
      [row.id, row.title, row.views, JSON.stringify(row.meta)],
    )
  }
}, 30_000)

afterAll(async () => {
  if (!reachable) return

  await dropSchema(pg, [table])
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
