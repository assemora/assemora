import {
  type ColumnDescriptor,
  diffSchema,
  mayFailOnExistingRows,
  type RelationDescriptor,
  type SchemaChange,
  type TableDescriptor,
} from '@assemora/database'
import { describe, expect, it } from 'vitest'

import { migrationSql } from './migration-sql.js'

const column = (
  name: string,
  type: ColumnDescriptor['type'],
  overrides: Partial<ColumnDescriptor> = {},
): ColumnDescriptor => ({
  name,
  type,
  isPrimary: false,
  isNullable: true,
  isUnique: false,
  isIndexed: false,
  hasDefault: false,
  ...overrides,
})

/**
 * The risk flags every change carries. `migrationSql` reads none of them — it works
 * the risk out from the descriptors — so a test states them once and moves on.
 */
const risk = { destructive: false, mayFailOnExistingRows: false } as const

const author: RelationDescriptor = {
  name: 'author',
  kind: 'belongsTo',
  target: 'users',
  foreignKey: 'authorId',
  ownerKey: 'id',
}

const posts: TableDescriptor = {
  name: 'posts',
  primaryKey: 'id',
  columns: [
    column('id', 'uuid', { isPrimary: true, isNullable: false, hasDefault: true }),
    column('authorId', 'uuid', { isNullable: false }),
    column('title', 'string', { isNullable: false, isIndexed: true }),
  ],
  relations: [author],
}

describe('a table that appears', () => {
  const { up, down, destructive } = migrationSql([
    { ...risk, kind: 'tableAdded', table: 'posts', after: posts },
  ])

  it('creates the table, then its indexes, then the keys that reference other tables', () => {
    expect(up).toEqual([
      [
        'create table "posts" (',
        '  "id" uuid primary key,',
        '  "author_id" uuid not null,',
        '  "title" varchar(255) not null',
        ')',
      ].join('\n'),
      'create index "posts_title_idx" on "posts" ("title")',
      'create index "posts_author_id_idx" on "posts" ("author_id")',
      'alter table "posts" add constraint "posts_author_id_fkey" foreign key ("author_id") references "users" ("id") on delete cascade',
    ])
  })

  it('says exactly what it does, so a schema it was not written for refuses it', () => {
    // `create table if not exists` is what `applySchema` bootstraps with. In a
    // migration it succeeds against a table somebody else built, the runner records
    // the migration as applied, and `db:rollback` then drops a table this migration
    // never created.
    expect(up.some((statement) => statement.includes('if not exists'))).toBe(false)
  })

  it('undoes itself by dropping the constraint before the table it sits on', () => {
    expect(down).toEqual([
      'alter table "posts" drop constraint "posts_author_id_fkey"',
      'drop index "posts_title_idx"',
      'drop index "posts_author_id_idx"',
      'drop table "posts"',
    ])
  })

  it('destroys nothing', () => {
    expect(destructive).toEqual([])
  })
})

describe('a table that disappears', () => {
  const { up, down, destructive } = migrationSql([
    { ...risk, kind: 'tableRemoved', table: 'posts', before: posts },
  ])

  it('takes its own foreign keys off first, so the drop needs no cascade', () => {
    // `cascade` would also drop constraints living on tables that survive, and the
    // diff says nothing about those — a relation that did not change produces no
    // change — so no `down` here could rebuild them. Without it PostgreSQL refuses
    // the drop and the person adds the missing change.
    expect(up).toEqual([
      'alter table "posts" drop constraint "posts_author_id_fkey"',
      'drop table "posts"',
    ])
  })

  it('rebuilds the table, its indexes and its keys, in that order', () => {
    expect(down[0]).toContain('create table "posts"')
    expect(down.slice(1)).toEqual([
      'create index "posts_title_idx" on "posts" ("title")',
      'create index "posts_author_id_idx" on "posts" ("author_id")',
      'alter table "posts" add constraint "posts_author_id_fkey" foreign key ("author_id") references "users" ("id") on delete cascade',
    ])
  })

  it('says that the rows are gone and that the reversal brings back an empty table', () => {
    expect(destructive).toEqual([
      'Dropping table "posts" destroys every row in it; the down migration recreates the table, but empty.',
    ])
  })
})

