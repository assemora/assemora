/**
 * That a form is drawn from its layout, and that a layout cannot hide a field.
 */
import { describe, expect, it } from 'vitest'

import type { FieldDescriptor } from '../api/introspection.ts'
import { arrange, LEFT_OUT } from './resolve.ts'

const field = (name: string, kind: FieldDescriptor['kind'] = 'text'): FieldDescriptor => ({
  name,
  kind,
  required: false,
  searchable: false,
  sortable: false,
  filterable: false,
  hidden: false,
  readOnly: false,
})

const FIELDS = [field('title'), field('body', 'richText'), field('featured', 'boolean')]

const names = (fields: readonly { field: FieldDescriptor }[]) => fields.map((one) => one.field.name)

describe('arranging a form', () => {
  it('derives two columns from the kinds when nothing was declared or arranged', () => {
    const drawn = arrange(FIELDS, undefined)

    expect(drawn.derived).toBe(true)
    expect(names(drawn.sections?.[0]?.fields ?? [])).toEqual(['title', 'body'])
    expect(names(drawn.aside[0]?.fields ?? [])).toEqual(['featured'])
  })

  it('draws the sections a layout names, with the widths it gives', () => {
    const drawn = arrange(FIELDS, {
      sections: [
        {
          key: 'head',
          title: 'Head',
          columns: 2,
          fields: [{ field: 'title', width: 'half' }, 'featured'],
        },
        { key: 'text', fields: ['body'] },
      ],
    })

    expect(drawn.derived).toBe(false)
    expect(drawn.sections?.map((section) => section.key)).toEqual(['head', 'text'])
    expect(drawn.sections?.[0]?.columns).toBe(2)
    expect(drawn.sections?.[0]?.fields.map((one) => one.width)).toEqual(['half', 'full'])
    expect(drawn.aside).toEqual([])
  })

  it('puts a field the layout left out in a trailing section, so a new column is never invisible', () => {
    const drawn = arrange(FIELDS, { sections: [{ key: 'head', fields: ['title'] }] })

    expect(drawn.sections?.map((section) => section.key)).toEqual(['head', LEFT_OUT])
    expect(names(drawn.sections?.[1]?.fields ?? [])).toEqual(['body', 'featured'])
  })

  it('puts what was left out at the end of the last tab, leaving the tabs’ own order alone', () => {
    const drawn = arrange(FIELDS, {
      tabs: [
        { key: 'a', label: 'A', sections: [{ key: 'one', fields: ['title'] }] },
        { key: 'b', label: 'B', sections: [{ key: 'two', fields: ['body'] }] },
      ],
    })

    expect(drawn.tabs?.map((tab) => tab.sections.map((section) => section.key))).toEqual([
      ['one'],
      ['two', LEFT_OUT],
    ])
  })

  it('skips a name the resource no longer declares rather than drawing a hole', () => {
    const drawn = arrange(FIELDS, { sections: [{ key: 'head', fields: ['title', 'summary'] }] })

    expect(names(drawn.sections?.[0]?.fields ?? [])).toEqual(['title'])
  })
})
