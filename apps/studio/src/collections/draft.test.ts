import { describe, expect, it } from 'vitest'

import type { CollectionDefinition } from '../api/collections.ts'
import { FIELD_NAME_PATTERN, KINDS, kindsOf, NAME_PATTERN, needOf } from './contract.ts'
import {
  blankField,
  type CollectionDraft,
  draftOf,
  emptyDraft,
  type FieldDraft,
  issuesOf,
  locksOf,
  moved,
  nameFrom,
  patched,
  payloadOf,
  removals,
  specOf,
  without,
} from './draft.ts'

const stored: CollectionDefinition = {
  name: 'testimonials',
  label: 'Testimonials',
  fields: [
    { name: 'author', kind: 'text', required: true, searchable: true },
    { name: 'quote', kind: 'textarea', required: true },
    { name: 'rating', kind: 'select', options: ['1', '2', '3'] },
  ],
}

const context = {
  stored: undefined,
  taken: ['articles'],
  dropped: [],
  entries: 0,
  namePattern: NAME_PATTERN,
  fieldNamePattern: FIELD_NAME_PATTERN,
} as const

const draft = (fields: readonly FieldDraft[], name = 'notes'): CollectionDraft => ({
  name,
  label: '',
  fields,
})

const row = (fields: readonly FieldDraft[], name: string): FieldDraft => {
  const found = fields.find((field) => field.name === name)

  if (found === undefined) throw new Error(`no field called ${name}`)

  return found
}

const named = (fields: readonly FieldDraft[]): readonly string[] =>
  fields.map((field) => field.name)

describe('a draft of a stored definition', () => {
  it('remembers which fields are stored, because those are the ones holding values', () => {
    expect(draftOf(stored).fields.map((field) => field.stored)).toEqual([
      'author',
      'quote',
      'rating',
    ])
    expect(emptyDraft('one').fields.map((field) => field.stored)).toEqual([undefined])
  })

  it('gives every row a key that survives a rename', () => {
    const renamed = patched([blankField('new:1')], 'new:1', { name: 'author' })

    expect(renamed.map((field) => field.key)).toEqual(['new:1'])
    expect(named(renamed)).toEqual(['author'])
  })
})

describe('what is sent', () => {
  it('carries only what the kind needs, so a select turned into text loses its options', () => {
    const select = row(draftOf(stored).fields, 'rating')

    expect(specOf(select).options).toEqual(['1', '2', '3'])
    expect(specOf({ ...select, kind: 'text' }).options).toBeUndefined()
  })

  it('drops the flags nobody set rather than sending false', () => {
    expect(specOf(blankField('x'))).toEqual({ name: '', kind: 'text' })
  })

  /**
   * The bug this covers: the form offered a `sortable` checkbox and sent the flag, and
   * `entries.list` refuses to order a collection by anything but the entry's own
   * columns (ADR-0012) — so the one control that flag switched on could only ever
   * replace the list with a 422. Studio no longer writes the claim into a definition,
   * including one that arrived carrying it.
   */
  it('sends no sortable flag, because no collection can honour one', () => {
    const claiming: CollectionDefinition = {
      name: 'testimonials',
      fields: [{ name: 'author', kind: 'text', sortable: true, searchable: true }],
    }

    expect(specOf(row(draftOf(claiming).fields, 'author'))).toEqual({
      name: 'author',
      kind: 'text',
      searchable: true,
    })
    expect(payloadOf(draftOf(claiming), claiming).fields).toEqual([
      { name: 'author', kind: 'text', searchable: true },
    ])
  })

  it('names every removal in "drop", because a silent one is refused', () => {
    const shorter = draft(without(draftOf(stored).fields, 'stored:rating'), 'testimonials')

    expect(removals(stored, shorter)).toEqual(['rating'])
    expect(payloadOf(shorter, stored).drop).toEqual(['rating'])
  })

  it('sends no "drop" when nothing left', () => {
    expect(payloadOf(draftOf(stored), stored).drop).toBeUndefined()
  })

  it('still calls it a removal when a new field takes the same name back', () => {
    const rewritten = draft(
      [
        ...without(draftOf(stored).fields, 'stored:rating'),
        { ...blankField('new:1', 'text'), name: 'rating' },
      ],
      'testimonials',
    )

    // The values are keyed by name and do not travel: this is a removal and an
    // addition, which is exactly what the command will be told.
    expect(removals(stored, rewritten)).toEqual(['rating'])
  })
})

describe('reordering', () => {
  it('moves a row and leaves the rest in order', () => {
    const fields = draftOf(stored).fields

    expect(named(moved(fields, 'stored:rating', -1))).toEqual(['author', 'rating', 'quote'])
    expect(named(moved(fields, 'stored:author', 1))).toEqual(['quote', 'author', 'rating'])
  })

  it('does not move past either end', () => {
    const fields = draftOf(stored).fields

    expect(moved(fields, 'stored:author', -1)).toBe(fields)
    expect(moved(fields, 'stored:rating', 1)).toBe(fields)
    expect(moved(fields, 'nobody', 1)).toBe(fields)
  })
})

