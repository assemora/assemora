import { describe, expect, it } from 'vitest'

import type { CollectionDefinition } from '../api/collections.ts'
import { translator } from '../i18n/messages.ts'
import {
  FIELD_NAME_PATTERN,
  groupedKinds,
  KINDS,
  kindsAt,
  kindsOf,
  NAME_PATTERN,
  NESTING_DEPTH,
  needOf,
  nestingDepthOf,
} from './contract.ts'
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
  shaped,
  specOf,
  storedField,
  storedInside,
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

/** The shape every content model has: a repeater of groups, and a group of its own. */
const nested: CollectionDefinition = {
  name: 'landing',
  fields: [
    {
      name: 'author',
      kind: 'object',
      fields: [
        { name: 'name', kind: 'text', required: true },
        { name: 'site', kind: 'url' },
      ],
    },
    {
      name: 'sections',
      kind: 'array',
      element: { kind: 'object', fields: [{ name: 'heading', kind: 'text' }] },
    },
  ],
}

const context = {
  // English, because these assertions are about which refusal is raised rather than
  // about how it reads. The catalogue's own suite covers the other two languages.
  t: translator('en'),
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
    // A new collection starts with no rows at all — the presets are what fills it — and
    // a row that was not read from a definition is the one that carries no stored name.
    expect(emptyDraft().fields).toEqual([])
    expect(blankField('one').stored).toBeUndefined()
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
    const shorter = draft(without(draftOf(stored).fields, 'stored.rating'), 'testimonials')

    expect(removals(stored, shorter)).toEqual(['rating'])
    expect(payloadOf(shorter, stored).drop).toEqual(['rating'])
  })

  it('sends no "drop" when nothing left', () => {
    expect(payloadOf(draftOf(stored), stored).drop).toBeUndefined()
  })

  it('still calls it a removal when a new field takes the same name back', () => {
    const rewritten = draft(
      [
        ...without(draftOf(stored).fields, 'stored.rating'),
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

    expect(named(moved(fields, 'stored.rating', -1))).toEqual(['author', 'rating', 'quote'])
    expect(named(moved(fields, 'stored.author', 1))).toEqual(['quote', 'author', 'rating'])
  })

  it('does not move past either end', () => {
    const fields = draftOf(stored).fields

    expect(moved(fields, 'stored.author', -1)).toBe(fields)
    expect(moved(fields, 'stored.rating', 1)).toBe(fields)
    expect(moved(fields, 'nobody', 1)).toBe(fields)
  })
})

