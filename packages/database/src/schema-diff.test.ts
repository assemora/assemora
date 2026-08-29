import { describe, expect, it } from 'vitest'

import type { ColumnDescriptor, RelationDescriptor, TableDescriptor } from './adapter.js'
import {
  describeChange,
  diffSchema,
  isDestructive,
  mayFailOnExistingRows,
  type SchemaChange,
} from './schema-diff.js'

const column = (name: string, overrides: Partial<ColumnDescriptor> = {}): ColumnDescriptor => ({
  name,
  type: 'string',
  isPrimary: false,
  isNullable: false,
  isUnique: false,
  isIndexed: false,
  hasDefault: false,
  ...overrides,
})

const id = column('id', { type: 'uuid', isPrimary: true })

const table = (
  name: string,
  columns: readonly ColumnDescriptor[] = [id],
  overrides: Partial<Omit<TableDescriptor, 'name' | 'columns'>> = {},
): TableDescriptor => ({
  name,
  columns,
  primaryKey: 'id',
  relations: [],
  ...overrides,
})

const belongsTo = (
  name: string,
  target: string,
  overrides: Partial<RelationDescriptor> = {},
): RelationDescriptor => ({
  name,
  kind: 'belongsTo',
  target,
  foreignKey: `${name}Id`,
  ownerKey: 'id',
  ...overrides,
})

const kinds = (changes: readonly SchemaChange[]): string[] => changes.map((change) => change.kind)

const sentences = (changes: readonly SchemaChange[]): string[] => changes.map(describeChange)

describe('tables (SPEC.md §34)', () => {
  it('says nothing at all when the two schemas agree', () => {
    const schema = [table('articles', [id, column('title')])]

    expect(diffSchema(schema, schema).changes).toEqual([])
  })

  it('sees a table appear and a table go, and calls only the drop destructive', () => {
    const diff = diffSchema([table('drafts')], [table('articles')])

    expect(sentences(diff.changes)).toEqual(['creates table articles', 'drops table drafts'])
    expect(diff.changes.map((change) => change.destructive)).toEqual([false, true])
  })

  it('hands the whole descriptor over, so a generator writes up and down from it', () => {
    const articles = table('articles', [id, column('title')], {
      relations: [belongsTo('author', 'users')],
    })
    const [added] = diffSchema([], [articles]).changes
    const [removed] = diffSchema([articles], []).changes

    expect(added).toMatchObject({ kind: 'tableAdded', after: articles })
    expect(removed).toMatchObject({ kind: 'tableRemoved', before: articles })
  })

  it('lets a new table arrive whole rather than as a change per column', () => {
    const articles = table('articles', [id, column('slug', { isUnique: true, isIndexed: true })], {
      relations: [belongsTo('author', 'users')],
    })

    expect(kinds(diffSchema([], [articles]).changes)).toEqual(['tableAdded'])
  })

  it('refuses two descriptors that claim the same table name', () => {
    expect(() => diffSchema([], [table('articles'), table('articles')])).toThrow(
      'Two tables are both named "articles"',
    )
  })

  it('refuses two columns of one name on a table that appears on one side only', () => {
    // A table arriving or leaving whole never reaches the column comparison, and a
    // repeated name is most likely in a brand-new table — `create table` naming a
    // column twice is refused by PostgreSQL (42701) long after the diff was written.
    const columns = [id, column('title'), column('title', { type: 'text' })]

    expect(() => diffSchema([], [table('articles', columns)])).toThrow(
      'Two columns of "articles" are both named "title"',
    )
    expect(() => diffSchema([table('articles', columns)], [])).toThrow(
      'Two columns of "articles" are both named "title"',
    )
  })
})

