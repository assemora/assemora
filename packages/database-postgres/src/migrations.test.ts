import type { TableDescriptor } from '@assemora/database'
import { describe, expect, it } from 'vitest'

import { createSchemaSql, createTableSql, dropSchemaSql } from './migrations.js'

const users: TableDescriptor = {
  name: 'users',
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
      name: 'email',
      type: 'string',
      isPrimary: false,
      isNullable: false,
      isUnique: true,
      isIndexed: false,
      hasDefault: false,
    },
    {
      name: 'createdAt',
      type: 'timestamp',
      isPrimary: false,
      isNullable: false,
      isUnique: false,
      isIndexed: true,
      hasDefault: true,
    },
  ],
  relations: [],
}

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
      name: 'authorId',
      type: 'uuid',
      isPrimary: false,
      isNullable: false,
      isUnique: false,
      isIndexed: false,
      hasDefault: false,
    },
    {
      name: 'status',
      type: 'enum',
      isPrimary: false,
      isNullable: false,
      isUnique: false,
      isIndexed: false,
      hasDefault: false,
      enumValues: ['draft', 'published'],
    },
    {
      name: 'body',
      type: 'text',
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
  relations: [
    { name: 'author', kind: 'belongsTo', target: 'users', foreignKey: 'authorId', ownerKey: 'id' },
  ],
}

describe('table DDL', () => {
  it('maps every column type and constraint', () => {
    expect(createTableSql(users)).toBe(
      [
        'create table if not exists "users" (',
        '  "id" uuid primary key,',
        '  "email" varchar(255) not null unique,',
        '  "created_at" timestamptz not null',
        ')',
      ].join('\n'),
    )
  })

  it('constrains an enum column to its declared values', () => {
    expect(createTableSql(posts)).toContain(
      `"status" text not null check ("status" in ('draft', 'published'))`,
    )
  })

  it('marks a nullable column as such', () => {
    expect(createTableSql(posts)).toContain('"body" text,')
  })

  it('uses jsonb for JSON columns', () => {
    expect(createTableSql(posts)).toContain('"metadata" jsonb not null')
  })
})

describe('schema DDL', () => {
  const statements = createSchemaSql([users, posts])

  it('creates every table before wiring foreign keys', () => {
    const firstConstraint = statements.findIndex((statement) =>
      statement.includes('add constraint'),
    )
    const lastTable = statements
      .map((statement) => statement.startsWith('create table'))
      .lastIndexOf(true)

    expect(lastTable).toBeLessThan(firstConstraint)
  })

  it('derives a foreign key from a belongsTo relation', () => {
    expect(statements).toContain(
      'alter table "posts" add constraint "posts_author_id_fkey" foreign key ("author_id") references "users" ("id") on delete cascade',
    )
  })

  it('indexes declared columns and every foreign key', () => {
    expect(statements).toContain(
      'create index if not exists "users_created_at_idx" on "users" ("created_at")',
    )
    expect(statements).toContain(
      'create index if not exists "posts_author_id_idx" on "posts" ("author_id")',
    )
  })

  it('drops in the reverse of nothing in particular, but cascades', () => {
    expect(dropSchemaSql([users, posts])).toEqual([
      'drop table if exists "users" cascade',
      'drop table if exists "posts" cascade',
    ])
  })
})

describe('identifier safety', () => {
  it('quotes identifiers and escapes literals', () => {
    const odd: TableDescriptor = {
      name: 'weird"table',
      primaryKey: 'id',
      columns: [
        {
          name: 'id',
          type: 'enum',
          isPrimary: false,
          isNullable: false,
          isUnique: false,
          isIndexed: false,
          hasDefault: false,
          enumValues: ["it's"],
        },
      ],
      relations: [],
    }

    const ddl = createTableSql(odd)

    expect(ddl).toContain('"weird""table"')
    expect(ddl).toContain("'it''s'")
  })
})
