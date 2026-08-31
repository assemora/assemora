import { ValidationError } from '@assemora/core'
import {
  boolean as booleanColumn,
  model,
  number as numberColumn,
  string,
  text as textColumn,
  timestamp,
  useAdapter,
  uuid,
} from '@assemora/data'
import { createMemoryAdapter, type MemoryAdapter } from '@assemora/database'
import { beforeEach, describe, expect, it } from 'vitest'

import { type AnyField, number, richText, select, slug, text, toggle } from './fields.js'
import { resource } from './resource.js'

const Article = model('articles', {
  id: uuid().primary().defaultRandom(),
  title: string(),
  slug: string(),
  body: textColumn(),
  excerpt: textColumn().nullable(),
  status: string(),
  views: numberColumn().default(0),
  featured: booleanColumn().default(false),
  createdAt: timestamp().created(),
})

const Articles = resource(
  Article,
  {
    title: text().required().searchable().sortable().label('Headline'),
    slug: slug('title'),
    body: richText().searchable(),
    excerpt: text(),
    status: select('draft', 'published').filterable().required(),
    views: number().sortable().filterable(),
    featured: toggle().filterable(),
  },
  { defaultSort: '-views', perPage: 2, api: { delete: false } },
)

let adapter: MemoryAdapter

beforeEach(() => {
  adapter = createMemoryAdapter({
    articles: [
      {
        id: 'a1',
        title: 'Ada writes',
        slug: 'ada-writes',
        body: 'first body',
        status: 'published',
        views: 500,
        featured: true,
      },
      {
        id: 'a2',
        title: 'Alan thinks',
        slug: 'alan-thinks',
        body: 'second body',
        status: 'draft',
        views: 50,
        featured: false,
      },
      {
        id: 'a3',
        title: 'Grace compiles',
        slug: 'grace-compiles',
        body: 'third body',
        status: 'published',
        views: 200,
        featured: false,
      },
    ],
  })

  useAdapter(adapter)
})

describe('descriptor', () => {
  it('describes every field for Studio, OpenAPI, the SDK and MCP', () => {
    expect(Articles.descriptor).toMatchObject({
      name: 'articles',
      label: 'Articles',
      kind: 'static',
      model: 'articles',
      primaryKey: 'id',
      perPage: 2,
      defaultSort: '-views',
      api: { create: true, read: true, update: true, delete: false },
    })
  })

  it('carries the label, the flags and the schema of each field', () => {
    const title = Articles.descriptor.fields.find((field) => field.name === 'title')

    expect(title).toMatchObject({
      kind: 'text',
      label: 'Headline',
      required: true,
      searchable: true,
      sortable: true,
      filterable: false,
      agent: { read: true, write: true },
      schema: { type: 'string' },
    })
  })

  it('humanizes a label that was not given', () => {
    expect(Articles.descriptor.fields.find((field) => field.name === 'views')?.label).toBe('Views')
  })

  it('exposes select options and the slug source', () => {
    expect(Articles.descriptor.fields.find((field) => field.name === 'status')?.options).toEqual([
      { value: 'draft', label: 'draft' },
      { value: 'published', label: 'published' },
    ])
    expect(Articles.descriptor.fields.find((field) => field.name === 'slug')?.source).toBe('title')
  })
})

