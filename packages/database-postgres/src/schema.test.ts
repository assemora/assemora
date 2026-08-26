import type { TableDescriptor } from '@assemora/database'
import { beforeEach, describe, expect, it } from 'vitest'

import { clearTableCache, columnsOf, drizzleTable, toColumnName } from './schema.js'

const descriptor = (name: string, columns: string[] = ['id']): TableDescriptor => ({
  name,
  primaryKey: 'id',
  columns: columns.map((column) => ({
    name: column,
    type: column === 'id' ? 'uuid' : 'string',
    isPrimary: column === 'id',
    isNullable: false,
    isUnique: false,
    isIndexed: false,
    hasDefault: false,
  })),
  relations: [],
})

beforeEach(() => {
  clearTableCache()
})

describe('identifier mapping', () => {
  it('turns camelCase into snake_case and leaves the rest alone', () => {
    expect(toColumnName('publishedAt')).toBe('published_at')
    expect(toColumnName('id')).toBe('id')
    expect(toColumnName('authorId')).toBe('author_id')
    expect(toColumnName('already_snake')).toBe('already_snake')
  })
})

describe('table building', () => {
  it('maps every column type without losing one', () => {
    const all: TableDescriptor = {
      name: 'everything',
      primaryKey: 'id',
      columns: (
        [
          'uuid',
          'string',
          'text',
          'integer',
          'bigint',
          'number',
          'decimal',
          'boolean',
          'date',
          'timestamp',
          'json',
          'enum',
          'binary',
        ] as const
      ).map((type) => ({
        name: type === 'uuid' ? 'id' : type,
        type,
        isPrimary: type === 'uuid',
        isNullable: false,
        isUnique: false,
        isIndexed: false,
        hasDefault: false,
      })),
      relations: [],
    }

    expect(Object.keys(columnsOf(drizzleTable(all)))).toHaveLength(13)
  })

  it('addresses columns by their Assemora field name', () => {
    const table = drizzleTable(descriptor('posts', ['id', 'publishedAt']))

    expect(Object.keys(columnsOf(table))).toEqual(['id', 'publishedAt'])
  })

  it('returns the same table for the same descriptor', () => {
    const posts = descriptor('posts')

    expect(drizzleTable(posts)).toBe(drizzleTable(posts))
  })

  it('refuses two different descriptors that claim the same table', () => {
    drizzleTable(descriptor('posts', ['id']))

    // Keyed by name, the second call used to return the first table and its columns,
    // so a query silently addressed the wrong shape.
    expect(() => drizzleTable(descriptor('posts', ['id', 'title']))).toThrowError(
      'Two different descriptors both describe the table "posts"',
    )
  })
})