describe('columns (SPEC.md §34)', () => {
  const before = table('articles', [id, column('subtitle', { isNullable: true })])

  it('sees a column appear and a column go', () => {
    const after = table('articles', [id, column('summary', { isNullable: true })])

    expect(sentences(diffSchema([before], [after]).changes)).toEqual([
      'adds column articles.summary',
      'drops column articles.subtitle',
    ])
  })

  it('calls dropping a column destructive and adding one safe', () => {
    const after = table('articles', [id])
    const diff = diffSchema([before], [after])

    expect(isDestructive(diff)).toBe(true)
    expect(isDestructive(diffSchema([after], [before]))).toBe(false)
  })

  it('carries the descriptor of a dropped column so the down migration can rebuild it', () => {
    const [change] = diffSchema([before], [table('articles', [id])]).changes

    expect(change).toMatchObject({
      kind: 'columnRemoved',
      column: 'subtitle',
      before: { name: 'subtitle', type: 'string', isNullable: true },
    })
  })

  it('warns that a required column has nothing to put in existing rows', () => {
    const after = table('articles', [id, column('subtitle', { isNullable: true }), column('slug')])
    const diff = diffSchema([before], [after])

    expect(mayFailOnExistingRows(diff)).toBe(true)
    expect(isDestructive(diff)).toBe(false)
    expect(sentences(diff.changes)).toEqual([
      'adds required column articles.slug with no database default',
    ])
  })

  it('warns about a required column that declares a default, which the DDL never carries', () => {
    // ADR-0011: a model default is applied by the data layer on insert and never
    // reaches the schema, so `add column ... not null` still meets rows with nothing
    // to put in them. `status: enumOf(...).default('draft')` is exactly this column.
    const after = table('articles', [
      id,
      column('subtitle', { isNullable: true }),
      column('slug', { hasDefault: true }),
    ])
    const diff = diffSchema([before], [after])

    expect(mayFailOnExistingRows(diff)).toBe(true)
    expect(sentences(diff.changes)).toEqual([
      'adds required column articles.slug with no database default',
    ])
  })

  it('leaves an optional column alone, whether or not it declares a default', () => {
    const after = table('articles', [
      id,
      column('subtitle', { isNullable: true }),
      column('summary', { isNullable: true, hasDefault: true }),
    ])

    expect(mayFailOnExistingRows(diffSchema([before], [after]))).toBe(false)
  })

  it('ignores a default that appears on an existing column, which produces no DDL', () => {
    const after = table('articles', [
      id,
      column('subtitle', { isNullable: true, hasDefault: true }),
    ])

    expect(diffSchema([before], [after]).changes).toEqual([])
  })

  it('ignores soft deletion moving, because the column itself is compared already', () => {
    const withSoftDeletes = table('articles', before.columns, { softDeleteColumn: 'deletedAt' })

    expect(diffSchema([before], [withSoftDeletes]).changes).toEqual([])
  })
})

describe('column types (SPEC.md §34)', () => {
  const withType = (type: ColumnDescriptor['type']) =>
    table('articles', [id, column('body', { type })])

  it('carries both descriptors, so a generator can cast in either direction', () => {
    const diff = diffSchema([withType('string')], [withType('text')])

    expect(diff.changes[0]).toMatchObject({
      kind: 'columnTypeChanged',
      before: { type: 'string' },
      after: { type: 'text' },
    })
    expect(sentences(diff.changes)).toEqual(['changes articles.body from string to text'])
  })

  it('lets a widening through without either warning', () => {
    const widenings: [ColumnDescriptor['type'], ColumnDescriptor['type']][] = [
      ['string', 'text'],
      ['uuid', 'text'],
      ['integer', 'bigint'],
      ['integer', 'decimal'],
      ['number', 'decimal'],
      ['date', 'timestamp'],
      ['enum', 'text'],
    ]

    for (const [from, to] of widenings) {
      const diff = diffSchema([withType(from)], [withType(to)])

      expect(isDestructive(diff)).toBe(false)
      expect(mayFailOnExistingRows(diff)).toBe(false)
    }
  })

  it('calls every narrowing destructive, in both the obvious and the unclassified case', () => {
    const narrowings: [ColumnDescriptor['type'], ColumnDescriptor['type']][] = [
      ['text', 'string'],
      ['bigint', 'integer'],
      ['timestamp', 'date'],
      ['text', 'enum'],
      ['json', 'text'],
      ['boolean', 'integer'],
    ]

    for (const [from, to] of narrowings) {
      expect(isDestructive(diffSchema([withType(from)], [withType(to)]))).toBe(true)
    }
  })

  it('warns that a narrowing may be refused, because a row that does not fit decides', () => {
    // `text -> string` and `text -> enum` lose nothing in PostgreSQL: the assignment
    // cast raises "value too long" and the check constraint is refused (23514), both
    // leaving the data where it was. Saying nothing about that is the answer to the
    // wrong question — the person has to clean the rows up before the migration runs.
    const refused: [ColumnDescriptor['type'], ColumnDescriptor['type']][] = [
      ['text', 'string'],
      ['text', 'enum'],
      ['bigint', 'integer'],
    ]

    for (const [from, to] of refused) {
      expect(mayFailOnExistingRows(diffSchema([withType(from)], [withType(to)]))).toBe(true)
    }
  })

  it('raises only the destructive warning where the conversion rewrites every value', () => {
    // Nothing is refused here: every row converts, and what it held is gone. The
    // second warning would send somebody looking for rows to fix that do not exist.
    const rewritten: [ColumnDescriptor['type'], ColumnDescriptor['type']][] = [
      ['timestamp', 'date'],
      ['decimal', 'integer'],
      ['decimal', 'number'],
      ['number', 'bigint'],
      ['integer', 'boolean'],
    ]

    for (const [from, to] of rewritten) {
      const diff = diffSchema([withType(from)], [withType(to)])

      expect(isDestructive(diff)).toBe(true)
      expect(mayFailOnExistingRows(diff)).toBe(false)
    }
  })
})