describe('a column that appears', () => {
  it('is added with the definition a fresh table would have given it', () => {
    const { up, down, destructive } = migrationSql([
      {
        ...risk,
        kind: 'columnAdded',
        table: 'posts',
        column: 'subtitle',
        after: column('subtitle', 'string'),
      },
    ])

    expect(up).toEqual(['alter table "posts" add column "subtitle" varchar(255)'])
    expect(down).toEqual(['alter table "posts" drop column "subtitle"'])
    expect(destructive).toEqual([])
  })

  it('carries its enum check with it', () => {
    const { up } = migrationSql([
      {
        ...risk,
        kind: 'columnAdded',
        table: 'posts',
        column: 'status',
        after: column('status', 'enum', { enumValues: ['draft', 'published'] }),
      },
    ])

    expect(up).toEqual([
      `alter table "posts" add column "status" text check ("status" in ('draft', 'published'))`,
    ])
  })

  it('creates the index the same column would have had on a fresh table', () => {
    // `columnSql` writes the key, the uniqueness and the check inline but never the
    // index — on a fresh table that is a statement of its own. Without one here the
    // same declaration is indexed on a new database and unindexed after a migration.
    const { up, down } = migrationSql([
      {
        ...risk,
        kind: 'columnAdded',
        table: 'posts',
        column: 'slug',
        after: column('slug', 'string', { isIndexed: true }),
      },
    ])

    expect(up).toEqual([
      'alter table "posts" add column "slug" varchar(255)',
      'create index "posts_slug_idx" on "posts" ("slug")',
    ])
    expect(down).toEqual(['drop index "posts_slug_idx"', 'alter table "posts" drop column "slug"'])
  })

  it('asks for no index a fresh table would not have built either', () => {
    const { up } = migrationSql([
      {
        ...risk,
        kind: 'columnAdded',
        table: 'posts',
        column: 'slug',
        after: column('slug', 'string', { isIndexed: true, isUnique: true }),
      },
    ])

    expect(up).toEqual(['alter table "posts" add column "slug" varchar(255) unique'])
  })

  it('refuses to be required, because existing rows would have no value for it', () => {
    const change: SchemaChange = {
      ...risk,
      kind: 'columnAdded',
      table: 'posts',
      column: 'slug',
      after: column('slug', 'string', { isNullable: false }),
    }

    expect(() => migrationSql([change])).toThrow(/"posts"\."slug" as not null/)
    expect(() => migrationSql([change])).toThrow(/backfill/)
  })

  it('is required without complaint when the table is created by the same migration', () => {
    const { up } = migrationSql([
      { ...risk, kind: 'tableAdded', table: 'posts', after: posts },
      {
        ...risk,
        kind: 'columnAdded',
        table: 'posts',
        column: 'slug',
        after: column('slug', 'string', { isNullable: false }),
      },
    ])

    expect(up.filter((statement) => statement.includes('add column'))).toEqual([])
  })
})

describe('a column that disappears', () => {
  it('comes back empty rather than pretending its data survived', () => {
    const { up, down, destructive } = migrationSql([
      {
        ...risk,
        kind: 'columnRemoved',
        table: 'posts',
        column: 'body',
        before: column('body', 'text'),
      },
    ])

    expect(up).toEqual(['alter table "posts" drop column "body"'])
    expect(down).toEqual(['alter table "posts" add column "body" text'])
    expect(destructive).toEqual([
      'Dropping "posts"."body" destroys its data; the down migration recreates the column, but empty.',
    ])
  })

  it('comes back with the index that went with it, and only after the column is there', () => {
    const { up, down } = migrationSql([
      {
        ...risk,
        kind: 'columnRemoved',
        table: 'posts',
        column: 'slug',
        before: column('slug', 'string', { isIndexed: true }),
      },
    ])

    // Dropping the column drops its index, so only the reversal has anything to say.
    expect(up).toEqual(['alter table "posts" drop column "slug"'])
    expect(down).toEqual([
      'alter table "posts" add column "slug" varchar(255)',
      'create index "posts_slug_idx" on "posts" ("slug")',
    ])
  })

  it('admits that a required column cannot even be recreated while rows exist', () => {
    const { destructive } = migrationSql([
      {
        ...risk,
        kind: 'columnRemoved',
        table: 'posts',
        column: 'slug',
        before: column('slug', 'string', { isNullable: false }),
      },
    ])

    expect(destructive).toEqual([
      'Dropping "posts"."slug" destroys its data; the down migration recreates the column, but empty, and cannot run while the table holds rows because the column is not null.',
    ])
  })
})

