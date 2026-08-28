/**
 * The controls one field kind at a time (SPEC.md §39, §115).
 *
 * Drawn rather than reasoned about, because what these have to get right is the *shape*
 * they present: a link shows one variant and not both, a table row is exactly as wide as
 * its headings, a repeater draws one card per item, and a kind this file has never heard
 * of still gets a control that can hold what it holds.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import type { FieldDescriptor } from '../api/introspection.ts'
import { FieldInput } from './fields.tsx'

const field = (
  over: Partial<FieldDescriptor> & { kind: FieldDescriptor['kind'] },
): FieldDescriptor => ({
  name: 'value',
  required: false,
  searchable: false,
  sortable: false,
  filterable: false,
  hidden: false,
  readOnly: false,
  ...over,
})

/** A provider, because a picker asks the application what exists rather than guessing. */
const draw = (element: ReactElement): string =>
  renderToStaticMarkup(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      {element}
    </QueryClientProvider>,
  )

const input = (descriptor: FieldDescriptor, value: unknown, issues?: Record<string, string[]>) =>
  draw(
    <FieldInput
      field={descriptor}
      value={value}
      {...(issues === undefined ? {} : { issues })}
      onChange={() => undefined}
    />,
  )

/** How many times a tag opens. Counting cells is the whole point of the table test. */
const count = (markup: string, tag: string): number => markup.split(`<${tag}`).length - 1

describe('a whole number', () => {
  it('is a number input the browser will not accept 3.5 in', () => {
    const markup = input(field({ kind: 'integer' }), 3)

    expect(markup).toContain('type="number"')
    expect(markup).toContain('step="1"')
  })

  it('leaves a plain number alone, because 3.5 is one', () => {
    expect(input(field({ kind: 'number' }), 3.5)).not.toContain('step="1"')
  })
})

describe('several of a list', () => {
  const tags = field({
    kind: 'checkboxes',
    options: [
      { value: 'news', label: 'news' },
      { value: 'guide', label: 'guide' },
    ],
  })

  it('draws a box per option and ticks the ones held', () => {
    const markup = input(tags, ['guide'])

    expect(count(markup, 'input type="checkbox"')).toBe(2)
    expect(markup.split('checked=""').length - 1).toBe(1)
  })

  it('says so rather than drawing nothing when a field declares no options', () => {
    expect(input(field({ kind: 'checkboxes' }), [])).toContain('declares no options')
  })
})

describe('a colour', () => {
  it('shows the value beside the swatch, because a swatch cannot be pasted into', () => {
    const markup = input(field({ kind: 'color' }), '#4a5ed6')

    expect(markup).toContain('type="color"')
    expect(markup).toContain('value="#4a5ed6"')
  })

  it('expands a short hex for the swatch and stores neither expansion nor case', () => {
    const markup = input(field({ kind: 'color' }), '#ABC')

    // The swatch speaks #rrggbb only; what is stored stays exactly what was typed.
    expect(markup).toContain('value="#AABBCC"')
    expect(markup).toContain('value="#ABC"')
  })
})

describe('source code', () => {
  it('offers the languages the field declares, and a free name when it declares none', () => {
    const narrowed = input(field({ kind: 'code', options: [{ value: 'sql', label: 'sql' }] }), {
      language: 'sql',
      source: 'select 1',
    })

    expect(narrowed).toContain('<select')
    expect(narrowed).toContain('select 1')
    expect(input(field({ kind: 'code' }), null)).toContain('placeholder="ts"')
  })

  it('says what it is: stored as written, never run', () => {
    expect(input(field({ kind: 'code' }), null)).toContain('never run')
  })
})

describe('a link', () => {
  it('draws the variant its tag names, and only that one', () => {
    const web = input(field({ kind: 'link' }), {
      type: 'url',
      url: 'https://assemora.dev',
      label: 'Docs',
    })

    expect(web).toContain('https://assemora.dev')
    expect(web).toContain('value="Docs"')
    // A link carries a url *or* an entry. The control that edits one may not leave the
    // other on the screen, or a person can fill both in and be refused for it.
    expect(web).not.toContain('Choose a resource')
  })

  it('asks which entry once the tag says an entry', () => {
    const entry = input(field({ kind: 'link' }), {
      type: 'entry',
      entry: { resource: 'articles', id: '0f4c3a3e-0000-4000-8000-000000000000' },
    })

    expect(entry).toContain('Choose a resource')
    expect(entry).not.toContain('type="url"')
  })

  it('is nothing until a tag is chosen', () => {
    const empty = input(field({ kind: 'link' }), null)

    expect(empty).toContain('A web address')
    expect(empty).not.toContain('type="url"')
  })
})

describe('a table', () => {
  it('draws a row exactly as wide as its headings', () => {
    const markup = input(field({ kind: 'table' }), {
      columns: ['Plan', 'Price'],
      // A ragged row cannot be stored, and a value that arrives ragged is still drawn
      // to the width of the headings rather than losing the cell nobody can see.
      rows: [['Free']],
    })

    // The trailing space keeps `<thead` out of the count.
    expect(count(markup, 'th ')).toBe(3)
    expect(count(markup, 'td ')).toBe(3)
    expect(markup).toContain('Free')
  })

  it('starts with a column, because a table with none has no rows to add', () => {
    expect(input(field({ kind: 'table' }), null)).toContain('A table starts with a column')
  })
})