describe('column constraints (SPEC.md §34)', () => {
  const articles = (overrides: Partial<ColumnDescriptor>) =>
    table('articles', [id, column('slug', overrides)])

  it('sees a column become optional, and loses nothing doing it', () => {
    const diff = diffSchema([articles({})], [articles({ isNullable: true })])

    expect(sentences(diff.changes)).toEqual(['makes articles.slug optional'])
    expect(isDestructive(diff)).toBe(false)
    expect(mayFailOnExistingRows(diff)).toBe(false)
  })

  it('sees a column become required, which the rows already stored may refuse', () => {
    const diff = diffSchema([articles({ isNullable: true })], [articles({})])

    expect(sentences(diff.changes)).toEqual(['makes articles.slug required'])
    expect(mayFailOnExistingRows(diff)).toBe(true)
  })

  it('sees unique arrive and unique go, and warns only about arriving', () => {
    const gained = diffSchema([articles({})], [articles({ isUnique: true })])
    const lost = diffSchema([articles({ isUnique: true })], [articles({})])

    expect(sentences(gained.changes)).toEqual(['makes articles.slug unique'])
    expect(mayFailOnExistingRows(gained)).toBe(true)
    expect(sentences(lost.changes)).toEqual(['drops the unique constraint on articles.slug'])
    expect(mayFailOnExistingRows(lost)).toBe(false)
  })

  it('sees an index arrive and an index go', () => {
    const added = diffSchema([articles({})], [articles({ isIndexed: true })])
    const removed = diffSchema([articles({ isIndexed: true })], [articles({})])

    expect(sentences(added.changes)).toEqual(['indexes articles.slug'])
    expect(sentences(removed.changes)).toEqual(['drops the index on articles.slug'])
    expect(isDestructive(removed)).toBe(false)
  })

  it('reports every constraint that moved at once, not just the first', () => {
    const diff = diffSchema(
      [articles({ isNullable: true })],
      [articles({ type: 'text', isUnique: true, isIndexed: true })],
    )

    expect(kinds(diff.changes)).toEqual([
      'columnTypeChanged',
      'columnNullabilityChanged',
      'columnUniquenessChanged',
      'indexAdded',
    ])
  })
})