describe('a column that changes type', () => {
  const change = (
    from: ColumnDescriptor['type'],
    to: ColumnDescriptor['type'],
    overrides: {
      readonly before?: Partial<ColumnDescriptor>
      readonly after?: Partial<ColumnDescriptor>
    } = {},
  ): SchemaChange => ({
    ...risk,
    kind: 'columnTypeChanged',
    table: 'posts',
    column: 'views',
    before: column('views', from, overrides.before ?? {}),
    after: column('views', to, overrides.after ?? {}),
  })

  it('widens without a using clause, because no value can change', () => {
    const { up } = migrationSql([change('integer', 'bigint')])

    expect(up).toEqual(['alter table "posts" alter column "views" type bigint'])
  })

  it('spells out every narrowing conversion', () => {
    const { up } = migrationSql([change('bigint', 'integer')])

    expect(up).toEqual([
      'alter table "posts" alter column "views" type integer using "views"::integer',
    ])
  })

  it('reverses a widening with the narrowing that undoes it', () => {
    const { down } = migrationSql([change('integer', 'bigint')])

    expect(down).toEqual([
      'alter table "posts" alter column "views" type integer using "views"::integer',
    ])
  })

  it('does not call bigint to double precision a widening, because past 2^53 it is not', () => {
    // Verified against PostgreSQL: 9007199254740993 is stored back as
    // 9007199254740992, and 123456789012345678 as 123456789012346000, with no error.
    const { up, destructive } = migrationSql([change('bigint', 'number')])

    expect(up).toEqual([
      'alter table "posts" alter column "views" type double precision using "views"::double precision',
    ])
    expect(destructive).toEqual([
      'Changing "posts"."views" from bigint to double precision rewrites the stored data — a whole number past 2^53 becomes the nearest double precision value — and the down migration cannot bring it back.',
    ])
  })

  it('still widens an integer into every number that contains one', () => {
    expect(migrationSql([change('integer', 'number')]).up).toEqual([
      'alter table "posts" alter column "views" type double precision',
    ])
    expect(migrationSql([change('integer', 'decimal')]).up).toEqual([
      'alter table "posts" alter column "views" type numeric',
    ])
    expect(migrationSql([change('bigint', 'decimal')]).up).toEqual([
      'alter table "posts" alter column "views" type numeric',
    ])
  })

  it('leaves a shrinking text column to the assignment cast, so long values are rejected rather than cut', () => {
    const { up, destructive } = migrationSql([change('text', 'string')])

    expect(up).toEqual(['alter table "posts" alter column "views" type varchar(255)'])
    expect(destructive).toEqual([])
  })

  it('never casts explicitly to varchar, from any type, because that truncates in silence', () => {
    // An explicit `::varchar(255)` cut a 412-character JSON document to 255 against
    // PostgreSQL 14.18 without an error. Casting to `text` and letting the assignment
    // do the length check raises "value too long" instead.
    for (const from of ['json', 'decimal', 'uuid', 'timestamp'] as const) {
      const { up } = migrationSql([change(from, 'string')])

      expect(up).toEqual([
        'alter table "posts" alter column "views" type varchar(255) using "views"::text',
      ])
    }
  })

  it('writes the check constraint when a column becomes an enum, and drops it when it stops', () => {
    // `enum` and `text` are one SQL type, so the constraint is the whole change. The
    // diff reports this as a type change — `columnEnumChanged` needs an enum on both
    // sides — so if it is not written here, `db:migrate` reports success and the old
    // values stay enforced against a column declared free-form.
    const enumValues = ['draft', 'published']
    const check = `check ("views" in ('draft', 'published'))`

    const becomes = migrationSql([change('text', 'enum', { after: { enumValues } })])

    expect(becomes.up).toEqual([`alter table "posts" add constraint "posts_views_check" ${check}`])
    expect(becomes.down).toEqual(['alter table "posts" drop constraint "posts_views_check"'])

    const stops = migrationSql([change('enum', 'text', { before: { enumValues } })])

    expect(stops.up).toEqual(['alter table "posts" drop constraint "posts_views_check"'])
    expect(stops.down).toEqual([`alter table "posts" add constraint "posts_views_check" ${check}`])
  })

  it('changes the type and the check together, in an order either one survives', () => {
    const { up, down } = migrationSql([
      change('string', 'enum', { after: { enumValues: ['draft'] } }),
    ])

    expect(up).toEqual([
      'alter table "posts" alter column "views" type text',
      `alter table "posts" add constraint "posts_views_check" check ("views" in ('draft'))`,
    ])
    expect(down).toEqual([
      'alter table "posts" drop constraint "posts_views_check"',
      'alter table "posts" alter column "views" type varchar(255)',
    ])
  })

  it('converts through text in both directions', () => {
    const { up, down } = migrationSql([change('uuid', 'text')])

    expect(up).toEqual(['alter table "posts" alter column "views" type text using "views"::text'])
    expect(down).toEqual(['alter table "posts" alter column "views" type uuid using "views"::uuid'])
  })

  it('warns when the conversion rewrites values that already fit', () => {
    expect(migrationSql([change('number', 'integer')]).destructive).toEqual([
      'Changing "posts"."views" from double precision to integer rewrites the stored data — every value is rounded to a whole number — and the down migration cannot bring it back.',
    ])
    expect(migrationSql([change('timestamp', 'date')]).destructive).toEqual([
      'Changing "posts"."views" from timestamptz to date rewrites the stored data — the time of day is discarded — and the down migration cannot bring it back.',
    ])
    expect(migrationSql([change('integer', 'boolean')]).destructive).toEqual([
      'Changing "posts"."views" from integer to boolean rewrites the stored data — only whether a value was zero survives — and the down migration cannot bring it back.',
    ])
  })

  it('refuses a conversion PostgreSQL cannot make, naming the table and the column', () => {
    expect(() => migrationSql([change('binary', 'integer')])).toThrow(
      /Cannot change "posts"\."views" from bytea to integer/,
    )
    expect(() => migrationSql([change('timestamp', 'integer')])).toThrow(/no cast between them/)
    expect(() => migrationSql([change('boolean', 'bigint')])).toThrow(/no cast between them/)
  })

  it('reports the table and the column as details, so a CLI can point at them', () => {
    try {
      migrationSql([change('json', 'boolean')])
      expect.unreachable('the cast should have been refused')
    } catch (error) {
      expect(error).toMatchObject({
        code: 'UNSUPPORTED_MIGRATION',
        details: { table: 'posts', column: 'views' },
      })
    }
  })
})

