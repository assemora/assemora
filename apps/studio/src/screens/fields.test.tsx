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
import { asDateInput, FieldInput } from './fields.tsx'

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
const draw = (element: ReactElement, seed?: (client: QueryClient) => void): string => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })

  seed?.(client)

  return renderToStaticMarkup(<QueryClientProvider client={client}>{element}</QueryClientProvider>)
}

const input = (
  descriptor: FieldDescriptor,
  value: unknown,
  issues?: Record<string, string[]>,
  seed?: (client: QueryClient) => void,
) =>
  draw(
    <FieldInput
      field={descriptor}
      value={value}
      {...(issues === undefined ? {} : { issues })}
      onChange={() => undefined}
    />,
    seed,
  )

/** What the application answered when Studio asked what exists. */
const knows = (
  resources: readonly Record<string, unknown>[],
  entries: readonly Record<string, unknown>[] = [],
) => {
  const named = resources[0]?.name

  return (client: QueryClient): void => {
    client.setQueryData(['introspection'], { resources })

    if (named !== undefined) client.setQueryData(['entries', named, ''], { data: entries })
  }
}

/** A resource, described the way `/_introspection` describes one. */
const listable = (over: Record<string, unknown>) => ({
  label: 'Products',
  kind: 'static',
  model: 'products',
  primaryKey: 'id',
  fields: [field({ kind: 'text', name: 'name' })],
  api: { create: true, read: true, update: true, delete: true },
  perPage: 20,
  ...over,
})

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

    // Studio's own box rather than the browser's: a native checkbox is a different size
    // and a different shape on every platform, and the handoff draws exactly one box.
    // `count` looks for a tag; these are attributes on one, so they are counted plainly.
    expect(markup.split('role="checkbox"').length - 1).toBe(2)
    expect(markup.split('aria-checked="true"').length - 1).toBe(1)
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

describe('a relation is chosen, not typed (SPEC.md §39, §58)', () => {
  const relation = field({ kind: 'relation', name: 'category', target: 'products' })

  it('lists the resource the field names', () => {
    const html = input(
      relation,
      '',
      undefined,
      knows(
        [listable({ name: 'products' })],
        [
          { id: 'd1', name: 'Wide Brim Hat' },
          { id: 'd2', name: 'Canvas Tote' },
        ],
      ),
    )

    expect(html).toContain('Wide Brim Hat')
    expect(html).toContain('Canvas Tote')
    expect(html).toContain('<select')
  })

  it('calls an entry what the resource says names it', () => {
    const html = input(
      relation,
      '',
      undefined,
      knows(
        [
          listable({
            name: 'products',
            titleField: 'name',
            // Declared first, and therefore what the guess would have read.
            fields: [
              field({ kind: 'text', name: 'articleNumber' }),
              field({ kind: 'text', name: 'name' }),
            ],
          }),
        ],
        [{ id: 'd1', articleNumber: '091', name: 'Wide Brim Hat' }],
      ),
    )

    // Declaration order would have made this read `091`, which is the whole reason
    // `titleField` exists.
    expect(html).toContain('Wide Brim Hat')
    expect(html).not.toContain('>091<')
  })

  it('keeps the stored id offered when the page it lists does not hold it', () => {
    const html = input(
      relation,
      'd9',
      undefined,
      knows([listable({ name: 'products' })], [{ id: 'd1', name: 'Wide Brim Hat' }]),
    )

    expect(html).toContain('d9')
  })

  it('says so, and stays fillable, when the field names no target', () => {
    const html = input(field({ kind: 'relation', name: 'category' }), 'd1')

    expect(html).toContain('names no target resource')
    expect(html).toContain('<input')
    expect(html).toContain('d1')
  })

  it('says so, and stays fillable, when the target cannot be listed here', () => {
    const html = input(relation, 'd1', undefined, knows([listable({ name: 'something-else' })]))

    expect(html).toContain('cannot be listed here')
    expect(html).toContain('<input')
  })
})