describe('enum values (SPEC.md §34)', () => {
  const status = (values: readonly string[]) =>
    table('articles', [id, column('status', { type: 'enum', enumValues: values })])

  it('names the values that arrived and the values that went', () => {
    const diff = diffSchema([status(['draft', 'archived'])], [status(['draft', 'review'])])

    expect(diff.changes[0]).toMatchObject({
      kind: 'columnEnumChanged',
      added: ['review'],
      removed: ['archived'],
    })
    expect(sentences(diff.changes)).toEqual([
      'adds "review" and removes "archived" on articles.status',
    ])
  })

  it('warns only when a value goes, because a stored row may be holding it', () => {
    const wider = diffSchema([status(['draft'])], [status(['draft', 'review'])])
    const narrower = diffSchema([status(['draft', 'review'])], [status(['draft'])])

    expect(mayFailOnExistingRows(wider)).toBe(false)
    expect(sentences(wider.changes)).toEqual(['adds "review" on articles.status'])
    expect(mayFailOnExistingRows(narrower)).toBe(true)
    expect(sentences(narrower.changes)).toEqual(['removes "review" on articles.status'])
  })

  it('warns when a column that constrained nothing gains a set of values', () => {
    // An enum column with no declared values carries no check constraint, so its rows
    // may hold anything. Adding one is refused by PostgreSQL (23514) exactly as
    // removing a value is, even though the set only grew.
    const unconstrained = table('articles', [id, column('status', { type: 'enum' })])
    const diff = diffSchema([unconstrained], [status(['draft', 'published'])])

    expect(sentences(diff.changes)).toEqual(['adds "draft", "published" on articles.status'])
    expect(mayFailOnExistingRows(diff)).toBe(true)
  })

  it('does not warn when the values go and the column stops constraining anything', () => {
    // The mirror case: dropping the check constraint cannot be refused by any row.
    const unconstrained = table('articles', [id, column('status', { type: 'enum' })])
    const diff = diffSchema([status(['draft'])], [unconstrained])

    expect(sentences(diff.changes)).toEqual(['removes "draft" on articles.status'])
    expect(mayFailOnExistingRows(diff)).toBe(false)
  })

  it('does not call a reordered set of values a change', () => {
    expect(
      diffSchema([status(['draft', 'review'])], [status(['review', 'draft'])]).changes,
    ).toEqual([])
  })

  it('reports becoming an enum as a type change, with the values in the descriptor', () => {
    const before = table('articles', [id, column('status', { type: 'text' })])
    const diff = diffSchema([before], [status(['draft'])])

    expect(kinds(diff.changes)).toEqual(['columnTypeChanged'])
    expect(diff.changes[0]).toMatchObject({ after: { enumValues: ['draft'] } })
  })
})

describe('primary keys (SPEC.md §34)', () => {
  it('sees the key move, and knows the rows already stored may not accept it', () => {
    const before = table('articles', [id, column('slug')])
    const after = table('articles', [column('id', { type: 'uuid' }), column('slug')], {
      primaryKey: 'slug',
    })
    const diff = diffSchema([before], [after])

    expect(sentences(diff.changes)).toEqual(['moves the primary key of articles from id to slug'])
    expect(mayFailOnExistingRows(diff)).toBe(true)
    expect(isDestructive(diff)).toBe(false)
  })

  it('reports the move once, from the one field that states where the key is', () => {
    const before = table('articles', [id, column('slug')])
    const after = table(
      'articles',
      [column('id', { type: 'uuid' }), column('slug', { isPrimary: true })],
      { primaryKey: 'slug' },
    )

    expect(kinds(diffSchema([before], [after]).changes)).toEqual(['primaryKeyMoved'])
  })
})

describe('foreign keys (SPEC.md §34)', () => {
  const articles = (relations: readonly RelationDescriptor[]) =>
    table('articles', [id, column('authorId', { type: 'uuid' })], { relations })

  it('sees a key arrive and a key go', () => {
    const added = diffSchema([articles([])], [articles([belongsTo('author', 'users')])])
    const removed = diffSchema([articles([belongsTo('author', 'users')])], [articles([])])

    expect(sentences(added.changes)).toEqual([
      'adds a foreign key from articles.authorId to users.id',
    ])
    expect(mayFailOnExistingRows(added)).toBe(true)
    expect(sentences(removed.changes)).toEqual([
      'drops the foreign key from articles.authorId to users.id',
    ])
    expect(mayFailOnExistingRows(removed)).toBe(false)
  })

  it('identifies a key by what it constrains, so renaming the relation writes no SQL', () => {
    const before = articles([belongsTo('author', 'users', { foreignKey: 'authorId' })])
    const after = articles([belongsTo('writer', 'users', { foreignKey: 'authorId' })])

    expect(diffSchema([before], [after]).changes).toEqual([])
  })

  it('reports a retargeted key as the old one going and a new one arriving', () => {
    const before = articles([belongsTo('author', 'users', { foreignKey: 'authorId' })])
    const after = articles([belongsTo('author', 'people', { foreignKey: 'authorId' })])

    expect(sentences(diffSchema([before], [after]).changes)).toEqual([
      'drops the foreign key from articles.authorId to users.id',
      'adds a foreign key from articles.authorId to people.id',
    ])
  })

  it('ignores a relation that stores no key on this table', () => {
    const posts: RelationDescriptor = {
      name: 'posts',
      kind: 'hasMany',
      target: 'posts',
      foreignKey: 'articleId',
      ownerKey: 'id',
    }

    expect(diffSchema([articles([])], [articles([posts])]).changes).toEqual([])
  })
})