describe('a column that changes its constraints', () => {
  it('sets and drops not null', () => {
    const { up, down } = migrationSql([
      {
        ...risk,
        kind: 'columnNullabilityChanged',
        table: 'posts',
        column: 'title',
        before: column('title', 'string'),
        after: column('title', 'string', { isNullable: false }),
      },
    ])

    expect(up).toEqual(['alter table "posts" alter column "title" set not null'])
    expect(down).toEqual(['alter table "posts" alter column "title" drop not null'])
  })

  it('names a unique constraint the way PostgreSQL named it when the table was created', () => {
    const { up, down } = migrationSql([
      {
        ...risk,
        kind: 'columnUniquenessChanged',
        table: 'posts',
        column: 'slug',
        before: column('slug', 'string'),
        after: column('slug', 'string', { isUnique: true }),
      },
    ])

    expect(up).toEqual(['alter table "posts" add constraint "posts_slug_key" unique ("slug")'])
    expect(down).toEqual(['alter table "posts" drop constraint "posts_slug_key"'])
  })

  it('replaces the check when the allowed values move', () => {
    const { up, down } = migrationSql([
      {
        ...risk,
        kind: 'columnEnumChanged',
        table: 'posts',
        column: 'status',
        before: column('status', 'enum', { enumValues: ['draft', 'published'] }),
        after: column('status', 'enum', { enumValues: ['draft', 'published', 'archived'] }),
        added: ['archived'],
        removed: [],
      },
    ])

    expect(up).toEqual([
      'alter table "posts" drop constraint "posts_status_check"',
      `alter table "posts" add constraint "posts_status_check" check ("status" in ('draft', 'published', 'archived'))`,
    ])
    expect(down).toEqual([
      'alter table "posts" drop constraint "posts_status_check"',
      `alter table "posts" add constraint "posts_status_check" check ("status" in ('draft', 'published'))`,
    ])
  })

  it('moves a primary key by dropping the old constraint first', () => {
    const { up, down } = migrationSql([
      { ...risk, kind: 'primaryKeyMoved', table: 'posts', before: 'id', after: 'slug' },
    ])

    expect(up).toEqual([
      'alter table "posts" drop constraint "posts_pkey"',
      'alter table "posts" add constraint "posts_pkey" primary key ("slug")',
    ])
    expect(down).toEqual([
      'alter table "posts" drop constraint "posts_pkey"',
      'alter table "posts" add constraint "posts_pkey" primary key ("id")',
    ])
  })
})

