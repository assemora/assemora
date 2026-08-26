import { beforeEach, describe, expect, it } from 'vitest'

import type { TableDescriptor } from './adapter.js'
import { createMemoryAdapter, type MemoryAdapter } from './memory.js'
import {
  comparison,
  emptyQuery,
  group,
  jsonContains,
  jsonEquals,
  jsonLike,
  orComparison,
} from './query-ast.js'

const users: TableDescriptor = {
  name: 'users',
  primaryKey: 'id',
  columns: [],
  relations: [
    { name: 'posts', kind: 'hasMany', target: 'posts', foreignKey: 'authorId', ownerKey: 'id' },
  ],
}

const posts: TableDescriptor = {
  name: 'posts',
  primaryKey: 'id',
  columns: [],
  relations: [
    { name: 'author', kind: 'belongsTo', target: 'users', foreignKey: 'authorId', ownerKey: 'id' },
  ],
}

let adapter: MemoryAdapter

beforeEach(() => {
  adapter = createMemoryAdapter({
    users: [
      { id: 'u1', name: 'Ada', age: 36, active: true },
      { id: 'u2', name: 'Grace', age: 45, active: true },
      { id: 'u3', name: 'Alan', age: 41, active: false },
    ],
    posts: [
      { id: 'p1', authorId: 'u1', title: 'First', published: true },
      { id: 'p2', authorId: 'u1', title: 'Second', published: false },
      { id: 'p3', authorId: 'u2', title: 'Third', published: true },
    ],
  })
})

const select = (query = emptyQuery('users')) =>
  adapter.execute<Record<string, unknown>[]>(query, { table: users })

describe('conditions', () => {
  it('compares with every operator', async () => {
    const cases: [ReturnType<typeof comparison>, string[]][] = [
      [comparison('name', '=', 'Ada'), ['u1']],
      [comparison('name', '!=', 'Ada'), ['u2', 'u3']],
      [comparison('age', '>', 40), ['u2', 'u3']],
      [comparison('age', '>=', 41), ['u2', 'u3']],
      [comparison('age', '<', 41), ['u1']],
      [comparison('age', '<=', 41), ['u1', 'u3']],
      [comparison('id', 'in', ['u1', 'u3']), ['u1', 'u3']],
      [comparison('id', 'not in', ['u1']), ['u2', 'u3']],
      [comparison('name', 'like', 'A%'), ['u1', 'u3']],
      [comparison('age', 'between', [40, 42]), ['u3']],
    ]

    for (const [condition, expected] of cases) {
      const rows = await select({ ...emptyQuery('users'), where: [condition] })
      expect(rows.map((row) => row.id)).toEqual(expected)
    }
  })

  it('treats a missing value as null', async () => {
    const rows = await select({
      ...emptyQuery('users'),
      where: [comparison('deletedAt', 'is null')],
    })

    expect(rows).toHaveLength(3)
    const present = await select({
      ...emptyQuery('users'),
      where: [comparison('deletedAt', 'is not null')],
    })
    expect(present).toHaveLength(0)
  })

  it('combines conditions with and by default', async () => {
    const rows = await select({
      ...emptyQuery('users'),
      where: [comparison('active', '=', true), comparison('age', '>', 40)],
    })

    expect(rows.map((row) => row.id)).toEqual(['u2'])
  })

  it('honours or', async () => {
    const rows = await select({
      ...emptyQuery('users'),
      where: [comparison('name', '=', 'Ada'), orComparison('name', '=', 'Alan')],
    })

    expect(rows.map((row) => row.id)).toEqual(['u1', 'u3'])
  })

  it('groups conditions so precedence survives', async () => {
    const rows = await select({
      ...emptyQuery('users'),
      where: [
        comparison('active', '=', true),
        group([comparison('name', '=', 'Ada'), orComparison('name', '=', 'Grace')]),
      ],
    })

    expect(rows.map((row) => row.id)).toEqual(['u1', 'u2'])
  })
})

describe('JSON conditions', () => {
  beforeEach(() => {
    adapter.seed('users', [
      { id: 'j1', meta: { source: 'import', tags: ['history'], origin: null } },
      { id: 'j2', meta: { source: 'studio', tags: [], origin: 'crm' } },
      { id: 'j3', meta: { source: 'import', tags: ['history', 'maths'] } },
    ])
  })

  const ids = async (condition: ReturnType<typeof jsonEquals>) =>
    (await select({ ...emptyQuery('users'), where: [condition] })).map((row) => row.id)

  it('compares a scalar inside a document', async () => {
    expect(await ids(jsonEquals('meta', ['source'], 'import'))).toEqual(['j1', 'j3'])
  })

  it('compares arrays structurally, not as text', async () => {
    expect(await ids(jsonEquals('meta', ['tags'], ['history']))).toEqual(['j1'])
    expect(await ids(jsonEquals('meta', ['tags'], []))).toEqual(['j2'])
  })

  it('tells an explicit null apart from a missing key', async () => {
    expect(await ids(jsonEquals('meta', ['origin'], null))).toEqual(['j1'])
    expect(await ids(jsonEquals('meta', ['nothing'], null))).toEqual([])
  })

  it('compares objects structurally', async () => {
    adapter.seed('users', [{ id: 'j4', meta: { depth: { level: 2 } } }])

    expect(await ids(jsonEquals('meta', ['depth'], { level: 2 }))).toEqual(['j4'])
    expect(await ids(jsonEquals('meta', ['depth'], { level: 3 }))).toEqual([])
  })

  it('asks whether a document contains a fragment', async () => {
    expect(await ids(jsonContains('meta', { source: 'import' }))).toEqual(['j1', 'j3'])
    expect(await ids(jsonContains('meta', { tags: ['maths'] }))).toEqual(['j3'])
  })

  it('pattern-matches a key', async () => {
    expect(await ids(jsonLike('meta', ['source'], '%mpor%'))).toEqual(['j1', 'j3'])
  })
})

