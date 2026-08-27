import type { ColumnDescriptor, TableDescriptor } from '@assemora/database'
import { describe, expect, it } from 'vitest'

import {
  columnSql,
  createIndexSql,
  createSchemaSql,
  createTableSql,
  dropIndexSql,
  dropSchemaSql,
  dropTableIndexSql,
  dropTableSql,
  tableIndexSql,
} from './migrations.js'

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
    // Named for the constraint rather than for the column: the column may carry an
    // index of its own, and neither reason may be able to drop the other's.
    expect(statements).toContain(
      'create index if not exists "posts_author_id_fkey_idx" on "posts" ("author_id")',
    )
  })

  it('builds the same indexes for a fresh database and for a migration', () => {
    // The two used to be assembled separately, and a migration that added a relation
    // forgot the foreign key's index entirely. One function answers for both now, so
    // they cannot drift apart again.
    expect(tableIndexSql(posts)).toEqual(
      statements.filter(
        (statement) => statement.startsWith('create index') && statement.includes('"posts"'),
      ),
    )
    expect(tableIndexSql(posts, 'migration')).toEqual([
      'create index "posts_author_id_fkey_idx" on "posts" ("author_id")',
    ])
    expect(dropTableIndexSql(posts, 'migration')).toEqual(['drop index "posts_author_id_fkey_idx"'])
  })

  it('drops in the reverse of nothing in particular, but cascades', () => {
    expect(dropSchemaSql([users, posts])).toEqual([
      'drop table if exists "users" cascade',
      'drop table if exists "posts" cascade',
    ])
  })
})

describe('who the statement is for', () => {
  it('bootstraps a database that may be half built', () => {
    expect(createTableSql(users, 'bootstrap')).toContain('create table if not exists "users"')
    expect(dropTableSql(users, 'bootstrap')).toBe('drop table if exists "users" cascade')
    expect(createIndexSql('users', 'createdAt', 'bootstrap')).toContain(
      'create index if not exists',
    )
    expect(dropIndexSql('users', 'createdAt', 'bootstrap')).toBe(
      'drop index if exists "users_created_at_idx"',
    )
  })

  it('states exactly what a migration does, so a schema it was not written for refuses it', () => {
    expect(createTableSql(users, 'migration')).toContain('create table "users"')
    expect(dropTableSql(users, 'migration')).toBe('drop table "users"')
    expect(createIndexSql('users', 'createdAt', 'migration')).toBe(
      'create index "users_created_at_idx" on "users" ("created_at")',
    )
    expect(dropIndexSql('users', 'createdAt', 'migration')).toBe(
      'drop index "users_created_at_idx"',
    )
  })

  it('writes the primary key inline in a create table and never in an add column', () => {
    // A migration that re-adds a primary column always carries the moved key as a
    // change of its own, so writing it inline as well would give the table two.
    const id: ColumnDescriptor = {
      name: 'id',
      type: 'uuid',
      isPrimary: true,
      isNullable: false,
      isUnique: false,
      isIndexed: false,
      hasDefault: true,
    }

    expect(columnSql(id, 'create-table')).toBe('"id" uuid primary key')
    expect(columnSql(id, 'add-column')).toBe('"id" uuid not null')
  })
})

describe('the join table behind a belongsToMany (SPEC.md §23, §24)', () => {
  const key: ColumnDescriptor = {
    name: 'id',
    type: 'uuid',
    isPrimary: true,
    isNullable: false,
    isUnique: false,
    isIndexed: false,
    hasDefault: true,
  }

  const students: TableDescriptor = {
    name: 'students',
    primaryKey: 'id',
    columns: [key],
    relations: [
      {
        name: 'courses',
        kind: 'belongsToMany',
        target: 'courses',
        foreignKey: 'studentId',
        ownerKey: 'id',
      },
    ],
  }

  const courses: TableDescriptor = {
    name: 'courses',
    primaryKey: 'id',
    columns: [key],
    relations: [
      {
        name: 'students',
        kind: 'belongsToMany',
        target: 'students',
        foreignKey: 'courseId',
        ownerKey: 'id',
      },
    ],
  }

  const statements = createSchemaSql([students, courses])

  it('creates a table no model declares, with the pair unique', () => {
    expect(statements).toContain(
      [
        'create table if not exists "courses_students" (',
        '  "course_id" uuid not null,',
        '  "student_id" uuid not null,',
        '  unique ("course_id", "student_id")',
        ')',
      ].join('\n'),
    )
  })

  it('creates one table for a relation both sides declare', () => {
    expect(statements.filter((statement) => statement.startsWith('create table'))).toHaveLength(3)
  })

  it('points both of its keys at the tables they link, and indexes them', () => {
    expect(statements).toContain(
      'alter table "courses_students" add constraint "courses_students_course_id_fkey" foreign key ("course_id") references "courses" ("id") on delete cascade',
    )
    expect(statements).toContain(
      'alter table "courses_students" add constraint "courses_students_student_id_fkey" foreign key ("student_id") references "students" ("id") on delete cascade',
    )
    // Without these, every load of `student.courses` and every cascading delete scans
    // the whole join table: PostgreSQL indexes the referenced side of a key, never the
    // referencing one.
    expect(statements).toContain(
      'create index if not exists "courses_students_course_id_fkey_idx" on "courses_students" ("course_id")',
    )
    expect(statements).toContain(
      'create index if not exists "courses_students_student_id_fkey_idx" on "courses_students" ("student_id")',
    )
  })

  it('drops what it created', () => {
    expect(dropSchemaSql([students, courses])).toEqual([
      'drop table if exists "students" cascade',
      'drop table if exists "courses" cascade',
      'drop table if exists "courses_students" cascade',
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