describe('indexes and foreign keys on their own', () => {
  it('creates and drops an index under the name the schema builder uses', () => {
    const added = migrationSql([
      {
        ...risk,
        kind: 'indexAdded',
        table: 'posts',
        column: 'publishedAt',
        after: column('publishedAt', 'timestamp', { isIndexed: true }),
      },
    ])

    expect(added.up).toEqual(['create index "posts_published_at_idx" on "posts" ("published_at")'])
    expect(added.down).toEqual(['drop index "posts_published_at_idx"'])

    const removed = migrationSql([
      {
        ...risk,
        kind: 'indexRemoved',
        table: 'posts',
        column: 'publishedAt',
        before: column('publishedAt', 'timestamp'),
      },
    ])

    expect(removed.up).toEqual(added.down)
    expect(removed.down).toEqual(added.up)
  })

  it('adds and drops a foreign key under the name the schema builder uses', () => {
    const added = migrationSql([
      { ...risk, kind: 'foreignKeyAdded', table: 'posts', column: 'authorId', after: author },
    ])

    expect(added.up).toEqual([
      'alter table "posts" add constraint "posts_author_id_fkey" foreign key ("author_id") references "users" ("id") on delete cascade',
    ])
    expect(added.down).toEqual(['alter table "posts" drop constraint "posts_author_id_fkey"'])

    const removed = migrationSql([
      { ...risk, kind: 'foreignKeyRemoved', table: 'posts', column: 'authorId', before: author },
    ])

    expect(removed.up).toEqual(added.down)
    expect(removed.down).toEqual(added.up)
  })
})

/**
 * The inputs below come from `diffSchema` rather than being written out by hand, so
 * every statement asserted here is one `db:generate` can actually produce. A diff
 * nobody can reach proves nothing about the order statements apply in.
 */
