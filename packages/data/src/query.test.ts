import { describe, expect, it } from 'vitest'

import { boolean, json, number, string, timestamp, uuid } from './columns.js'
import { clearModelRegistry, model } from './model.js'
import { belongsTo } from './relations.js'

const User = model('users', {
  id: uuid().primary(),
  name: string(),
  age: number(),
  active: boolean(),
  createdAt: timestamp().created(),
})

describe('query AST', () => {
  it('starts empty', () => {
    expect(User.toAst()).toEqual({
      model: 'users',
      operation: 'select',
      where: [],
      order: [],
      with: [],
    })
  })

  it('records a plain comparison', () => {
    expect(User.where('active', true).toAst().where).toEqual([
      { kind: 'comparison', combinator: 'and', field: 'active', operator: '=', value: true },
    ])
  })

  it('records an explicit operator', () => {
    expect(User.where('age', '>=', 18).toAst().where).toEqual([
      { kind: 'comparison', combinator: 'and', field: 'age', operator: '>=', value: 18 },
    ])
  })

  it('expands an object filter into one comparison per key', () => {
    expect(User.where({ active: true, name: 'Ada' }).toAst().where).toEqual([
      { kind: 'comparison', combinator: 'and', field: 'active', operator: '=', value: true },
      { kind: 'comparison', combinator: 'and', field: 'name', operator: '=', value: 'Ada' },
    ])
  })

  it('records the whole where family', () => {
    const ast = User.whereIn('name', ['Ada'])
      .whereNotIn('name', ['Alan'])
      .whereNull('createdAt')
      .whereNotNull('createdAt')
      .whereBetween('age', [10, 20])
      .whereLike('name', 'A%')
      .toAst()

    expect(
      ast.where.map((condition) => condition.kind === 'comparison' && condition.operator),
    ).toEqual(['in', 'not in', 'is null', 'is not null', 'between', 'like'])
  })

  it('groups a callback so precedence survives', () => {
    const ast = User.where('active', true)
      .where((query) => query.where('age', '>', 30).orWhere('name', 'Ada'))
      .toAst()

    expect(ast.where[1]).toEqual({
      kind: 'group',
      combinator: 'and',
      conditions: [
        { kind: 'comparison', combinator: 'and', field: 'age', operator: '>', value: 30 },
        { kind: 'comparison', combinator: 'or', field: 'name', operator: '=', value: 'Ada' },
      ],
    })
  })

  it('records ordering, limit and offset', () => {
    const ast = User.orderBy('name').latest().oldest('age').take(10).offset(20).toAst()

    expect(ast.order).toEqual([
      { field: 'name', direction: 'asc' },
      { field: 'createdAt', direction: 'desc' },
      { field: 'age', direction: 'asc' },
    ])
    expect(ast.limit).toBe(10)
    expect(ast.offset).toBe(20)
  })

  it('merges relation paths into a tree', () => {
    const Post = model('posts', {
      id: uuid().primary(),
      authorId: uuid(),
      author: belongsTo(() => User),
    })

    expect(Post.with('author', 'author').toAst().with).toEqual([{ relation: 'author', nested: [] }])
  })
})

describe('JSON operators (SPEC.md §38)', () => {
  const Doc = model('docs', {
    id: uuid().primary(),
    title: string(),
    metadata: json<{ source: string; origin?: { system: string } }>(),
  })

  it('addresses a key inside a document', () => {
    expect(Doc.whereJson('metadata', 'source', 'import').toAst().where).toEqual([
      {
        kind: 'json',
        combinator: 'and',
        field: 'metadata',
        path: ['source'],
        operator: 'equals',
        value: 'import',
      },
    ])
  })

  it('splits a dotted path into segments', () => {
    const condition = Doc.whereJson('metadata', 'origin.system', 'crm').toAst().where[0]

    expect(condition).toMatchObject({ path: ['origin', 'system'] })
  })

  it('compares the whole document when the path is empty', () => {
    expect(Doc.whereJson('metadata', '', { source: 'a' }).toAst().where[0]).toMatchObject({
      path: [],
      operator: 'equals',
    })
  })

  it('asks whether a document contains a fragment', () => {
    expect(Doc.whereJsonContains('metadata', { source: 'import' }).toAst().where[0]).toMatchObject({
      operator: 'contains',
      path: [],
      value: { source: 'import' },
    })
  })

  it('builds an or-group for search across keys', () => {
    const ast = Doc.where((query) =>
      query
        .whereJsonLike('metadata', 'source', '%im%')
        .orWhereJsonLike('metadata', 'origin.system', '%crm%'),
    ).toAst()

    expect(ast.where[0]).toMatchObject({
      kind: 'group',
      conditions: [
        { operator: 'like', combinator: 'and', path: ['source'] },
        { operator: 'like', combinator: 'or', path: ['origin', 'system'] },
      ],
    })
  })
})

describe('page bounds', () => {
  it('accepts whole numbers', () => {
    expect(User.take(10).offset(20).toAst()).toMatchObject({ limit: 10, offset: 20 })
  })

  it('refuses anything a page size cannot be', () => {
    for (const bad of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => User.take(bad)).toThrowError('take() needs a whole number of rows')
      expect(() => User.limit(bad)).toThrowError('limit() needs a whole number of rows')
      expect(() => User.offset(bad)).toThrowError('offset() needs a whole number of rows')
    }
  })
})

describe('the latest() shorthand', () => {
  it('orders by createdAt when the model has one', () => {
    expect(User.latest().toAst().order).toEqual([{ field: 'createdAt', direction: 'desc' }])
  })

  it('says which column is missing instead of leaving it to the adapter', () => {
    const Timeless = model('timeless', { id: uuid().primary(), title: string() })

    expect(() => Timeless.latest()).toThrowError(
      '"timeless" has no createdAt column, so latest() and oldest() need one named',
    )
    expect(Timeless.latest('title').toAst().order).toEqual([{ field: 'title', direction: 'desc' }])
  })
})

describe('immutability', () => {
  it('never changes the query it was derived from', () => {
    const base = User.where('active', true)
    const narrowed = base.where('age', '>', 30)

    expect(base.toAst().where).toHaveLength(1)
    expect(narrowed.toAst().where).toHaveLength(2)
    expect(narrowed).not.toBe(base)
  })

  it('leaves the model itself untouched', () => {
    User.where('active', true).take(5)

    expect(User.toAst()).toEqual({
      model: 'users',
      operation: 'select',
      where: [],
      order: [],
      with: [],
    })
  })

  it('does not leak the conditions of a grouped callback into the parent', () => {
    const grouped = User.where((query) => query.where('age', '>', 30))

    expect(grouped.toAst().where).toHaveLength(1)
    expect(User.toAst().where).toHaveLength(0)
  })
})

describe('soft deletes', () => {
  const Article = model(
    'articles',
    { id: uuid().primary(), title: string(), deletedAt: timestamp().nullable() },
    { softDeletes: true },
  )

  it('hides trashed rows by default', () => {
    expect(Article.toAst().where).toEqual([
      { kind: 'comparison', combinator: 'and', field: 'deletedAt', operator: 'is null' },
    ])
  })

  it('includes or isolates them on request', () => {
    expect(Article.withTrashed().toAst().where).toEqual([])
    expect(Article.onlyTrashed().toAst().where).toEqual([
      { kind: 'comparison', combinator: 'and', field: 'deletedAt', operator: 'is not null' },
    ])
  })
})

clearModelRegistry()