describe('validation', () => {
  it('accepts a complete entry', () => {
    expect(Articles.validate({ title: 'New', status: 'draft' }, 'create')).toEqual({
      title: 'New',
      status: 'draft',
      slug: 'new',
    })
  })

  it('demands required fields on create but not on update', () => {
    expect(() => Articles.validate({ title: 'New' }, 'create')).toThrowError(ValidationError)
    expect(Articles.validate({ title: 'New' }, 'update')).toEqual({ title: 'New' })
  })

  it('reports every problem by field', () => {
    const failure = (() => {
      try {
        Articles.validate({ status: 'nonsense', views: 'many' }, 'create')
      } catch (error) {
        return error as ValidationError
      }
      return undefined
    })()

    expect(failure?.fields).toEqual({
      title: ['This field is required'],
      status: ['Expected one of: draft, published'],
      views: ['Expected a number'],
    })
  })

  it('takes null as clearing a field the column can leave empty', () => {
    expect(Articles.validate({ excerpt: null }, 'update')).toEqual({ excerpt: null })
  })

  it('refuses null for a required field, however empty the column may be', () => {
    const Strict = resource(Article, { excerpt: text().required() })

    expect(() => Strict.validate({ excerpt: null }, 'update')).toThrowError(ValidationError)
  })

  it('refuses null for a column that cannot hold it', () => {
    expect(() => Articles.validate({ body: null }, 'update')).toThrowError(ValidationError)
  })

  it('derives a slug from the field it was told to follow', () => {
    expect(
      Articles.validate({ title: 'Notes on the Analytical Engine', status: 'draft' }, 'create'),
    ).toMatchObject({ slug: 'notes-on-the-analytical-engine' })
  })

  it('folds accents rather than dropping them', () => {
    expect(
      Articles.validate({ title: 'Un café à Paris', status: 'draft' }, 'create'),
    ).toMatchObject({ slug: 'un-cafe-a-paris' })
  })

  it('keeps the slug a caller sent', () => {
    expect(
      Articles.validate({ title: 'Anything', slug: 'chosen-by-hand', status: 'draft' }, 'create'),
    ).toMatchObject({ slug: 'chosen-by-hand' })
  })

  it('leaves an existing slug alone when the title is edited', () => {
    expect(Articles.validate({ title: 'A better headline' }, 'update')).toEqual({
      title: 'A better headline',
    })
  })

  it('refuses a title that leaves nothing to slugify', () => {
    expect(() => Articles.validate({ title: '—', status: 'draft' }, 'create')).toThrowError(
      ValidationError,
    )
  })

  it('refuses a field the resource does not declare', () => {
    expect(() =>
      Articles.validate({ title: 'x', status: 'draft', isAdmin: true }, 'create'),
    ).toThrowError(ValidationError)
  })

  it('refuses to write a read-only field', () => {
    const Locked = resource(Article, { title: text(), views: number().readOnly() })

    expect(() => Locked.validate({ views: 10 }, 'update')).toThrowError(ValidationError)
  })

  it('refuses anything that is not an object', () => {
    for (const value of ['nope', [], 42, null]) {
      expect(() => Articles.validate(value, 'create')).toThrowError(ValidationError)
    }

    try {
      Articles.validate('nope', 'create')
    } catch (error) {
      expect((error as ValidationError).fields).toEqual({ _: ['Expected an object'] })
    }
  })
})

describe('listing', () => {
  it('paginates by default and never returns everything', async () => {
    const page = await Articles.list()

    expect(page).toMatchObject({ total: 3, page: 1, perPage: 2, lastPage: 2 })
    expect(page.data).toHaveLength(2)
  })

  it('applies the default sort', async () => {
    const page = await Articles.list()

    expect(page.data.map((entry) => entry.title)).toEqual(['Ada writes', 'Grace compiles'])
  })

  it('filters on a filterable field', async () => {
    const page = await Articles.list({ filters: { status: 'published' } })

    expect(page.total).toBe(2)
  })

  it('searches across the searchable fields', async () => {
    const byTitle = await Articles.list({ search: 'Grace' })
    const byBody = await Articles.list({ search: 'second' })

    expect(byTitle.data.map((entry) => entry.title)).toEqual(['Grace compiles'])
    expect(byBody.data.map((entry) => entry.title)).toEqual(['Alan thinks'])
  })

  it('sorts on request', async () => {
    const page = await Articles.list({ sort: 'views', perPage: 10 })

    expect(page.data.map((entry) => entry.views)).toEqual([50, 200, 500])
  })

  it('caps the page size, however large the request', async () => {
    const page = await Articles.list({ perPage: 5000 })

    expect(page.perPage).toBe(100)
  })
})

describe('what a read hands back (SPEC.md §28, §35)', () => {
  const Secretive = model('secrets', {
    id: uuid().primary(),
    title: string(),
    passwordHash: string(),
    internalNote: string(),
  })

  const Secrets = resource(Secretive, {
    title: text(),
    passwordHash: text().hidden(),
  })

  beforeEach(() => {
    adapter.seed('secrets', [
      { id: 's1', title: 'Visible', passwordHash: 'argon2id$...', internalNote: 'not for anyone' },
    ])
  })

  it('returns only the declared fields, plus the identifier', async () => {
    const page = await Secrets.list()

    expect(page.data[0]).toEqual({ id: 's1', title: 'Visible' })
  })

  it('never returns a column the resource did not declare', async () => {
    const found = await Secrets.find('s1')

    expect(found).not.toHaveProperty('internalNote')
  })

  it('never returns a field marked hidden', async () => {
    const found = await Secrets.find('s1')

    expect(found).not.toHaveProperty('passwordHash')
  })
})

