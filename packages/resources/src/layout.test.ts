/**
 * A form's arrangement: declared, stored, resolved, put back (ADR-0033).
 */
import {
  ConfigurationError,
  ConflictError,
  collectRevisions,
  createApplication,
  createLogger,
  module,
  permitAll,
  restorerFor,
  silentWriter,
  ValidationError,
} from '@assemora/core'
import {
  boolean as booleanColumn,
  dataTransactions,
  model,
  string as stringColumn,
  useAdapter,
  uuid,
} from '@assemora/data'
import { createMemoryAdapter } from '@assemora/database'
import { beforeEach, describe, expect, it } from 'vitest'

import { richText, text, toggle } from './fields.js'
import { type Layout, layoutIssues, placedFields } from './layout.js'
import { LAYOUT_ENTITY, loadLayouts } from './layout-commands.js'
import { clearResourceRegistry } from './registry.js'
import { resource } from './resource.js'
import { ResourceLayoutModel } from './system-models.js'
import './module.js'

const Article = model('articles', {
  id: uuid().primary().defaultRandom(),
  title: stringColumn(),
  body: stringColumn().nullable(),
  featured: booleanColumn().default(false),
  notes: stringColumn().nullable(),
})

const FIELDS = {
  title: text().required(),
  body: richText(),
  featured: toggle(),
  notes: text().hidden(),
}

const DECLARED: Layout = {
  sections: [{ key: 'content', title: 'Content', fields: ['title', 'body'] }],
  aside: [{ key: 'flags', fields: ['featured'] }],
}

const ARRANGED: Layout = {
  tabs: [
    { key: 'write', label: 'Write', sections: [{ key: 'text', fields: ['title', 'body'] }] },
    { key: 'publish', label: 'Publish', sections: [{ key: 'flags', fields: ['featured'] }] },
  ],
}

const PERSON = { type: 'user', id: '11111111-1111-4111-8111-111111111111' } as const

const build = (layout?: Layout) => {
  const Articles = resource(Article, FIELDS, layout === undefined ? {} : { layout })
  const revisions = collectRevisions()
  const app = createApplication({
    modules: [module('blog').models(Article).resources(Articles)],
    authorization: permitAll(),
    transactions: dataTransactions(),
    revisions,
    logger: createLogger(silentWriter),
  })

  return { app, revisions, Articles }
}

beforeEach(() => {
  clearResourceRegistry()
  useAdapter(createMemoryAdapter())
})

describe('what a layout may say', () => {
  const fields = resource(Article, FIELDS).descriptor.fields

  it('accepts sections alone, tabs alone, and an aside beside either', () => {
    expect(layoutIssues(fields, DECLARED)).toEqual([])
    expect(layoutIssues(fields, ARRANGED)).toEqual([])
  })

  it('refuses a layout with both tabs and sections, or neither', () => {
    expect(layoutIssues(fields, { tabs: [], sections: [] })[0]?.code).toBe('shape')
    expect(layoutIssues(fields, { aside: [] })[0]?.code).toBe('shape')
  })

  it('refuses a field the resource does not have, names it, and says where', () => {
    const issues = layoutIssues(fields, {
      sections: [{ key: 'a', fields: ['title', 'summary'] }],
    })

    expect(issues).toEqual([
      {
        path: ['sections', 0, 'fields', 1],
        code: 'unknown_field',
        message: '"summary" is not a field of this resource',
      },
    ])
  })

  it('refuses a hidden field, because a layout cannot show what hidden hides', () => {
    expect(layoutIssues(fields, { sections: [{ key: 'a', fields: ['notes'] }] })[0]?.code).toBe(
      'hidden',
    )
  })

  it('refuses a field placed twice, a key used twice, and a section with nothing in it', () => {
    const codes = layoutIssues(fields, {
      sections: [
        { key: 'a', fields: ['title', 'title'] },
        { key: 'a', fields: [] },
      ],
    }).map((issue) => issue.code)

    expect(codes).toEqual(['duplicate', 'duplicate', 'empty'])
  })

  it('refuses a width that is not full or half, and a title that says nothing', () => {
    const codes = layoutIssues(fields, {
      sections: [{ key: 'a', title: '   ', fields: [{ field: 'title', width: 'third' as never }] }],
    }).map((issue) => issue.code)

    expect(codes).toEqual(['empty', 'invalid'])
  })

  it('accepts a section shown while a field equals a value, or holds anything', () => {
    expect(
      layoutIssues(fields, {
        sections: [
          { key: 'a', fields: ['title'] },
          { key: 'b', visibleWhen: { field: 'featured', equals: true }, fields: ['body'] },
          { key: 'c', visibleWhen: { field: 'body', present: true }, fields: [] },
        ],
      }).map((issue) => issue.code),
    ).toEqual(['empty'])
  })

  it('refuses a required field in a section a condition hides: the refusal would land on nothing', () => {
    const issues = layoutIssues(fields, {
      sections: [{ key: 'a', visibleWhen: { field: 'featured', equals: true }, fields: ['title'] }],
    })

    expect(issues[0]?.code).toBe('required_hidden')
    expect(issues[0]?.path).toEqual(['sections', 0, 'fields', 0])
  })

  it('refuses a condition on an unknown or hidden field, and one that says neither equals nor present', () => {
    const codes = (visibleWhen: unknown) =>
      layoutIssues(fields, { sections: [{ key: 'a', visibleWhen, fields: ['body'] }] }).map(
        (issue) => issue.code,
      )

    expect(codes({ field: 'summary', equals: 1 })).toEqual(['unknown_field'])
    expect(codes({ field: 'notes', equals: 'x' })).toEqual(['hidden'])
    expect(codes({ field: 'featured' })).toEqual(['shape'])
    expect(codes({ field: 'featured', equals: { deep: true } })).toEqual(['invalid'])
  })

  it('lists what a layout places, in reading order, so the form can add what it left out', () => {
    expect(placedFields(DECLARED)).toEqual(['title', 'body', 'featured'])
    expect(placedFields(ARRANGED)).toEqual(['title', 'body', 'featured'])
  })
})