describe('the order a mixed migration applies in', () => {
  const id = column('id', 'uuid', { isPrimary: true, isNullable: false, hasDefault: true })

  const before: readonly TableDescriptor[] = [
    {
      name: 'comments',
      primaryKey: 'id',
      columns: [
        id,
        column('legacyAuthor', 'string', { isIndexed: true }),
        column('createdAt', 'timestamp'),
      ],
      relations: [],
    },
  ]

  const after: readonly TableDescriptor[] = [
    {
      name: 'comments',
      primaryKey: 'id',
      columns: [
        id,
        column('authorId', 'uuid'),
        column('createdAt', 'timestamp', { isIndexed: true }),
      ],
      relations: [author],
    },
    { name: 'users', primaryKey: 'id', columns: [id], relations: [] },
  ]

  const { up, down } = migrationSql(diffSchema(before, after).changes)

  it('drops what depends on a column before the column, and creates before it references', () => {
    expect(up).toEqual([
      'alter table "comments" drop column "legacy_author"',
      'create table "users" (\n  "id" uuid primary key\n)',
      'alter table "comments" add column "author_id" uuid',
      'create index "comments_created_at_idx" on "comments" ("created_at")',
      'alter table "comments" add constraint "comments_author_id_fkey" foreign key ("author_id") references "users" ("id") on delete cascade',
    ])
  })

  it('undoes it as a migration in its own right: constraints off first, structure back before what sits on it', () => {
    expect(down).toEqual([
      'alter table "comments" drop constraint "comments_author_id_fkey"',
      'drop index "comments_created_at_idx"',
      'alter table "comments" drop column "author_id"',
      'drop table "users"',
      'alter table "comments" add column "legacy_author" varchar(255)',
      'create index "comments_legacy_author_idx" on "comments" ("legacy_author")',
    ])
  })

  it('never adds a constraint after dropping the table it would reference', () => {
    const dropped = down.findIndex((statement) => statement.startsWith('drop table'))
    const restored = down.findIndex((statement) => statement.includes('add constraint'))

    // A restored foreign key existed before the migration, so its target table did
    // too, and a table this `down` drops is one the `up` created. The two can never
    // be the same table — but a `down` that added constraints after dropping tables
    // would be one edit away from proving otherwise.
    expect(restored).toBe(-1)
    expect(dropped).toBeGreaterThan(-1)
  })
})

describe('a table that disappears with the relation that pointed at it', () => {
  const id = column('id', 'uuid', { isPrimary: true, isNullable: false, hasDefault: true })

  const before: readonly TableDescriptor[] = [
    {
      name: 'comments',
      primaryKey: 'id',
      columns: [id, column('postId', 'uuid')],
      relations: [
        { name: 'post', kind: 'belongsTo', target: 'posts', foreignKey: 'postId', ownerKey: 'id' },
      ],
    },
    { name: 'posts', primaryKey: 'id', columns: [id], relations: [] },
  ]

  const after: readonly TableDescriptor[] = [
    { name: 'comments', primaryKey: 'id', columns: [id], relations: [] },
  ]

  const { up, down } = migrationSql(diffSchema(before, after).changes)

  it('takes the constraint off the surviving table before the table it points at goes', () => {
    // This is what `cascade` was hiding. With the constraint dropped by name the
    // plain `drop table` succeeds, and a constraint the diff *did not* mention — one
    // on a table that survives — refuses the drop instead of vanishing unrecorded.
    expect(up).toEqual([
      'alter table "comments" drop constraint "comments_post_id_fkey"',
      'alter table "comments" drop column "post_id"',
      'drop table "posts"',
    ])
  })

  it('puts all three back, each after the thing it needs', () => {
    expect(down).toEqual([
      'create table "posts" (\n  "id" uuid primary key\n)',
      'alter table "comments" add column "post_id" uuid',
      'alter table "comments" add constraint "comments_post_id_fkey" foreign key ("post_id") references "posts" ("id") on delete cascade',
    ])
  })
})