describe('a list query is untrusted input', () => {
  it('refuses to filter on a field that is not filterable', async () => {
    await expect(Articles.list({ filters: { title: 'Ada writes' } })).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
      fields: { 'filters.title': ['"title" cannot be filtered on'] },
    })
  })

  it('refuses to filter on a field that does not exist at all', async () => {
    await expect(Articles.list({ filters: { secret: 'x' } })).rejects.toThrowError(ValidationError)
  })

  it('refuses a filter value the field cannot hold', async () => {
    await expect(Articles.list({ filters: { views: 'many' } })).rejects.toMatchObject({
      fields: { 'filters.views': ['"views" received a value it cannot hold'] },
    })
  })

  it('refuses to sort on a field that is not sortable', async () => {
    await expect(Articles.list({ sort: 'slug' })).rejects.toMatchObject({
      fields: { sort: ['"slug" cannot be sorted on'] },
    })
  })

  it('refuses to search a resource that declares nothing searchable', async () => {
    const Bare = resource(Article, { title: text() })

    await expect(Bare.list({ search: 'anything' })).rejects.toThrowError(ValidationError)
  })
})

/**
 * `Object.hasOwn` and not `in`, on the static side too (SPEC.md §86).
 *
 * A resource field is a column name, so this is rarer than on a collection — but it is
 * the same two sites, `validate` and `project`, and `'constructor' in row` is true of
 * every row that ever existed.
 */
describe('a field named after something on Object.prototype', () => {
  const Note = model('prototypal_notes', {
    id: uuid().primary().defaultRandom(),
    title: string(),
    constructor: string().nullable(),
  })

  const Notes = resource(Note, { title: text().required(), constructor: text() })

  it('is not read as provided by a caller who did not send it', () => {
    // With `in`, `source.constructor` is a function, and the field's schema refuses it
    // — so an ordinary create of a resource that happens to have such a column failed.
    expect(Notes.validate({ title: 'One' }, 'create')).toEqual({ title: 'One' })
  })

  it('is still required when it is required', () => {
    const Strict = resource(Note, { title: text(), constructor: text().required() })

    expect(() => Strict.validate({ title: 'One' }, 'create')).toThrowError(ValidationError)
  })

  it('is projected when the row really carries it', async () => {
    useAdapter(
      createMemoryAdapter({ prototypal_notes: [{ id: 'n1', title: 'One', constructor: 'hello' }] }),
    )

    expect(await Notes.find('n1')).toMatchObject({ constructor: 'hello' })
  })

  it('is not projected off the prototype when the row does not carry the key', async () => {
    const Bare = model('bare_notes', {
      id: uuid().primary().defaultRandom(),
      title: string(),
    })

    // A resource field is a model column, which is what the cast is for: it is the only
    // way to reach the case this guard exists for — a declared field the row snapshot
    // has no key for. `'constructor' in row` is true of every row ever loaded, so with
    // `in` the projection hands back `Object.prototype.constructor`, a function, under
    // a field name.
    const Loose = resource(Bare, { title: text(), constructor: text() } as { title: AnyField })

    useAdapter(createMemoryAdapter({ bare_notes: [{ id: 'n1', title: 'One' }] }))

    const found = await Loose.find('n1')

    expect(found).toMatchObject({ id: 'n1', title: 'One' })
    expect(Object.hasOwn(found ?? {}, 'constructor')).toBe(false)
  })
})

describe('what an entry is called (SPEC.md §35, §58)', () => {
  it('describes the field a picker should read', () => {
    const Named = resource(
      Article,
      { title: text(), slug: slug('title') },
      { name: 'named', titleField: 'title' },
    )

    expect(Named.descriptor.titleField).toBe('title')
  })

  it('says nothing when nothing was said, so a reader knows it is guessing', () => {
    expect(Articles.descriptor.titleField).toBeUndefined()
  })

  it('carries the heading Studio files it under, because the registry is how Studio learns', () => {
    const Filed = resource(
      Article,
      { title: text(), slug: slug('title') },
      { name: 'filed', group: 'Блог' },
    )

    expect(Filed.descriptor.group).toBe('Блог')
  })

  it('leaves the group unsaid, so a project that groups nothing looks as it did', () => {
    expect(Articles.descriptor.group).toBeUndefined()
  })

  it('refuses a field the resource does not declare, and lists the ones it does', () => {
    expect(() =>
      resource(Article, { title: text() }, { name: 'unnamed', titleField: 'headline' }),
    ).toThrow(/not one of its fields.*title/s)
  })

  it('refuses a hidden field, because a title nobody may read is not a title', () => {
    expect(() =>
      resource(
        Article,
        { title: text().hidden(), slug: slug('title') },
        { name: 'secret', titleField: 'title' },
      ),
    ).toThrow(/hidden/)
  })
})