describe('a declared layout', () => {
  it('is refused where it was written when it does not fit the fields', () => {
    expect(() =>
      resource(Article, FIELDS, { layout: { sections: [{ key: 'a', fields: ['summary'] }] } }),
    ).toThrow(ConfigurationError)
  })

  it('reaches the registry as this resource’s layout, marked declared', async () => {
    const { app } = build(DECLARED)

    await app.boot()

    expect(app.registry.find('layouts', 'articles')).toEqual({
      name: 'articles',
      source: 'declared',
      layout: DECLARED,
    })
  })

  it('leaves no entry for a resource that declared nothing, so Studio derives', async () => {
    const { app } = build()

    await app.boot()

    expect(app.registry.find('layouts', 'articles')).toBeUndefined()
  })
})

describe('resources.arrange', () => {
  const arrange = (app: ReturnType<typeof build>['app'], layout: Layout | null, version?: number) =>
    app.run({ source: 'studio', actor: PERSON }, () =>
      app.commands.execute('resources.arrange', {
        resource: 'articles',
        layout,
        ...(version === undefined ? {} : { expectedVersion: version }),
      }),
    ) as Promise<{ layout: Layout | null; version: number }>

  it('stores the arrangement, puts it in front of the registry over the declaration, and revises it', async () => {
    const { app, revisions } = build(DECLARED)

    await app.boot()

    const written = await arrange(app, ARRANGED)

    expect(written.version).toBe(1)
    expect(app.registry.find('layouts', 'articles')).toMatchObject({
      source: 'stored',
      layout: ARRANGED,
      version: 1,
    })
    expect(revisions.entries[0]).toMatchObject({ entityType: LAYOUT_ENTITY, entityId: 'articles' })
  })

  it('refuses a layout the fields do not fit, as a validation error under `layout`', async () => {
    const { app } = build()

    await app.boot()

    const refused = await arrange(app, {
      sections: [{ key: 'a', fields: ['title', 'summary'] }],
    }).catch((error: unknown) => error)

    expect(refused).toBeInstanceOf(ValidationError)
    expect((refused as ValidationError).issues[0]?.path).toEqual([
      'layout',
      'sections',
      0,
      'fields',
      1,
    ])
  })

  it('refuses a write that states a version the row has moved past (SPEC.md §66)', async () => {
    const { app } = build()

    await app.boot()
    await arrange(app, ARRANGED)

    await expect(arrange(app, DECLARED, 0)).rejects.toBeInstanceOf(ConflictError)
    await expect(arrange(app, DECLARED, 1)).resolves.toMatchObject({ version: 2 })
  })

  it('puts the declaration back for null, removing the row', async () => {
    const { app } = build(DECLARED)

    await app.boot()
    await arrange(app, ARRANGED)

    const back = await arrange(app, null)

    expect(back).toEqual({ resource: 'articles', layout: null, version: 0 })
    expect(await ResourceLayoutModel.count()).toBe(0)
    expect(app.registry.find('layouts', 'articles')).toMatchObject({ source: 'declared' })
  })

  it('is restored to a snapshot, and to nothing, by the one restorer', async () => {
    const { app } = build(DECLARED)

    await app.boot()
    await arrange(app, ARRANGED)

    const restore = restorerFor(LAYOUT_ENTITY)

    if (restore === undefined) throw new Error('no restorer for layouts')

    await app.run({ source: 'studio', actor: PERSON }, () => restore('articles', null))

    expect(app.registry.find('layouts', 'articles')).toMatchObject({ source: 'declared' })

    await app.run({ source: 'studio', actor: PERSON }, () =>
      restore('articles', { layout: ARRANGED }),
    )

    expect(app.registry.find('layouts', 'articles')).toMatchObject({
      source: 'stored',
      layout: ARRANGED,
    })
  })
})

describe('at boot', () => {
  it('applies a stored layout over the declaration, and skips one the fields no longer fit', async () => {
    const first = build(DECLARED)

    await first.app.boot()
    await first.app.run({ source: 'studio', actor: PERSON }, () =>
      first.app.commands.execute('resources.arrange', { resource: 'articles', layout: ARRANGED }),
    )

    // A second application over the same database, the way a restart is.
    clearResourceRegistry()
    const second = build(DECLARED)

    await second.app.boot()

    expect(second.app.registry.find('layouts', 'articles')).toMatchObject({
      source: 'stored',
      layout: ARRANGED,
    })

    // The row outlives a field: the declaration is drawn, and the row is kept.
    clearResourceRegistry()
    const Narrow = resource(Article, { title: text().required() }, { name: 'articles' })
    const third = createApplication({
      modules: [module('blog').models(Article).resources(Narrow)],
      authorization: permitAll(),
      transactions: dataTransactions(),
      logger: createLogger(silentWriter),
    })

    await third.boot()

    expect(third.registry.find('layouts', 'articles')).toBeUndefined()
    expect(await ResourceLayoutModel.count()).toBe(1)
  })

  it('reports the table as pending when it does not exist yet, rather than failing the boot', async () => {
    const adapter = createMemoryAdapter()
    // `all()` against a table the adapter was never told about answers as the
    // PostgreSQL adapter does for one that was not migrated.
    const { app } = build()

    useAdapter(adapter)
    await app.boot()

    const outcome = await loadLayouts(app.registry, createLogger(silentWriter))

    expect(outcome.pending).toBe(false)
  })
})