/**
 * An instant, shown on the reader's clock (SPEC.md §39).
 *
 * A `datetime-local` input holds wall-clock time with no zone attached, so what goes
 * into it has to be the reader's wall clock. It used to be UTC's: 18:00 in Kyiv was
 * stored correctly as 15:00Z and then displayed as 15:00, three hours earlier than the
 * editor had typed. The write path was always right — a value with no zone is read as
 * local — which is why the error never compounded and why nobody caught it in the data.
 *
 * The timezone is set here rather than assumed, because a test that passes only in the
 * zone its author happened to be in is not a test of this.
 */
describe('a datetime is displayed on the reader’s clock', () => {
  const inZone = <T,>(zone: string, work: () => T): T => {
    const before = process.env.TZ
    process.env.TZ = zone

    try {
      return work()
    } finally {
      if (before === undefined) delete process.env.TZ
      else process.env.TZ = before
    }
  }

  it('shows the local hour, not the UTC one', () => {
    // Summer time in Kyiv: UTC+3.
    expect(inZone('Europe/Kyiv', () => asDateInput('2026-09-03T15:00:00.000Z', true))).toBe(
      '2026-09-03T18:00',
    )
  })

  it('shows it west of UTC too, where the day can differ', () => {
    // 01:00Z is the previous evening in New York, so both the date and the hour move.
    expect(inZone('America/New_York', () => asDateInput('2026-09-03T01:00:00.000Z', true))).toBe(
      '2026-09-02T21:00',
    )
  })

  it('is right on the day a clock goes back, when one hour happens twice', () => {
    // Kyiv leaves summer time on 2026-10-25. 00:30Z is 03:30 at UTC+3 and 01:30Z is
    // 03:30 again at UTC+2 — the same wall clock for two different instants, which is
    // exactly what shifting the epoch by a single `getTimezoneOffset()` gets wrong.
    const shown = inZone('Europe/Kyiv', () => [
      asDateInput('2026-10-25T00:30:00.000Z', true),
      asDateInput('2026-10-25T01:30:00.000Z', true),
    ])

    expect(shown).toEqual(['2026-10-25T03:30', '2026-10-25T03:30'])
  })

  it('survives the round trip the form makes, in any zone', () => {
    // What the input shows, read back the way `onChange` reads it, is the instant the
    // API sent. This is the property that holds wherever the reader is.
    for (const zone of ['Europe/Kyiv', 'America/New_York', 'Asia/Kolkata', 'UTC']) {
      const stored = '2026-09-03T15:00:00.000Z'

      const round = inZone(zone, () => new Date(asDateInput(stored, true)).toISOString())

      expect(round, zone).toBe(stored)
    }
  })

  /**
   * A calendar day and not an instant, which is why it is formatted in the other zone.
   *
   * Midnight UTC read at any negative offset is the day before, so formatting a date in
   * local time would move somebody's birthday.
   */
  it('leaves a date-only value on the day it was written', () => {
    expect(inZone('America/New_York', () => asDateInput('2026-09-03T00:00:00.000Z', false))).toBe(
      '2026-09-03',
    )
  })

  it('has nothing to show for nothing', () => {
    expect(asDateInput(null, true)).toBe('')
    expect(asDateInput('', true)).toBe('')
    expect(asDateInput('not a date', true)).toBe('')
  })

  /**
   * The control itself, and not only the function behind it.
   *
   * Which zone a value is formatted in is decided twice — once by `asDateInput`, and
   * once by what the control passes it as `withTime`. Getting the second one wrong
   * formats a calendar day on the reader's clock and moves it, and every test above
   * would stay green.
   */
  it('draws a datetime as a local wall clock and a date as the day itself', () => {
    const shown = inZone('America/New_York', () => ({
      instant: input(field({ kind: 'datetime' }), '2026-09-03T01:00:00.000Z'),
      day: input(field({ kind: 'date' }), '2026-09-03T00:00:00.000Z'),
    }))

    expect(shown.instant).toContain('type="datetime-local"')
    expect(shown.instant).toContain('value="2026-09-02T21:00"')

    expect(shown.day).toContain('type="date"')
    expect(shown.day).toContain('value="2026-09-03"')
  })
})