describe('what a descriptor has to carry (SPEC.md §34)', () => {
  it('sees a foreign key and an enum arrive when one side simply does not carry them', () => {
    // Why an introspected schema is not a valid `before`: `introspect()` reports
    // `relations: []` and maps an enum column back to the `text` it is stored as, so
    // diffing a live database against the model registry would add every foreign key
    // and re-enum every status column, on every run, forever. A diff is taken against
    // the generated snapshot rather than the database (ADR-0021), and this is the
    // shape of the noise that decision avoids.
    const introspected = table('articles', [id, column('status', { type: 'text' })])
    const declared = table(
      'articles',
      [id, column('status', { type: 'enum', enumValues: ['draft'] })],
      { relations: [belongsTo('author', 'users')] },
    )

    expect(sentences(diffSchema([introspected], [declared]).changes)).toEqual([
      'changes articles.status from text to enum',
      'adds a foreign key from articles.authorId to users.id',
    ])
  })
})

describe('the order changes come back in (SPEC.md §34)', () => {
  it('releases constraints first, creates before it references, and drops last', () => {
    const before = [
      table('articles', [id, column('subtitle'), column('legacyId', { isIndexed: true })], {
        relations: [belongsTo('editor', 'editors')],
      }),
      table('editors'),
    ]
    const after = [
      table('articles', [id, column('legacyId'), column('authorId', { type: 'uuid' })], {
        relations: [belongsTo('author', 'users')],
      }),
      table('users'),
    ]

    expect(kinds(diffSchema(before, after).changes)).toEqual([
      'foreignKeyRemoved',
      'indexRemoved',
      'tableAdded',
      'columnAdded',
      'foreignKeyAdded',
      'columnRemoved',
      'tableRemoved',
    ])
  })

  it('orders two changes of one kind by table name, whatever order the registry is in', () => {
    // Two changes of the same kind is the only case that exercises the name sort: a
    // diff whose changes all rank differently is ordered by rank alone, and would
    // stay ordered with the name sort gone.
    const before = [table('users'), table('articles')]
    const after = [table('users'), table('articles'), table('tags'), table('media')]
    const diff = diffSchema(before, after)

    expect(kinds(diff.changes)).toEqual(['tableAdded', 'tableAdded'])
    expect(diff.changes.map((change) => change.table)).toEqual(['media', 'tags'])
    expect(diffSchema([...before].reverse(), [...after].reverse())).toEqual(diff)
  })

  it('orders the columns of one table by name, not by the order they were declared', () => {
    const before = [table('articles', [id])]
    const declared = [column('title', { isNullable: true }), column('body', { isNullable: true })]
    const diff = diffSchema(before, [table('articles', [id, ...declared])])

    expect(sentences(diff.changes)).toEqual([
      'adds column articles.body',
      'adds column articles.title',
    ])
    expect(diffSchema(before, [table('articles', [id, ...[...declared].reverse()])])).toEqual(diff)
  })
})

