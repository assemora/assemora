import { describe, expect, it } from 'vitest'

import { describeField } from './descriptor.js'
import {
  array,
  boolean,
  date,
  email,
  json,
  media,
  number,
  relation,
  richText,
  select,
  slug,
  text,
  textarea,
  toggle,
  url,
} from './fields.js'

describe('the field vocabulary of SPEC.md §39', () => {
  it('offers every declared kind', () => {
    const kinds = [
      text(),
      textarea(),
      richText(),
      number(),
      boolean(),
      toggle(),
      date(),
      select('a', 'b'),
      json(),
      slug('title'),
      url(),
      email(),
      media(),
      relation('authors'),
      array(text()),
    ].map((field) => field.kind)

    expect(new Set(kinds)).toEqual(
      new Set([
        'text',
        'textarea',
        'richText',
        'number',
        'boolean',
        'date',
        'select',
        'json',
        'slug',
        'url',
        'email',
        'media',
        'relation',
        'array',
      ]),
    )
  })

  it('validates through the schema it carries', () => {
    expect(email().schema.parse('a@b.co').ok).toBe(true)
    expect(email().schema.parse('nope').ok).toBe(false)
    expect(url().schema.parse('https://x.io').ok).toBe(true)
    expect(url().schema.parse('x.io').ok).toBe(false)
    expect(slug('title').schema.parse('a-good-slug').ok).toBe(true)
    expect(slug('title').schema.parse('Not A Slug').ok).toBe(false)
    expect(select('draft', 'published').schema.parse('draft').ok).toBe(true)
    expect(select('draft', 'published').schema.parse('other').ok).toBe(false)
  })

  it('stays immutable when modified', () => {
    const base = text()
    const required = base.required()

    expect(base.isRequired).toBe(false)
    expect(required.isRequired).toBe(true)
    expect(required).not.toBe(base)
  })

  it('keeps presentation apart from the flags', () => {
    const field = text().label('Headline').help('Shown in the list').placeholder('Type here')

    expect(field.presentation).toEqual({
      label: 'Headline',
      help: 'Shown in the list',
      placeholder: 'Type here',
    })
  })

  it('lets a field narrow what an agent may do (SPEC.md §52)', () => {
    expect(text().agent).toEqual({ read: true, write: true })
    expect(text().agentAccess({ write: false }).agent).toEqual({ read: true, write: false })
  })

  it('describes an array by its element', () => {
    const tags = array(select('news', 'guide'))

    expect(tags.element?.kind).toBe('select')
    expect(tags.schema.parse(['news']).ok).toBe(true)
    expect(tags.schema.parse(['nope']).ok).toBe(false)
  })
})

describe('field descriptors', () => {
  it('turn a field into the data Studio, OpenAPI and MCP read', () => {
    expect(describeField('publishedAt', date().sortable().filterable())).toEqual({
      name: 'publishedAt',
      kind: 'date',
      label: 'Published at',
      required: false,
      searchable: false,
      sortable: true,
      filterable: true,
      hidden: false,
      readOnly: false,
      agent: { read: true, write: true },
      schema: { type: 'string', format: 'date-time' },
    })
  })

  it('include the target of a media or relation field', () => {
    expect(describeField('cover', media()).target).toBe('media')
    expect(describeField('author', relation('authors')).target).toBe('authors')
  })
})