describe('a group', () => {
  const author = field({
    kind: 'object',
    name: 'author',
    label: 'Author',
    fields: [
      field({ kind: 'text', name: 'name', label: 'Full name', required: true }),
      field({ kind: 'url', name: 'site', label: 'Site' }),
    ],
  })

  it('draws an input per field it groups, from the descriptor and nothing else', () => {
    const markup = input(author, { name: 'Ada' })

    expect(markup).toContain('Full name')
    expect(markup).toContain('value="Ada"')
    expect(markup).toContain('Site')
  })

  it('lands a refusal about an inner field on that field', () => {
    const markup = input(author, {}, { name: ['This field is required'] })

    expect(markup).toContain('This field is required')
    // Against the input, not as `name: This field is required` in a box at the top.
    expect(markup).not.toContain('name: This field is required')
  })

  it('falls back to JSON when nothing describes what is in it', () => {
    expect(input(field({ kind: 'object', name: 'meta' }), { a: 1 })).toContain('font-mono')
  })

  /**
   * A nested field's name comes from a stored definition (SPEC.md §37, §86), and
   * `/^[a-zA-Z][a-zA-Z0-9_]*$/` makes `constructor`, `toString`, `valueOf` and
   * `hasOwnProperty` legal ones. A group's value is a plain object, so reading it by
   * plain indexing answered every one of those from `Object.prototype` — the control
   * opened pre-filled with `function Object() { [native code] }`, and saving the form
   * stored that sentence.
   */
  it('does not pre-fill an inner input from Object.prototype', () => {
    const inherited = field({
      kind: 'object',
      name: 'group',
      fields: [
        field({ kind: 'text', name: 'title', label: 'Title' }),
        field({ kind: 'text', name: 'constructor', label: 'Constructor' }),
        field({ kind: 'text', name: 'toString', label: 'To string' }),
        field({ kind: 'text', name: 'valueOf', label: 'Value of' }),
        field({ kind: 'text', name: 'hasOwnProperty', label: 'Has own property' }),
      ],
    })

    const markup = input(inherited, { title: 'A heading' })

    expect(markup).toContain('value="A heading"')
    expect(markup).not.toContain('native code')
    expect(markup).not.toContain('function ')
  })
})

describe('a repeater', () => {
  const sections = field({
    kind: 'array',
    name: 'sections',
    label: 'Sections',
    element: field({
      kind: 'object',
      name: 'element',
      label: 'Element',
      fields: [field({ kind: 'text', name: 'heading', label: 'Heading' })],
    }),
  })

  it('draws one card per item, numbered', () => {
    const markup = input(sections, [{ heading: 'One' }, { heading: 'Two' }])

    expect(markup).toContain('Item 1')
    expect(markup).toContain('Item 2')
    expect(markup).toContain('value="One"')
    expect(markup).toContain('Remove item 2')
  })

  it('says it is empty rather than drawing an empty list', () => {
    const markup = input(sections, [])

    expect(markup).toContain('Nothing here yet')
    expect(markup).toContain('Add an item')
  })

  it('lands a refusal about one item on that item', () => {
    const markup = input(sections, [{ heading: '' }, { heading: '' }], {
      '1.heading': ['This field is required'],
    })

    const second = markup.slice(markup.indexOf('Item 2'))

    expect(second).toContain('This field is required')
    expect(markup.slice(0, markup.indexOf('Item 2'))).not.toContain('This field is required')
  })

  /**
   * The one an entry form must not lose: a refusal naming an item that is no longer
   * there has no card to land on, and dropping it would be the defect `Failure` exists
   * to have fixed (SPEC.md §84).
   */
  it('still shows what was said about an item nothing draws any more', () => {
    expect(input(sections, [], { '3.heading': ['This field is required'] })).toContain(
      '3.heading: This field is required',
    )
  })
})

describe('a kind Studio has never heard of', () => {
  /**
   * A plugin registers a field kind (SPEC.md §39), and the switch above knows nothing
   * about it. The descriptor still carries the field's own JSON Schema — the same
   * declaration the server validates against — so the fallback reads that rather than
   * guessing from the name, and a composite value never reaches a text input.
   */
  it('reads the schema rather than printing [object Object] into a text box', () => {
    const markup = input(
      field({ kind: 'wormhole' as FieldDescriptor['kind'], schema: { type: 'object' } }),
      { from: 'here' },
    )

    expect(markup).not.toContain('[object Object]')
    expect(markup).toContain('&quot;from&quot;: &quot;here&quot;')
  })

  it('draws a plain input for a plain value', () => {
    const markup = input(
      field({ kind: 'wormhole' as FieldDescriptor['kind'], schema: { type: 'string' } }),
      'here',
    )

    expect(markup).toContain('value="here"')
    expect(markup).not.toContain('<textarea')
  })
})
