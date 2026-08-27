/**
 * What Studio reads off a resource description before it draws a screen.
 *
 * Every one of these is a place where the descriptor says slightly more than the
 * application will honour, or slightly more than a screen has room for. The rules are
 * here rather than inside a component so they can be asserted without a router, a
 * query client and a DOM.
 */
import { describe, expect, it } from 'vitest'

import {
  columnFields,
  editableFields,
  type FieldDescriptor,
  type ResourceDescriptor,
  sortableFields,
} from './introspection.ts'

const field = (over: Partial<FieldDescriptor> & { name: string }): FieldDescriptor => ({
  kind: 'text',
  required: false,
  searchable: false,
  sortable: false,
  filterable: false,
  hidden: false,
  readOnly: false,
  ...over,
})

const resource = (over: Partial<ResourceDescriptor> = {}): ResourceDescriptor => ({
  name: 'testimonials',
  label: 'Testimonials',
  kind: 'dynamic',
  model: 'assemora_resource_entries',
  primaryKey: 'id',
  fields: [field({ name: 'author', sortable: true }), field({ name: 'quote' })],
  api: { create: true, read: true, update: true, delete: true },
  perPage: 20,
  ...over,
})

describe('the fields a listing can be ordered by (SPEC.md §38)', () => {
  /**
   * The bug this covers: the sort dropdown was built from `sortable` for every kind of
   * resource, and `entries.list` refuses every one of a collection's fields — the
   * values are inside a JSONB document and ADR-0012 fixes the ordering to the entry's
   * own columns. Choosing the dropdown's own option replaced the whole list with a
   * validation failure.
   */
  it('is none of a collection’s, however its stored definition was written', () => {
    expect(sortableFields(resource())).toEqual([])
  })

  it('is what a source-declared resource says, because that one can honour it', () => {
    const declared = sortableFields(resource({ kind: 'static' }))

    expect(declared.map((each) => each.name)).toEqual(['author'])
  })
})

describe('the fields a screen shows', () => {
  it('keeps a table to five columns and leaves rich text out of them', () => {
    const wide = resource({
      fields: [
        field({ name: 'a' }),
        field({ name: 'body', kind: 'richText' }),
        field({ name: 'b' }),
        field({ name: 'c' }),
        field({ name: 'd' }),
        field({ name: 'e' }),
        field({ name: 'f' }),
      ],
    })

    expect(columnFields(wide).map((each) => each.name)).toEqual(['a', 'b', 'c', 'd', 'e'])
  })

  it('never offers a hidden or read-only field to a form', () => {
    const mixed = resource({
      fields: [
        field({ name: 'title' }),
        field({ name: 'passwordHash', hidden: true }),
        field({ name: 'createdAt', readOnly: true }),
      ],
    })

    expect(editableFields(mixed).map((each) => each.name)).toEqual(['title'])
    expect(columnFields(mixed).map((each) => each.name)).toEqual(['title', 'createdAt'])
  })
})