describe('warning a person (SPEC.md §34)', () => {
  it('answers both risk questions over the whole diff', () => {
    const safe = diffSchema([table('articles')], [table('articles'), table('tags')])

    expect(isDestructive(safe)).toBe(false)
    expect(mayFailOnExistingRows(safe)).toBe(false)
  })

  it('gives every kind of change words, in the order the migration applies them', () => {
    const columns = (overrides: Record<string, Partial<ColumnDescriptor>>) => [
      column('id', { type: 'uuid', ...overrides.id }),
      column('slug', overrides.slug ?? {}),
      column('body', overrides.body ?? {}),
      column('status', { type: 'enum', ...overrides.status }),
      column('legacyId', overrides.legacyId ?? {}),
      column('editorId', { type: 'uuid' }),
      ...(overrides.authorId === undefined ? [] : [column('authorId', overrides.authorId)]),
      ...(overrides.subtitle === undefined ? [] : [column('subtitle', overrides.subtitle)]),
    ]

    const before = [
      table(
        'articles',
        columns({
          id: { isPrimary: true },
          status: { enumValues: ['draft', 'archived'] },
          legacyId: { isUnique: true, isIndexed: true },
          subtitle: { isNullable: true },
        }),
        { relations: [belongsTo('editor', 'editors')] },
      ),
      table('editors'),
    ]
    const after = [
      table(
        'articles',
        columns({
          slug: { isPrimary: true, isIndexed: true },
          body: { type: 'text' },
          status: { enumValues: ['draft'] },
          legacyId: { isNullable: true },
          authorId: { type: 'uuid' },
        }),
        { primaryKey: 'slug', relations: [belongsTo('author', 'users')] },
      ),
      table('users'),
    ]

    expect(sentences(diffSchema(before, after).changes)).toEqual([
      'drops the foreign key from articles.editorId to editors.id',
      'drops the index on articles.legacyId',
      'creates table users',
      'adds required column articles.authorId with no database default',
      'changes articles.body from string to text',
      'removes "archived" on articles.status',
      'makes articles.legacyId optional',
      'drops the unique constraint on articles.legacyId',
      'moves the primary key of articles from id to slug',
      'indexes articles.slug',
      'adds a foreign key from articles.authorId to users.id',
      'drops column articles.subtitle',
      'drops table editors',
    ])
  })
})

describe('a table becoming translatable (SPEC.md §131)', () => {
  const plain: TableDescriptor = {
    name: 'dishes',
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
        name: 'slug',
        type: 'string',
        isPrimary: false,
        isNullable: false,
        isUnique: true,
        isIndexed: false,
        hasDefault: false,
      },
    ],
    relations: [],
  }

  const translated: TableDescriptor = {
    ...plain,
    translatable: true,
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
        name: 'slug',
        type: 'string',
        isPrimary: false,
        isNullable: false,
        isUnique: false,
        isIndexed: false,
        hasDefault: false,
      },
      {
        name: 'locale',
        type: 'string',
        isPrimary: false,
        isNullable: false,
        isUnique: false,
        isIndexed: true,
        hasDefault: false,
      },
      {
        name: 'translationOf',
        type: 'uuid',
        isPrimary: false,
        isNullable: true,
        isUnique: false,
        isIndexed: true,
        hasDefault: false,
      },
    ],
    uniqueTogether: [['slug', 'locale']],
  }

  it('says the locale column arrives because the table is becoming translatable', () => {
    const added = diffSchema([plain], [translated]).changes.find(
      (change) => change.kind === 'columnAdded' && change.column === 'locale',
    )

    // Which is what lets the SQL writer backfill it: what the rows already there are
    // written in is the deployment's default language, not a guess about the data.
    expect(added).toMatchObject({ becomesTranslatable: true })
  })

  it('moves the unique constraint rather than only dropping it', () => {
    const changes = diffSchema([plain], [translated]).changes

    expect(changes.map((change) => change.kind)).toEqual(
      expect.arrayContaining(['columnUniquenessChanged', 'uniqueTogetherAdded']),
    )
    expect(changes.find((change) => change.kind === 'uniqueTogetherAdded')).toMatchObject({
      table: 'dishes',
      columns: ['slug', 'locale'],
    })
  })

  it('reads a group as a set, so the order it was declared in is not a change', () => {
    const other: TableDescriptor = { ...translated, uniqueTogether: [['locale', 'slug']] }

    expect(diffSchema([translated], [other]).changes).toEqual([])
  })
})
