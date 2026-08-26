import {
  comparison,
  group,
  jsonContains,
  jsonEquals,
  jsonLike,
  orComparison,
  type TableDescriptor,
} from '@assemora/database'
import { PgDialect } from 'drizzle-orm/pg-core'
import { beforeEach, describe, expect, it } from 'vitest'

import { clearTableCache, columnsOf, drizzleTable, toColumnName } from './schema.js'
import { buildOrder, buildWhere } from './translate.js'

const posts: TableDescriptor = {
  name: 'posts',
  primaryKey: 'id',
  columns: [
    {
      name: 'id',
      type: 'uuid',
      isPrimary: true,
      isNullable: false,
      isUnique: false,
      isIndexed: false,
      hasDefault: true,
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
      name: 'viewCount',
      type: 'integer',
      isPrimary: false,
      isNullable: false,
      isUnique: false,
      isIndexed: true,
      hasDefault: false,
    },
    {
      name: 'publishedAt',
      type: 'timestamp',
      isPrimary: false,
      isNullable: true,
      isUnique: false,
      isIndexed: false,
      hasDefault: false,
    },
    {
      name: 'metadata',
      type: 'json',
      isPrimary: false,
      isNullable: false,
      isUnique: false,
      isIndexed: false,
      hasDefault: false,
    },
  ],
  relations: [],
}

const dialect = new PgDialect()

const render = (conditions: Parameters<typeof buildWhere>[1]) => {
  const built = buildWhere(columnsOf(drizzleTable(posts)), conditions)

  if (built === undefined) return { sql: '', params: [] as unknown[] }

  const query = dialect.sqlToQuery(built)

  return { sql: query.sql, params: query.params }
}

beforeEach(() => {
  clearTableCache()
})

describe('identifiers', () => {
  it('maps camelCase fields to snake_case columns', () => {
    expect(toColumnName('publishedAt')).toBe('published_at')
    expect(toColumnName('id')).toBe('id')
    expect(toColumnName('viewCount')).toBe('view_count')
  })

  it('addresses columns by their Assemora field name', () => {
    expect(Object.keys(columnsOf(drizzleTable(posts)))).toEqual([
      'id',
      'title',
      'viewCount',
      'publishedAt',
      'metadata',
    ])
  })
})

describe('comparisons', () => {
  it('translates every operator', () => {
    const cases: [Parameters<typeof buildWhere>[1], string][] = [
      [[comparison('title', '=', 'x')], '"posts"."title" = $1'],
      [[comparison('title', '!=', 'x')], '"posts"."title" <> $1'],
      [[comparison('viewCount', '>', 1)], '"posts"."view_count" > $1'],
      [[comparison('viewCount', '>=', 1)], '"posts"."view_count" >= $1'],
      [[comparison('viewCount', '<', 1)], '"posts"."view_count" < $1'],
      [[comparison('viewCount', '<=', 1)], '"posts"."view_count" <= $1'],
      // `ilike`: the in-memory adapter matches case-insensitively, and one AST must
      // not mean two things (SPEC.md §30).
      [[comparison('title', 'like', 'a%')], '"posts"."title" ilike $1'],
      [[comparison('publishedAt', 'is null')], '"posts"."published_at" is null'],
      [[comparison('publishedAt', 'is not null')], '"posts"."published_at" is not null'],
    ]

    for (const [conditions, expected] of cases) {
      expect(render(conditions).sql).toBe(expected)
    }
  })

  it('translates set membership', () => {
    const { sql, params } = render([comparison('title', 'in', ['a', 'b'])])

    expect(sql).toBe('"posts"."title" in ($1, $2)')
    expect(params).toEqual(['a', 'b'])
  })

  it('translates a range', () => {
    const { sql, params } = render([comparison('viewCount', 'between', [1, 10])])

    expect(sql).toBe('"posts"."view_count" between $1 and $2')
    expect(params).toEqual([1, 10])
  })

  it('refuses an unknown field rather than guessing', () => {
    expect(() => render([comparison('nickname', '=', 'x')])).toThrowError(
      'No column is mapped for "nickname"',
    )
  })

  it('refuses a set operator without an array', () => {
    expect(() => render([comparison('title', 'in', 'a')])).toThrowError('needs an array of values')
  })
})

