import { boolean as booleanColumn, model, string, timestamp, uuid } from '@assemora/data'
import { describe, expectTypeOf, it } from 'vitest'

import type { ResourceDescriptor } from './descriptor.js'
import { select, text } from './fields.js'
import { resource } from './resource.js'

const Article = model('articles', {
  id: uuid().primary(),
  title: string(),
  status: string(),
  published: booleanColumn(),
  createdAt: timestamp().created(),
})

const Articles = resource(Article, {
  title: text().required().searchable(),
  status: select('draft', 'published').filterable(),
})

describe('resource inference', () => {
  it('describes itself as plain data', () => {
    expectTypeOf(Articles.descriptor).toEqualTypeOf<ResourceDescriptor>()
    expectTypeOf(Articles.name).toEqualTypeOf<string>()
  })

  it('lists the declared fields, page by page', async () => {
    const page = await Articles.list()

    expectTypeOf(page.total).toEqualTypeOf<number>()
    expectTypeOf(page.perPage).toEqualTypeOf<number>()
    expectTypeOf(page.data[0]?.id).toEqualTypeOf<string | undefined>()
    expectTypeOf(page.data[0]?.title).toEqualTypeOf<string | undefined>()
  })

  it('drops a hidden field from the record type as well as from the output', async () => {
    const Guarded = resource(Article, { title: text(), status: text().hidden() })
    const found = await Guarded.find('x')

    expectTypeOf(found?.id).toEqualTypeOf<string | undefined>()
    expectTypeOf(found?.title).toEqualTypeOf<string | undefined>()

    // @ts-expect-error `status` is hidden, so it is not part of the record at all
    found?.status
  })

  it('keeps the model reachable and typed', () => {
    expectTypeOf(Articles.model.table).toEqualTypeOf<string>()
    expectTypeOf<(typeof Articles.model)['$infer']['title']>().toEqualTypeOf<string>()
  })

  it('types a select field by its declared options', () => {
    const status = select('draft', 'published')
    const parsed = status.schema.parse('draft')

    if (parsed.ok) {
      expectTypeOf(parsed.value).toEqualTypeOf<'draft' | 'published'>()
    }
  })
})

describe('invalid usage does not compile', () => {
  it('rejects a field the model does not have', () => {
    resource(Article, {
      // @ts-expect-error `subtitle` is not a column of articles
      subtitle: text(),
    })
  })

  it('rejects a value that is not a field', () => {
    resource(Article, {
      // @ts-expect-error a resource maps columns to fields, not to raw values
      title: 'Headline',
    })
  })

  it('rejects reading a column the resource never declared', async () => {
    const page = await Articles.list()

    // @ts-expect-error `published` is a column of the model, not a field of the resource
    page.data[0]?.published
  })

  it('rejects reading a page as if it were an array', async () => {
    const page = await Articles.list()

    // @ts-expect-error a page is not an array; the rows live in `data`
    page.map((entry) => entry)
  })

  it('rejects a list query field that is not a string', async () => {
    // @ts-expect-error the sort key is a field name
    await Articles.list({ sort: 42 })
  })
})