describe('ordering, limit and offset', () => {
  it('sorts ascending and descending', async () => {
    const ascending = await select({
      ...emptyQuery('users'),
      order: [{ field: 'age', direction: 'asc' }],
    })
    const descending = await select({
      ...emptyQuery('users'),
      order: [{ field: 'age', direction: 'desc' }],
    })

    expect(ascending.map((row) => row.age)).toEqual([36, 41, 45])
    expect(descending.map((row) => row.age)).toEqual([45, 41, 36])
  })

  it('falls through to the next sort key', async () => {
    adapter.seed('users', [
      { id: 'a', group: 1, name: 'B' },
      { id: 'b', group: 1, name: 'A' },
      { id: 'c', group: 0, name: 'C' },
    ])

    const rows = await select({
      ...emptyQuery('users'),
      order: [
        { field: 'group', direction: 'asc' },
        { field: 'name', direction: 'asc' },
      ],
    })

    expect(rows.map((row) => row.id)).toEqual(['c', 'b', 'a'])
  })

  it('applies offset before limit', async () => {
    const rows = await select({ ...emptyQuery('users'), offset: 1, limit: 1 })

    expect(rows.map((row) => row.id)).toEqual(['u2'])
  })
})

describe('writes', () => {
  it('inserts, updates, deletes and counts', async () => {
    await adapter.execute(
      { ...emptyQuery('users', 'insert'), data: { id: 'u4', age: 20 } },
      { table: users },
    )
    expect(adapter.rows('users')).toHaveLength(4)

    const updated = await adapter.execute<number>(
      { ...emptyQuery('users', 'update'), where: [comparison('id', '=', 'u4')], data: { age: 21 } },
      { table: users },
    )
    expect(updated).toBe(1)
    expect(adapter.rows('users').find((row) => row.id === 'u4')?.age).toBe(21)

    const removed = await adapter.execute<number>(
      { ...emptyQuery('users', 'delete'), where: [comparison('id', '=', 'u4')] },
      { table: users },
    )
    expect(removed).toBe(1)

    const total = await adapter.execute<number>(
      { ...emptyQuery('users', 'count') },
      { table: users },
    )
    expect(total).toBe(3)
  })

  it('hands back copies, so a caller cannot mutate the store', async () => {
    const [row] = await select()
    if (row !== undefined) row.name = 'changed'

    expect(adapter.rows('users')[0]?.name).toBe('Ada')
  })
})

describe('relations', () => {
  it('loads a hasMany relation', async () => {
    const rows = await adapter.execute<Record<string, unknown>[]>(
      {
        ...emptyQuery('users'),
        where: [comparison('id', '=', 'u1')],
        with: [{ relation: 'posts', nested: [] }],
      },
      { table: users, related: { posts } },
    )

    const loaded = rows[0] as { posts: { id: string }[] } | undefined

    expect(loaded?.posts.map((post) => post.id)).toEqual(['p1', 'p2'])
  })

  it('loads a belongsTo relation as a single row or null', async () => {
    const rows = await adapter.execute<Record<string, unknown>[]>(
      { ...emptyQuery('posts'), with: [{ relation: 'author', nested: [] }] },
      { table: posts, related: { users } },
    )

    const withAuthor = rows[0] as { author: { name: string } } | undefined

    expect(withAuthor?.author.name).toBe('Ada')

    adapter.seed('posts', [{ id: 'p9', authorId: 'missing' }])
    const orphans = await adapter.execute<Record<string, unknown>[]>(
      { ...emptyQuery('posts'), with: [{ relation: 'author', nested: [] }] },
      { table: posts, related: { users } },
    )

    expect(orphans[0]?.author).toBeNull()
  })

  it('loads a nested path', async () => {
    const rows = await adapter.execute<Record<string, unknown>[]>(
      {
        ...emptyQuery('users'),
        where: [comparison('id', '=', 'u1')],
        with: [{ relation: 'posts', nested: [{ relation: 'author', nested: [] }] }],
      },
      { table: users, related: { posts, users } },
    )

    const nestedRow = rows[0] as { posts: { author: { name: string } }[] } | undefined

    expect(nestedRow?.posts[0]?.author.name).toBe('Ada')
  })

  it('refuses a relation the table does not declare', async () => {
    await expect(
      adapter.execute(
        { ...emptyQuery('users'), with: [{ relation: 'ghosts', nested: [] }] },
        { table: users },
      ),
    ).rejects.toThrowError('has no relation "ghosts"')
  })
})

describe('transactions', () => {
  it('keeps the writes of a successful transaction', async () => {
    await adapter.transaction(async () => {
      await adapter.execute(
        { ...emptyQuery('users', 'insert'), data: { id: 'u4' } },
        { table: users },
      )
    })

    expect(adapter.rows('users')).toHaveLength(4)
  })

  it('rolls everything back when the transaction throws', async () => {
    await expect(
      adapter.transaction(async () => {
        await adapter.execute(
          { ...emptyQuery('users', 'insert'), data: { id: 'u4' } },
          { table: users },
        )
        throw new Error('no good')
      }),
    ).rejects.toThrowError('no good')

    expect(adapter.rows('users')).toHaveLength(3)
    expect(adapter.rows('users').map((row) => row.id)).toEqual(['u1', 'u2', 'u3'])
  })
})