describe('combining conditions', () => {
  it('folds left to right, and before or', () => {
    const { sql } = render([
      comparison('title', '=', 'x'),
      comparison('viewCount', '>', 1),
      orComparison('publishedAt', 'is null'),
    ])

    // The fold is made explicit in the SQL, which is what keeps it identical to the
    // in-memory adapter's left-to-right evaluation.
    expect(sql).toBe(
      '(("posts"."title" = $1 and "posts"."view_count" > $2) or "posts"."published_at" is null)',
    )
  })

  it('keeps a group parenthesised', () => {
    const { sql } = render([
      comparison('title', '=', 'x'),
      group([comparison('viewCount', '>', 1), orComparison('viewCount', '<', 0)]),
    ])

    expect(sql).toBe(
      '("posts"."title" = $1 and ("posts"."view_count" > $2 or "posts"."view_count" < $3))',
    )
  })

  it('produces nothing for an empty condition list', () => {
    expect(render([]).sql).toBe('')
  })
})

describe('JSONB', () => {
  it('compares a key as jsonb, so arrays and null behave as they do in memory', () => {
    const { sql, params } = render([jsonEquals('metadata', ['source'], 'import')])

    expect(sql).toBe('jsonb_extract_path("posts"."metadata", $1) = $2::jsonb')
    expect(params).toEqual(['source', '"import"'])
  })

  it('reads a nested key', () => {
    const { sql, params } = render([jsonEquals('metadata', ['origin', 'system'], 'crm')])

    expect(sql).toBe('jsonb_extract_path("posts"."metadata", $1, $2) = $3::jsonb')
    expect(params).toEqual(['origin', 'system', '"crm"'])
  })

  it('serializes an array or null the same way', () => {
    expect(render([jsonEquals('metadata', ['tags'], ['a', 'b'])]).params).toEqual([
      'tags',
      '["a","b"]',
    ])
    expect(render([jsonEquals('metadata', ['origin'], null)]).params).toEqual(['origin', 'null'])
  })

  it('pattern-matches a key case-insensitively', () => {
    const { sql, params } = render([jsonLike('metadata', ['source'], '%mpor%')])

    expect(sql).toBe('jsonb_extract_path_text("posts"."metadata", $1) ilike $2')
    expect(params).toEqual(['source', '%mpor%'])
  })

  it('compares the whole document when the path is empty', () => {
    const { sql, params } = render([jsonEquals('metadata', [], { source: 'import' })])

    expect(sql).toBe('"posts"."metadata" = $1::jsonb')
    expect(params).toEqual(['{"source":"import"}'])
  })

  it('asks whether a document contains a fragment', () => {
    const { sql, params } = render([jsonContains('metadata', { source: 'import' })])

    expect(sql).toBe('"posts"."metadata" @> $1::jsonb')
    expect(params).toEqual(['{"source":"import"}'])
  })
})

describe('ordering', () => {
  it('translates direction and column name', () => {
    const columns = columnsOf(drizzleTable(posts))
    const rendered = buildOrder(columns, [
      { field: 'viewCount', direction: 'desc' },
      { field: 'title', direction: 'asc' },
    ]).map((step) => dialect.sqlToQuery(step).sql)

    expect(rendered).toEqual(['"posts"."view_count" desc', '"posts"."title" asc'])
  })

  it('refuses to order by an unknown field', () => {
    expect(() =>
      buildOrder(columnsOf(drizzleTable(posts)), [{ field: 'rank', direction: 'asc' }]),
    ).toThrowError('No column is mapped for "rank"')
  })
})