describe('what an edit may no longer change', () => {
  it('freezes a stored field name always: there is no rename', () => {
    expect(locksOf(row(draftOf(stored).fields, 'author'), stored, 0).name).toBe(true)
    expect(locksOf(blankField('new:1'), stored, 0).name).toBe(false)
  })

  it('freezes the kind only while entries exist', () => {
    expect(locksOf(row(draftOf(stored).fields, 'author'), stored, 0).kind).toBe(false)
    expect(locksOf(row(draftOf(stored).fields, 'author'), stored, 3).kind).toBe(true)
  })

  it('locks the options an entry may hold, and only those', () => {
    const select = row(draftOf(stored).fields, 'rating')

    expect(locksOf(select, stored, 3).options).toEqual(['1', '2', '3'])
    expect(locksOf(select, stored, 0).options).toEqual([])
    // A kind that is being changed has no options to protect: the change itself is
    // refused, and saying both would say one thing twice.
    expect(locksOf({ ...select, kind: 'text' }, stored, 3).options).toEqual([])
  })
})

describe('what is refused, said before it is sent', () => {
  const messages = (fields: readonly FieldDraft[], name?: string) =>
    issuesOf(draft(fields, name), context).map((issue) => issue.message)

  it('wants a name, and a name of the shape the command published', () => {
    expect(messages([blankField('x')], '').join()).toContain('needs a name')
    expect(messages([blankField('x')], 'Not Valid').join()).toContain('not a name a collection')
  })

  it('refuses a name a resource already answers to, source declarations included', () => {
    expect(messages([blankField('x')], 'articles').join()).toContain('already a resource')
  })

  it('does not refuse the collection its own name while it is being edited', () => {
    const editing = { ...context, stored, taken: ['articles', 'testimonials'] }

    expect(issuesOf(draftOf(stored), editing)).toEqual([])
  })

  it('refuses two fields of one name', () => {
    const twice = [
      { ...blankField('a'), name: 'title' },
      { ...blankField('b'), name: 'title' },
    ]

    expect(issuesOf(draft(twice), context).map((issue) => issue.key)).toEqual(['b'])
  })

  it('asks for what a kind cannot be built without', () => {
    const needy = [
      { ...blankField('a', 'select'), name: 'rating' },
      { ...blankField('b', 'slug'), name: 'path' },
      { ...blankField('c', 'relation'), name: 'author' },
    ]

    expect(messages(needy)).toEqual([
      'A select field needs at least one option.',
      'A slug field needs a source field.',
      'A relation field needs a target resource.',
    ])
  })

  // `rating` was taken out by an earlier edit, so the definition no longer declares it
  // and every entry still holds whatever it held under that name.
  const afterDrop: CollectionDefinition = {
    ...stored,
    fields: stored.fields.filter((field) => field.name !== 'rating'),
  }

  const reusing = (entries: number) => {
    const fields = [...draftOf(afterDrop).fields, { ...blankField('new:1'), name: 'rating' }]

    return issuesOf(draft(fields, 'testimonials'), {
      ...context,
      stored: afterDrop,
      dropped: ['rating'],
      entries,
    })
  }

  it('refuses a new field taking a name whose values are still stored', () => {
    expect(reusing(2).map((issue) => issue.key)).toEqual(['new:1'])
  })

  it('allows that name again once the collection is empty', () => {
    expect(reusing(0)).toEqual([])
  })

  it('calls a fresh form’s issues blank, so opening one is not being shouted at', () => {
    const fresh = issuesOf(emptyDraft('new:0'), context)

    expect(fresh.length).toBeGreaterThan(0)
    expect(fresh.every((issue) => issue.blank === true)).toBe(true)
  })

  it('says which half of the form a collection-level issue belongs under', () => {
    const halves = (fields: readonly FieldDraft[], name: string) =>
      issuesOf(draft(fields, name), context)
        .filter((issue) => issue.key === undefined)
        .map((issue) => issue.about)

    expect(halves([], 'notes')).toEqual(['fields'])
    expect(halves([{ ...blankField('x'), name: 'title' }], 'articles')).toEqual(['name'])
  })

  it('never calls a wrong value blank: it is wrong as soon as it is typed', () => {
    const wrong = [
      ...issuesOf(draft([{ ...blankField('x'), name: 'ok' }], 'Not Valid'), context),
      ...issuesOf(draft([{ ...blankField('x'), name: '1nvalid' }], 'notes'), context),
    ]

    expect(wrong.length).toBe(2)
    expect(wrong.some((issue) => issue.blank === true)).toBe(false)
  })
})

describe('the name suggested from a label', () => {
  it('is one the command accepts', () => {
    expect(nameFrom('Case studies')).toBe('case_studies')
    expect(nameFrom('Café notes')).toBe('cafe_notes')
    expect(new RegExp(NAME_PATTERN).test(nameFrom('Testimonials'))).toBe(true)
  })
})

describe('the kinds offered', () => {
  it('are the ones the application declares, when it declares them', () => {
    const declared = {
      name: 'collections.create',
      input: {
        properties: { fields: { items: { properties: { kind: { enum: ['text', 'wormhole'] } } } } },
      },
    }

    expect(kindsOf(declared)).toEqual(['text', 'wormhole'])
  })

  it('fall back to the registered ones when the schema says only "a string"', () => {
    expect(kindsOf({ name: 'collections.create', input: { properties: {} } })).toBe(KINDS)
    expect(kindsOf(undefined)).toBe(KINDS)
  })

  it('never offer a kind that cannot be built from stored JSON', () => {
    expect(KINDS).not.toContain('object')
    expect(KINDS).not.toContain('array')
  })

  it('know which kinds need more than a name', () => {
    expect(needOf('select')).toBe('options')
    expect(needOf('slug')).toBe('source')
    expect(needOf('relation')).toBe('target')
    expect(needOf('text')).toBeUndefined()
  })
})