describe('a primary key that moves off a column the same migration drops', () => {
  const before: readonly TableDescriptor[] = [
    {
      name: 'posts',
      primaryKey: 'slug',
      columns: [
        column('id', 'uuid', { isNullable: false }),
        column('slug', 'string', { isPrimary: true, isNullable: false }),
      ],
      relations: [],
    },
  ]

  const after: readonly TableDescriptor[] = [
    {
      name: 'posts',
      primaryKey: 'id',
      columns: [column('id', 'uuid', { isPrimary: true, isNullable: false })],
      relations: [],
    },
  ]

  const { up, down } = migrationSql(diffSchema(before, after).changes)

  it('takes the key off before the column under it goes, and puts the new one on after', () => {
    // Dropping the column first drops "posts_pkey" with it, and the `drop constraint`
    // that follows then fails with "constraint does not exist".
    expect(up).toEqual([
      'alter table "posts" drop constraint "posts_pkey"',
      'alter table "posts" drop column "slug"',
      'alter table "posts" add constraint "posts_pkey" primary key ("id")',
    ])
  })

  it('re-adds the column before it claims the key back, and never inline', () => {
    expect(down).toEqual([
      'alter table "posts" drop constraint "posts_pkey"',
      'alter table "posts" add column "slug" varchar(255) not null',
      'alter table "posts" add constraint "posts_pkey" primary key ("slug")',
    ])
  })
})

describe('what the diff calls risky and what this refuses', () => {
  it('agrees that a required column with a model default has nothing to put in existing rows', () => {
    // A model default is applied by the data layer on insert and never reaches the
    // DDL (ADR-0011), so `add column ... not null` meets the existing rows with
    // nothing. `describeChange` saying "adds column posts.active" while `migrationSql`
    // throws is the CLI promising something it cannot do.
    const columns = [column('id', 'uuid', { isPrimary: true, isNullable: false })]
    const before: readonly TableDescriptor[] = [
      { name: 'posts', primaryKey: 'id', columns, relations: [] },
    ]
    const after: readonly TableDescriptor[] = [
      {
        name: 'posts',
        primaryKey: 'id',
        columns: [...columns, column('active', 'boolean', { isNullable: false, hasDefault: true })],
        relations: [],
      },
    ]

    const diff = diffSchema(before, after)

    expect(mayFailOnExistingRows(diff)).toBe(true)
    expect(() => migrationSql(diff.changes)).toThrow(/"posts"\."active" as not null/)
  })

  it('generates the same column without complaint once it is optional', () => {
    const columns = [column('id', 'uuid', { isPrimary: true, isNullable: false })]
    const before: readonly TableDescriptor[] = [
      { name: 'posts', primaryKey: 'id', columns, relations: [] },
    ]
    const after: readonly TableDescriptor[] = [
      {
        name: 'posts',
        primaryKey: 'id',
        columns: [...columns, column('active', 'boolean', { hasDefault: true })],
        relations: [],
      },
    ]

    const diff = diffSchema(before, after)

    expect(mayFailOnExistingRows(diff)).toBe(false)
    expect(migrationSql(diff.changes).up).toEqual([
      'alter table "posts" add column "active" boolean',
    ])
  })
})

describe('a diff that repeats itself', () => {
  it('states each statement once, so a constraint is not added twice', () => {
    const repeated: SchemaChange = {
      ...risk,
      kind: 'indexAdded',
      table: 'comments',
      column: 'createdAt',
      after: column('createdAt', 'timestamp', { isIndexed: true }),
    }
    const { up, down } = migrationSql([repeated, repeated])

    expect(up).toHaveLength(1)
    expect(down).toHaveLength(1)
  })
})

describe('identifiers a diff did not choose', () => {
  it('quotes names and escapes literals rather than trusting them', () => {
    const { up } = migrationSql([
      {
        ...risk,
        kind: 'columnAdded',
        table: 'weird"table',
        column: 'kind',
        after: column('kind', 'enum', { enumValues: ["it's"] }),
      },
    ])

    expect(up).toEqual([
      `alter table "weird""table" add column "kind" text check ("kind" in ('it''s'))`,
    ])
  })
})

describe('nothing to do', () => {
  it('produces an empty migration', () => {
    expect(migrationSql([])).toEqual({ up: [], down: [], destructive: [] })
  })
})