describe('what an edit may no longer change', () => {
  /** The stored spec a row came from, which is what the locks are read against. */
  const before = (name: string) => storedField(stored, row(draftOf(stored).fields, name))

  it('freezes a stored field name always: there is no rename', () => {
    expect(locksOf(row(draftOf(stored).fields, 'author'), before('author'), 0).name).toBe(true)
    expect(locksOf(blankField('new:1'), undefined, 0).name).toBe(false)
  })

  it('freezes the kind only while entries exist', () => {
    expect(locksOf(row(draftOf(stored).fields, 'author'), before('author'), 0).kind).toBe(false)
    expect(locksOf(row(draftOf(stored).fields, 'author'), before('author'), 3).kind).toBe(true)
  })

  it('locks the options an entry may hold, and only those', () => {
    const select = row(draftOf(stored).fields, 'rating')

    expect(locksOf(select, before('rating'), 3).options).toEqual(['1', '2', '3'])
    expect(locksOf(select, before('rating'), 0).options).toEqual([])
    // A kind that is being changed has no options to protect: the change itself is
    // refused, and saying both would say one thing twice.
    expect(locksOf({ ...select, kind: 'text' }, before('rating'), 3).options).toEqual([])
  })

  /**
   * The rule `insideIssues` in `@assemora/resources` states: a nested field cannot be
   * removed while entries exist at all. `object()` keeps only the keys its shape
   * mentions, so the next ordinary save of an entry would delete the value rather than
   * leave it behind, and `drop` names a collection's own fields with no way to name this
   * one. A top-level field is different, which is what `drop` is for.
   */
  it('keeps a stored nested field where a top-level one may be dropped', () => {
    const inner = row(draftOf(nested).fields, 'author').fields
    const name = row(inner, 'name')

    expect(locksOf(name, storedInside(nested.fields[0], name), 2, true).kept).toBe(true)
    expect(locksOf(name, storedInside(nested.fields[0], name), 0, true).kept).toBe(false)
    expect(
      locksOf(
        row(draftOf(nested).fields, 'author'),
        storedField(nested, row(draftOf(nested).fields, 'author')),
        2,
      ).kept,
    ).toBe(false)
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
    const fresh = issuesOf(emptyDraft(), context)

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

  /**
   * `object` and `array` used to be a TypeScript privilege: they had builders and no
   * registration, so a collection made in Studio could not have a group or a repeater —
   * the two shapes every content model needs. Both are registered now, and the fallback
   * has to say so, because it is what a form offers when the schema publishes no enum.
   */
  it('offer the group and the repeater a definition can now name', () => {
    expect(KINDS).toContain('object')
    expect(KINDS).toContain('array')
  })

  it('know which kinds need more than a name', () => {
    expect(needOf('select')).toBe('options')
    expect(needOf('checkboxes')).toBe('options')
    expect(needOf('code')).toBe('languages')
    expect(needOf('slug')).toBe('source')
    expect(needOf('relation')).toBe('target')
    expect(needOf('media')).toBe('accept')
    expect(needOf('object')).toBe('fields')
    expect(needOf('array')).toBe('element')
    expect(needOf('text')).toBeUndefined()
    // A table's columns are part of its *value*, so there is nothing to declare here.
    expect(needOf('table')).toBeUndefined()
  })

  it('are grouped for reading, with anything unrecognised still offered', () => {
    const groups = groupedKinds(['text', 'array', 'wormhole'])

    // The key rather than the words: a heading is drawn in whatever language Studio is
    // being read in, and what this pins is which group a kind lands in.
    expect(groups.map((group) => group.label)).toEqual([
      'collections.kinds.text',
      'collections.kinds.several',
      'collections.kinds.other',
    ])
    expect(groups.flatMap((group) => group.kinds)).toEqual(['text', 'array', 'wormhole'])
  })
})

/**
 * The bound in the form and the bound in the parser are one number, and this is where
 * they are held together.
 *
 * `shapeSpecAt` in `@assemora/resources` unrolls the spec schema one level per depth and
 * puts a schema that always refuses at the bottom, so the depth is a thing that can be
 * counted off the published document rather than agreed on twice.
 */
describe('how deep a definition may nest', () => {
  const published = (depth: number) => {
    const floor = { description: 'Nesting is limited', not: {} }
    const level = (left: number): Record<string, unknown> => ({
      properties: {
        kind: { type: 'string' },
        fields: left <= 1 ? floor : { type: 'array', items: level(left - 1) },
      },
    })

    return {
      name: 'collections.create',
      input: { properties: { fields: { type: 'array', items: level(depth) } } },
    }
  }

  it('is counted off the command\u2019s own schema', () => {
    expect(nestingDepthOf(published(3))).toBe(3)
    expect(nestingDepthOf(published(1))).toBe(1)
  })

  it('falls back only when the schema describes no field at all', () => {
    expect(nestingDepthOf(undefined)).toBe(NESTING_DEPTH)
    expect(nestingDepthOf({ name: 'collections.create', input: {} })).toBe(NESTING_DEPTH)
  })

  it('stops offering a group one level before the command starts refusing one', () => {
    const kinds = ['text', 'object', 'array', 'slug']

    expect(kindsAt(kinds, 1, 3, false)).toEqual(kinds)
    expect(kindsAt(kinds, 2, 3, true)).toEqual(['text', 'object', 'array'])
    // At the deepest level a field holds one value: the command accepts the keys and
    // refuses every value under them, so the form does not offer the kinds that need one.
    expect(kindsAt(kinds, 3, 3, true)).toEqual(['text'])
  })
})

describe('a group and a repeater', () => {
  it('reads a stored definition the whole way down', () => {
    const draft = draftOf(nested)
    const author = row(draft.fields, 'author')
    const sections = row(draft.fields, 'sections')

    expect(named(author.fields)).toEqual(['name', 'site'])
    expect(author.fields.map((field) => field.stored)).toEqual(['name', 'site'])
    expect(sections.element?.kind).toBe('object')
    expect(named(sections.element?.fields ?? [])).toEqual(['heading'])
  })

  it('gives every row in the tree a key of its own', () => {
    const draft = draftOf(nested)
    const keys = (fields: readonly FieldDraft[]): readonly string[] =>
      fields.flatMap((field) => [
        field.key,
        ...keys(field.fields),
        ...(field.element === undefined ? [] : keys([field.element])),
      ])

    expect(new Set(keys(draft.fields)).size).toBe(keys(draft.fields).length)
    expect(keys(draft.fields)).toContain('stored.author.name')
    expect(keys(draft.fields)).toContain('stored.sections.element')
  })

  it('changes, removes and reorders a row wherever it lives', () => {
    const fields = draftOf(nested).fields
    const renamed = patched(fields, 'stored.author.name', { label: 'Full name' })

    expect(row(row(renamed, 'author').fields, 'name').label).toBe('Full name')
    expect(named(without(fields, 'stored.author.site')[0]?.fields ?? [])).toEqual(['name'])
    expect(named(moved(fields, 'stored.author.site', -1)[0]?.fields ?? [])).toEqual([
      'site',
      'name',
    ])
    // A no-op move leaves the tree exactly as it was rather than rebuilding it.
    expect(moved(fields, 'stored.author.name', -1)).toBe(fields)
  })

  it('sends the nesting back the way the command takes it', () => {
    expect(payloadOf(draftOf(nested), nested).fields).toEqual(nested.fields)
  })

  /**
   * `object()` and `array()` refuse `searchable` and `filterable` inside a value —
   * search and filtering address a resource field by name and never reach in — so a row
   * that cannot offer them must not send them either.
   */
  it('sends no flag inside a group that the command refuses there', () => {
    const draft = draftOf(nested)
    const claiming = patched(draft.fields, 'stored.author.name', {
      searchable: true,
      filterable: true,
    })

    expect(specOf(row(claiming, 'author')).fields).toEqual([
      { name: 'name', kind: 'text', required: true },
      { name: 'site', kind: 'url' },
    ])
  })

  it('makes what the kind cannot exist without the moment the kind is chosen', () => {
    const one = blankField('new:1')
    const keys = () => 'new:2'

    expect(shaped(one, 'object', keys).fields).toHaveLength(1)
    expect(shaped(one, 'array', keys).element?.kind).toBe('text')
    expect(shaped(one, 'text', keys)).toEqual({ kind: 'text' })
  })

  it('asks for a name and a kind inside a group exactly as it does outside one', () => {
    const draft = draftOf(nested)
    const broken = patched(draft.fields, 'stored.author.site', { name: '1nvalid' })
    const messages = issuesOf(
      { name: 'landing', label: '', fields: broken },
      { ...context, stored: nested, taken: [] },
    )

    expect(messages.map((issue) => issue.key)).toEqual(['stored.author.site'])
    expect(messages[0]?.message).toContain('not a name a field can have')
  })

  it('asks a repeater what one item is, and a group what is in it', () => {
    const empty = [
      { ...blankField('a', 'object'), name: 'author' },
      { ...blankField('b', 'array'), name: 'sections' },
    ]
    const messages = issuesOf(draft(empty), context).map((issue) => issue.message)

    expect(messages).toEqual([
      'A group needs at least one field.',
      'A repeater needs to say what one item is.',
    ])
  })
})
