import {
  type Application,
  clearRestorers,
  command,
  createApplication,
  createLogger,
  type LogRecord,
  module,
  type Preview,
  permitAll,
  publishGeneratedCrud,
  query,
  type RevisionEntry,
  restorerFor,
} from '@assemora/core'
import { dataTransactions, model, string as stringColumn, useAdapter, uuid } from '@assemora/data'
import { createMemoryAdapter, type MemoryAdapter } from '@assemora/database'
import { string as stringSchema, unknown as unknownSchema } from '@assemora/schema'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { collections } from './collection-module.js'
import { clearCollections, collectionByName } from './collections.js'
import { registeredFieldKinds } from './field-registry.js'
import { text } from './fields.js'
import { clearResourceRegistry, registeredResources } from './registry.js'
import { resource } from './resource.js'
import { ResourceDefinitionModel, ResourceEntryModel } from './system-models.js'
import './module.js'

const Article = model('articles', {
  id: uuid().primary().defaultRandom(),
  title: stringColumn(),
})

const Articles = resource(Article, { title: text().required() })

const testimonials = {
  name: 'testimonials',
  label: 'Testimonials',
  fields: [
    { name: 'author', kind: 'text', required: true },
    { name: 'quote', kind: 'textarea', required: true },
    { name: 'rating', kind: 'number' },
  ],
}

let adapter: MemoryAdapter
let logs: LogRecord[]
let revisions: RevisionEntry[]

/**
 * A command whose handler previews other commands, which is what `changesets.propose`
 * is (SPEC.md §75) — and this package may not depend on `@assemora/change-sets`.
 */
const Propose = command('proposals.make', {
  description: 'Previews a command from inside a command',
  input: { command: stringSchema(), input: unknownSchema() },
  handle: async ({ command: name, input }, context) => context.preview([{ command: name, input }]),
})

/**
 * Stands in for `@assemora/revisions`, which this package may not depend on either.
 *
 * Only the *names* matter here: a command name is a permission name (ADR-0015), so
 * these two are what makes `revisions` a subject somebody can hold `revisions.*` on.
 */
const RestoreRevision = command('revisions.restore', {
  description: 'Nothing. It is here for its name.',
  input: { id: stringSchema() },
  handle: async ({ id }) => ({ id }),
})

const ListRevisions = query('revisions.list', {
  description: 'Nothing. It is here for its name.',
  input: {},
  handle: async () => [],
})

type Built = { readonly app: Application }

const build = async (
  options: {
    readonly statics?: boolean
    readonly proposals?: boolean
    readonly history?: boolean
  } = {},
): Promise<Built> => {
  const app = createApplication({
    modules: [
      ...(options.statics === true ? [module('blog').resources(Articles)] : []),
      ...(options.proposals === true ? [module('proposals').commands(Propose)] : []),
      ...(options.history === true
        ? [module('history').commands(RestoreRevision).queries(ListRevisions)]
        : []),
      collections(),
    ],
    authorization: permitAll(),
    transactions: dataTransactions(),
    revisions: {
      record: async (entries) => {
        revisions.push(...entries)
      },
    },
    logger: createLogger((record) => {
      logs.push(record)
    }),
  })

  await app.boot()

  return { app }
}

const create = (app: Application, input: unknown) =>
  app.commands.execute('collections.create', input)

const entry = (app: Application, resourceName: string, data: Record<string, unknown>) =>
  app.commands.execute('entries.create', { resource: resourceName, data }) as Promise<{
    id: string
  }>

beforeEach(() => {
  clearResourceRegistry()
  clearCollections()
  clearRestorers()
  // Nothing here serves HTTP, so nothing here publishes generated REST paths — which is
  // the truth of this process, of a worker and of a CLI run alike (SPEC.md §43). A test
  // about the addresses a collection gets says so itself.
  publishGeneratedCrud()
  adapter = createMemoryAdapter()
  useAdapter(adapter)
  logs = []
  revisions = []
})

afterEach(() => {
  clearCollections()
})

describe('creating a collection (SPEC.md §37)', () => {
  it('stores the definition and registers the resource', async () => {
    const { app } = await build()

    const answer = (await create(app, testimonials)) as {
      id: string
      name: string
      resource: { kind: string; fields: readonly unknown[] }
    }

    expect(answer.name).toBe('testimonials')
    expect(answer.resource.kind).toBe('dynamic')
    expect(answer.resource.fields).toHaveLength(3)

    expect(adapter.rows('assemora_resource_definitions')).toHaveLength(1)
    expect(app.registry.find('resources', 'testimonials')).toMatchObject({ kind: 'dynamic' })
    expect(registeredResources().map((each) => each.name)).toContain('testimonials')
    expect(collectionByName('testimonials')?.id).toBe(answer.id)
  })

  it('accepts entries through the same commands a static resource uses (ADR-0012)', async () => {
    const { app } = await build()
    await create(app, testimonials)

    const created = await entry(app, 'testimonials', { author: 'Ada', quote: 'It works' })
    const listed = (await app.queries.execute('entries.list', { resource: 'testimonials' })) as {
      total: number
    }

    expect(created.id).toBeTypeOf('string')
    expect(listed.total).toBe(1)
  })

  it('says where the collection can be reached, and promises no restart (SPEC.md §43)', async () => {
    const { app } = await build()

    // What a server that mounts generated CRUD says about itself.
    publishGeneratedCrud('/api')

    const answer = (await create(app, testimonials)) as { note: string }

    expect(answer.note).toContain('entries.create')
    // Named rather than alluded to: "under this API prefix" left the reader — a person
    // about to call it, an agent about to generate the call — to guess the prefix.
    expect(answer.note).toContain('GET /testimonials, GET /testimonials/:id')
    expect(answer.note).toContain('below /api')
    expect(answer.note).toContain('No restart')
    // The sentence this replaced promised REST paths "when the server starts", and they
    // never came. Nothing in this answer may send a caller away to wait for one.
    expect(answer.note).not.toContain('next restart')
  })

  /**
   * The other half of §43, and the half the sentence used to get wrong.
   *
   * `api: { crud: false }` publishes no generated REST paths at all — the option
   * recommends itself for resources that should answer only under a version, and a
   * version carries the resources named when it was declared, so a collection can never
   * join one. Built from the collection's own flags, the note named five addresses that
   * answered Fastify's bare 404. It is a command, therefore an MCP tool by generation,
   * so an agent read it and called them.
   */
  it('promises no REST path this application does not publish (SPEC.md §43)', async () => {
    const { app } = await build()

    const answer = (await create(app, testimonials)) as { note: string }

    // Everything that does not depend on a server is unchanged and still said.
    expect(answer.note).toContain('entries.create')
    expect(answer.note).toContain('publishes no generated REST paths')
    expect(answer.note).not.toContain('GET /testimonials')
    expect(answer.note).not.toContain('No restart')
  })

  /**
   * The `api` flags of SPEC.md §43 taken to their end, which is a collection nothing
   * can reach.
   *
   * `collections.create` is a command, therefore an MCP tool by generation, and this
   * answer is the only thing that will ever tell whoever made it. Built from the open
   * operations alone, the sentence read "Reachable now through , so Studio, an agent
   * over MCP and the API Explorer already have it" — a success message for a resource
   * with no way in at all.
   */
  it('says so when every api flag is off and nothing can reach it (SPEC.md §43)', async () => {
    const { app } = await build()

    publishGeneratedCrud('/api')

    const answer = (await create(app, {
      ...testimonials,
      api: { create: false, read: false, update: false, delete: false },
    })) as { note: string }

    expect(answer.note).toContain('It has no operations at all')
    expect(answer.note).toContain('That is almost certainly not what was meant.')
    expect(answer.note).not.toContain('Reachable now')
    // And the REST half says the same thing rather than listing nothing: there are no
    // published addresses to name, and all five answer 404.
    expect(answer.note).toContain('Every /api/testimonials address answers 404.')
  })

  it('derives a label when none is given', async () => {
    const { app } = await build()

    const answer = (await create(app, {
      name: 'case_studies',
      fields: [{ name: 'title', kind: 'text' }],
    })) as { resource: { label: string } }

    expect(answer.resource.label).toBe('Case studies')
  })

  it('leaves a revision, so the definition has a history like any other change', async () => {
    const { app } = await build()
    await create(app, testimonials)

    expect(revisions).toHaveLength(1)
    expect(revisions[0]).toMatchObject({
      entityType: 'collections',
      command: 'collections.create',
      before: null,
    })
  })

  it('registers nothing when the transaction is undone (SPEC.md §73, ADR-0023)', async () => {
    const { app } = await build()

    const preview = await app.commands.dryRun('collections.create', testimonials)

    expect(preview.changes).toHaveLength(1)
    expect(adapter.rows('assemora_resource_definitions')).toHaveLength(0)
    // The row was rolled back, so the registries must not be holding a collection
    // nobody committed.
    expect(app.registry.find('resources', 'testimonials')).toBeUndefined()
    expect(collectionByName('testimonials')).toBeUndefined()
  })
})

describe('a definition is untrusted data (SPEC.md §86)', () => {
  it('refuses a field kind nobody registered', async () => {
    const { app } = await build()

    await expect(
      create(app, { name: 'evil', fields: [{ name: 'x', kind: 'summonDemon' }] }),
    ).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
      fields: { 'fields.0.kind': ['"summonDemon" is not a known field kind'] },
    })

    expect(adapter.rows('assemora_resource_definitions')).toHaveLength(0)
  })

  it('drops a function riding along in the JSON rather than storing it', async () => {
    const { app } = await build()

    await create(app, {
      name: 'notes',
      fields: [
        {
          name: 'body',
          kind: 'text',
          validate: 'eval("process.exit(1)")',
          onSave: () => 'never called',
        },
      ],
    })

    const [row] = adapter.rows('assemora_resource_definitions')

    expect(JSON.stringify(row)).not.toContain('eval')
    expect(JSON.stringify(row)).not.toContain('onSave')

    const stored = row?.schema as { fields: readonly unknown[] } | undefined

    expect(stored?.fields[0]).toEqual({ name: 'body', kind: 'text' })
  })

  it('refuses a function where a string belongs', async () => {
    const { app } = await build()

    await expect(
      create(app, { name: 'notes', fields: [{ name: 'body', kind: 'text', label: () => 'x' }] }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' })
  })

  it('refuses a __proto__ field name and pollutes nothing', async () => {
    const { app } = await build()

    await expect(
      create(app, { name: 'notes', fields: [{ name: '__proto__', kind: 'text' }] }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' })

    await create(app, {
      name: 'notes',
      fields: [{ name: 'body', kind: 'text' }],
      __proto__: { polluted: true },
    })

    expect(({} as Record<string, unknown>).polluted).toBeUndefined()
    expect(collectionByName('notes')?.definition).not.toHaveProperty('polluted')
  })

  it('refuses two fields of one name', async () => {
    const { app } = await build()

    await expect(
      create(app, {
        name: 'notes',
        fields: [
          { name: 'body', kind: 'text' },
          { name: 'body', kind: 'number' },
        ],
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' })
  })

  it('refuses a name that is not a name', async () => {
    const { app } = await build()

    for (const name of ['Not Valid', '1bad', 'has-dash', '']) {
      await expect(
        create(app, { name, fields: [{ name: 'body', kind: 'text' }] }),
      ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' })
    }
  })

  it('demands at least one field', async () => {
    const { app } = await build()

    await expect(create(app, { name: 'empty', fields: [] })).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    })
  })
})

describe('a name something else already answers to', () => {
  it('refuses a collection that would shadow a static resource', async () => {
    const { app } = await build({ statics: true })

    await expect(
      create(app, { name: 'articles', fields: [{ name: 'title', kind: 'text' }] }),
    ).rejects.toMatchObject({ code: 'RESOURCE_NAME_TAKEN', status: 409 })

    expect(adapter.rows('assemora_resource_definitions')).toHaveLength(0)
  })

  it('refuses a second collection of the same name', async () => {
    const { app } = await build()
    await create(app, testimonials)

    await expect(create(app, testimonials)).rejects.toMatchObject({
      code: 'RESOURCE_NAME_TAKEN',
    })
  })

  it('refuses a name whose generated REST paths a route already serves', async () => {
    const { app } = await build()

    // Described the way `@assemora/http` describes one; this package may not import it.
    app.registry.register(
      'routes' as 'commands',
      {
        name: 'get:/quotes/:id',
        method: 'get',
        path: '/quotes/:id',
        input: { type: 'object' },
      } as never,
    )

    await expect(
      create(app, { name: 'quotes', fields: [{ name: 'body', kind: 'text' }] }),
    ).rejects.toMatchObject({ code: 'RESOURCE_NAME_TAKEN' })

    // A static segment and a parameter can share a position, so this one is fine.
    app.registry.register(
      'routes' as 'commands',
      {
        name: 'get:/notes/by-slug/:slug',
        method: 'get',
        path: '/notes/by-slug/:slug',
        input: { type: 'object' },
      } as never,
    )

    await expect(
      create(app, { name: 'notes', fields: [{ name: 'body', kind: 'text' }] }),
    ).resolves.toMatchObject({ name: 'notes' })
  })
})

describe('changing a collection (SPEC.md §37, the questions that are actually hard)', () => {
  const update = (app: Application, input: unknown) =>
    app.commands.execute('collections.update', input)

  it('changes the label freely', async () => {
    const { app } = await build()
    await create(app, testimonials)

    await update(app, { ...testimonials, label: 'What people say' })

    expect(app.registry.find('resources', 'testimonials')?.label).toBe('What people say')
  })

  it('adds a field, and existing entries stay readable', async () => {
    const { app } = await build()
    await create(app, testimonials)
    const created = await entry(app, 'testimonials', { author: 'Ada', quote: 'It works' })

    await update(app, {
      ...testimonials,
      fields: [...testimonials.fields, { name: 'company', kind: 'text' }],
    })

    const found = (await app.queries.execute('entries.get', {
      resource: 'testimonials',
      id: created.id,
    })) as Record<string, unknown>

    expect(found).toMatchObject({ author: 'Ada' })
    expect(app.registry.find('resources', 'testimonials')?.fields).toHaveLength(4)
  })

  it('refuses a field that quietly falls out of the list', async () => {
    const { app } = await build()
    await create(app, testimonials)

    await expect(
      update(app, { ...testimonials, fields: testimonials.fields.slice(0, 2) }),
    ).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
      fields: { fields: [expect.stringContaining('"rating" is no longer declared')] },
    })
  })

  it('refuses a "drop" that is not removing anything', async () => {
    const { app } = await build()
    await create(app, testimonials)

    await expect(update(app, { ...testimonials, drop: ['rating'] })).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
      fields: { 'drop.0': ['"rating" is named in "drop" but is not being removed.'] },
    })
  })

  it('drops a named field and leaves its values in the JSONB', async () => {
    const { app } = await build()
    await create(app, testimonials)
    const created = await entry(app, 'testimonials', {
      author: 'Ada',
      quote: 'It works',
      rating: 5,
    })

    const answer = (await update(app, {
      ...testimonials,
      fields: testimonials.fields.slice(0, 2),
      drop: ['rating'],
    })) as { dropped: readonly string[]; entries: number; note: string }

    expect(answer.dropped).toEqual(['rating'])
    expect(answer.entries).toBe(1)
    expect(answer.note).toContain('keeps its values')

    const found = (await app.queries.execute('entries.get', {
      resource: 'testimonials',
      id: created.id,
    })) as Record<string, unknown>

    // Not readable any more…
    expect(found).not.toHaveProperty('rating')
    // …and not deleted either: rewriting every row is an unbounded write, and throwing
    // the values away is worse than hiding them.
    expect(adapter.rows('assemora_resource_entries')[0]?.data).toMatchObject({ rating: 5 })
  })

  it('refuses a later field of a dropped name while the values are still there', async () => {
    const { app } = await build()
    await create(app, testimonials)
    await entry(app, 'testimonials', { author: 'Ada', quote: 'It works', rating: 5 })

    await update(app, {
      ...testimonials,
      fields: testimonials.fields.slice(0, 2),
      drop: ['rating'],
    })

    await expect(
      update(app, {
        ...testimonials,
        fields: [...testimonials.fields.slice(0, 2), { name: 'rating', kind: 'text' }],
      }),
    ).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
      fields: { 'fields.2.name': [expect.stringContaining('still stored under that name')] },
    })
  })

  it('refuses a kind change over stored values, and allows it while empty', async () => {
    const { app } = await build()
    await create(app, testimonials)

    const asText = {
      ...testimonials,
      fields: [...testimonials.fields.slice(0, 2), { name: 'rating', kind: 'text' }],
    }

    // Empty: nothing to convert, which is when people fix a wrong choice.
    await expect(update(app, asText)).resolves.toMatchObject({ name: 'testimonials' })
    await update(app, testimonials)

    await entry(app, 'testimonials', { author: 'Ada', quote: 'It works', rating: 5 })

    await expect(update(app, asText)).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
      fields: { 'fields.2.kind': [expect.stringContaining('cannot become text')] },
    })
  })

  it('lets select options grow but not shrink while entries exist', async () => {
    const { app } = await build()
    // `stage` rather than `status`: an entry has a `status` of its own, so a field
    // cannot be called that. The rule under test here is about options, not names.
    const withStage = {
      name: 'posts',
      fields: [
        { name: 'title', kind: 'text', required: true },
        { name: 'stage', kind: 'select', options: ['draft', 'live'] },
      ],
    }

    await create(app, withStage)
    await entry(app, 'posts', { title: 'Hello', stage: 'live' })

    await expect(
      update(app, {
        ...withStage,
        fields: [
          withStage.fields[0],
          { name: 'stage', kind: 'select', options: ['draft', 'live', 'archived'] },
        ],
      }),
    ).resolves.toMatchObject({ name: 'posts' })

    await expect(
      update(app, {
        ...withStage,
        fields: [withStage.fields[0], { name: 'stage', kind: 'select', options: ['draft'] }],
      }),
    ).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
      fields: { 'fields.1.options': [expect.stringContaining('"live"')] },
    })
  })

  it('has no rename: a new name is a new field, and the values do not travel', async () => {
    const { app } = await build()
    await create(app, testimonials)
    const created = await entry(app, 'testimonials', {
      author: 'Ada',
      quote: 'It works',
      rating: 5,
    })

    await update(app, {
      ...testimonials,
      fields: [
        { name: 'author', kind: 'text', required: true },
        { name: 'quote', kind: 'textarea', required: true },
        { name: 'score', kind: 'number' },
      ],
      drop: ['rating'],
    })

    const found = (await app.queries.execute('entries.get', {
      resource: 'testimonials',
      id: created.id,
    })) as Record<string, unknown>

    expect(found).not.toHaveProperty('score')
    expect(found).not.toHaveProperty('rating')
  })

  it('refuses a collection nobody made', async () => {
    const { app } = await build()

    await expect(update(app, testimonials)).rejects.toMatchObject({ status: 404 })
  })

  /**
   * A note is only worth reading if it is not printed every time (SPEC.md §43).
   *
   * `collections.update` is what Studio calls on every field edit, and repeating the
   * five REST addresses after each one is how a reader learns to skip the note — which
   * matters precisely when it is not a repeat: narrowing `api` takes an address out of
   * the Schema Registry and out of service at the same moment, and that is the edit
   * nobody should have to notice for themselves.
   */
  describe('what an edit says about the REST surface', () => {
    beforeEach(() => {
      publishGeneratedCrud('/api')
    })

    it('says nothing about it when the addresses are the ones it already had', async () => {
      const { app } = await build()
      await create(app, testimonials)

      const answer = (await update(app, {
        ...testimonials,
        fields: [...testimonials.fields, { name: 'company', kind: 'text' }],
      })) as { note: string }

      // Still says where the collection can be reached, which is cheap and true.
      expect(answer.note).toContain('Reachable now through')
      // And not one address, because not one of them moved.
      expect(answer.note).not.toContain('GET /testimonials')
      expect(answer.note).not.toContain('No restart')
    })

    it('names them when the edit changed which of them exist', async () => {
      const { app } = await build()
      await create(app, testimonials)

      const answer = (await update(app, {
        ...testimonials,
        api: { create: false, update: false, delete: false },
      })) as { note: string }

      expect(answer.note).toContain('GET /testimonials, GET /testimonials/:id')
      expect(answer.note).toContain(
        'It has no POST /testimonials, PATCH /testimonials/:id, DELETE /testimonials/:id',
      )
    })
  })

  /**
   * A group's values live in the entry's JSONB under the group's own name, so its inner
   * fields decide what is stored there exactly as the outer ones do. Worse: `object()`
   * keeps only the keys its shape mentions, so an inner field that quietly disappeared
   * would be *deleted* by the next ordinary save rather than merely orphaned — and
   * `drop` names a collection's own fields, with no way to name this one.
   */
  describe('an inner field, once entries hold values under it', () => {
    const withGroup = (fields: readonly unknown[]) => ({
      name: 'people',
      fields: [{ name: 'author', kind: 'object', fields }],
    })

    const seeded = async () => {
      const { app } = await build()

      await create(
        app,
        withGroup([
          { name: 'name', kind: 'text' },
          { name: 'site', kind: 'url' },
        ]),
      )
      await entry(app, 'people', { author: { name: 'Ada', site: 'https://x.io' } })

      return app
    }

    it('cannot change what it stores', async () => {
      const app = await seeded()

      await expect(
        update(
          app,
          withGroup([
            { name: 'name', kind: 'number' },
            { name: 'site', kind: 'url' },
          ]),
        ),
      ).rejects.toMatchObject({
        fields: {
          'fields.0.fields': [
            '"author.name" is stored as text in 1 entry, so it cannot become number. Empty the collection first, or add a new field under another name.',
          ],
        },
      })
    })

    it('cannot be removed, because the next save would delete the value', async () => {
      const app = await seeded()

      await expect(update(app, withGroup([{ name: 'name', kind: 'text' }]))).rejects.toMatchObject({
        code: 'VALIDATION_ERROR',
      })
    })

    it('may still be added, exactly as a top-level field may', async () => {
      const app = await seeded()

      await expect(
        update(
          app,
          withGroup([
            { name: 'name', kind: 'text' },
            { name: 'site', kind: 'url' },
            { name: 'role', kind: 'text' },
          ]),
        ),
      ).resolves.toMatchObject({ name: 'people' })
    })

    it('may still be relabelled', async () => {
      const app = await seeded()

      await expect(
        update(
          app,
          withGroup([
            { name: 'name', kind: 'text', label: 'Full name' },
            { name: 'site', kind: 'url' },
          ]),
        ),
      ).resolves.toMatchObject({ name: 'people' })
    })

    it('leaves an empty collection alone, which is where a wrong choice is fixed', async () => {
      const { app } = await build()
      await create(app, withGroup([{ name: 'name', kind: 'text' }]))

      await expect(
        update(app, withGroup([{ name: 'name', kind: 'number' }])),
      ).resolves.toMatchObject({ name: 'people' })
    })
  })
})

describe('deleting a collection', () => {
  const remove = (app: Application, name: string) =>
    app.commands.execute('collections.delete', { name })

  it('refuses while it holds entries, because the definition is what makes them readable', async () => {
    const { app } = await build()
    await create(app, testimonials)
    await entry(app, 'testimonials', { author: 'Ada', quote: 'It works' })

    await expect(remove(app, 'testimonials')).rejects.toMatchObject({
      code: 'COLLECTION_NOT_EMPTY',
      status: 409,
    })

    expect(adapter.rows('assemora_resource_definitions')).toHaveLength(1)
  })

  it('deletes an empty one and withdraws it from both registries', async () => {
    const { app } = await build()
    await create(app, testimonials)

    const answer = (await remove(app, 'testimonials')) as { name: string; note: string }

    expect(answer.name).toBe('testimonials')
    expect(adapter.rows('assemora_resource_definitions')).toHaveLength(0)
    expect(app.registry.find('resources', 'testimonials')).toBeUndefined()
    expect(registeredResources().map((each) => each.name)).not.toContain('testimonials')

    await expect(
      app.queries.execute('entries.list', { resource: 'testimonials' }),
    ).rejects.toMatchObject({ code: 'UNKNOWN_RESOURCE' })
  })

  it('does not report a document that stopped describing paths it never described', async () => {
    const { app } = await build()
    await create(app, testimonials)

    const answer = (await remove(app, 'testimonials')) as { note: string }

    // The mirror of the promise, wrong in the same way: an application publishing no
    // generated CRUD had nothing at those addresses to withdraw.
    expect(answer.note).toContain('It had no generated REST paths')
    expect(answer.note).not.toContain('openapi.json')
  })

  it('names the addresses it took out of service, when there were any', async () => {
    const { app } = await build()

    publishGeneratedCrud('/api')
    await create(app, testimonials)

    const answer = (await remove(app, 'testimonials')) as { note: string }

    expect(answer.note).toContain('under /api now answer 404')
    expect(answer.note).toContain('/api/openapi.json')
  })

  it('counts the soft-deleted entries it orphans rather than leaving them to be found', async () => {
    const { app } = await build()
    await create(app, testimonials)
    const created = await entry(app, 'testimonials', { author: 'Ada', quote: 'It works' })

    await app.commands.execute('entries.delete', { resource: 'testimonials', id: created.id })

    const answer = (await remove(app, 'testimonials')) as { orphanedEntries: number; note: string }

    expect(answer.orphanedEntries).toBe(1)
    expect(answer.note).toContain('no longer be restored')
  })

  it('frees the name for a new collection', async () => {
    const { app } = await build()
    await create(app, testimonials)
    await remove(app, 'testimonials')

    await expect(create(app, testimonials)).resolves.toMatchObject({ name: 'testimonials' })
  })
})

describe('loading at boot (SPEC.md §37)', () => {
  const store = (schema: Record<string, unknown>, settings: Record<string, unknown> = {}) =>
    ResourceDefinitionModel.create({
      name: String(schema.name),
      label: String(schema.label ?? schema.name),
      schema: schema as never,
      settings,
    })

  it('registers every stored collection', async () => {
    useAdapter(adapter)
    await store(testimonials)

    const { app } = await build()

    expect(app.registry.find('resources', 'testimonials')).toMatchObject({ kind: 'dynamic' })
    expect(collectionByName('testimonials')?.definition.fields).toHaveLength(3)
  })

  it('remembers which fields were dropped, so a later one cannot inherit their values', async () => {
    useAdapter(adapter)
    await store(testimonials, { dropped: ['legacy'] })

    await build()

    expect(collectionByName('testimonials')?.dropped).toEqual(['legacy'])
  })

  it('skips a definition the parser now refuses, names it, and still boots', async () => {
    useAdapter(adapter)
    await store({ name: 'legacy', fields: [{ name: 'x', kind: 'kindFromAPluginThatLeft' }] })
    await store(testimonials)

    const { app } = await build()

    expect(app.registry.find('resources', 'testimonials')).toBeDefined()
    expect(app.registry.find('resources', 'legacy')).toBeUndefined()

    const skipped = logs.find((record) => record.message === 'A stored collection was skipped')

    expect(skipped).toMatchObject({ level: 'warn', collection: 'legacy' })
  })

  it('skips a collection a static resource has since taken the name of', async () => {
    useAdapter(adapter)
    await store({ name: 'articles', fields: [{ name: 'title', kind: 'text' }] })

    const { app } = await build({ statics: true })

    expect(app.registry.find('resources', 'articles')).toMatchObject({ kind: 'static' })
    expect(
      logs.find((record) => record.message === 'A stored collection was skipped'),
    ).toMatchObject({ collection: 'articles' })
    // Still in the table, so renaming the static resource brings it back.
    expect(adapter.rows('assemora_resource_definitions')).toHaveLength(1)
  })

  it('skips a row whose stored schema disagrees with its name column', async () => {
    useAdapter(adapter)
    await ResourceDefinitionModel.create({
      name: 'quotes',
      label: 'Quotes',
      schema: testimonials as never,
      settings: {},
    })

    const { app } = await build()

    expect(app.registry.find('resources', 'quotes')).toBeUndefined()
    expect(app.registry.find('resources', 'testimonials')).toBeUndefined()
  })
})

describe('a definition that was skipped is still reachable enough to fix', () => {
  const storeBroken = () =>
    ResourceDefinitionModel.create({
      name: 'legacy',
      label: 'Legacy',
      schema: { name: 'legacy', fields: [{ name: 'x', kind: 'kindFromAPluginThatLeft' }] } as never,
      settings: {},
    })

  it('refuses to take its name, saying the row is there rather than failing on the index', async () => {
    useAdapter(adapter)
    await storeBroken()

    const { app } = await build()

    await expect(
      create(app, { name: 'legacy', fields: [{ name: 'x', kind: 'text' }] }),
    ).rejects.toMatchObject({
      code: 'RESOURCE_NAME_TAKEN',
      message: expect.stringContaining('was not registered'),
    })
  })

  it('refuses to change it, because there is nothing to compare the change against', async () => {
    useAdapter(adapter)
    await storeBroken()

    const { app } = await build()

    await expect(
      app.commands.execute('collections.update', {
        name: 'legacy',
        fields: [{ name: 'x', kind: 'text' }],
      }),
    ).rejects.toMatchObject({ code: 'COLLECTION_NOT_REGISTERED', status: 409 })
  })

  it('reads as unregistered rather than as missing', async () => {
    useAdapter(adapter)
    await storeBroken()

    const { app } = await build()

    await expect(app.queries.execute('collections.get', { name: 'legacy' })).rejects.toMatchObject({
      code: 'COLLECTION_NOT_REGISTERED',
    })
  })

  it('can be deleted, which is the way out', async () => {
    useAdapter(adapter)
    await storeBroken()

    const { app } = await build()

    await expect(
      app.commands.execute('collections.delete', { name: 'legacy' }),
    ).resolves.toMatchObject({ name: 'legacy' })
    expect(adapter.rows('assemora_resource_definitions')).toHaveLength(0)
  })
})

describe('reading what exists', () => {
  it('lists the collections, and every name a new one may not take', async () => {
    const { app } = await build({ statics: true })
    await create(app, testimonials)

    const listed = (await app.queries.execute('collections.list', {})) as {
      data: readonly { name: string; fields: number; id: string }[]
      taken: readonly string[]
    }

    expect(listed.data.map((each) => each.name)).toEqual(['testimonials'])
    expect(listed.data[0]).toMatchObject({ fields: 3 })
    // A static resource is not a collection, and its name is still not available.
    expect(listed.taken).toEqual(['articles', 'testimonials'])
  })

  it('returns the stored definition and the entry count for a collection', async () => {
    const { app } = await build()
    await create(app, testimonials)
    await entry(app, 'testimonials', { author: 'Ada', quote: 'It works' })

    const found = (await app.queries.execute('collections.get', { name: 'testimonials' })) as {
      entries: number
      dropped: readonly string[]
      definition: { fields: readonly unknown[] }
    }

    expect(found).toMatchObject({ entries: 1, dropped: [] })
    expect(found.definition.fields).toHaveLength(3)
  })

  it('says a static resource is a source declaration rather than pretending it is missing', async () => {
    const { app } = await build({ statics: true })

    await expect(
      app.queries.execute('collections.get', { name: 'articles' }),
    ).rejects.toMatchObject({
      code: 'COLLECTION_NOT_FOUND',
      message: expect.stringContaining('declares in its source'),
    })
  })

  it('refuses a collection nobody made', async () => {
    const { app } = await build()

    await expect(app.queries.execute('collections.get', { name: 'nope' })).rejects.toMatchObject({
      code: 'COLLECTION_NOT_FOUND',
      status: 404,
    })
  })
})

/**
 * `revisions.undo` and `revisions.restore` are commands in `@assemora/revisions`, which
 * this package may not depend on (SPEC.md §8). What they reach is `restorerFor(name)`,
 * so that is what is exercised here — including the reason `restorer.ts` resolves the
 * resource by name at restore time rather than capturing it.
 */
describe('an entry of a collection is restorable like any other (SPEC.md §65)', () => {
  const restore = (name: string, id: string, state: unknown) => {
    const restorer = restorerFor(name)

    if (restorer === undefined) throw new Error(`no restorer for ${name}`)

    return restorer(id, state)
  }

  const read = (app: Application, id: string) =>
    app.queries.execute('entries.get', { resource: 'testimonials', id }) as Promise<Record<
      string,
      unknown
    > | null>

  it('registers one under the collection name when the collection is created', async () => {
    const { app } = await build()

    expect(restorerFor('testimonials')).toBeUndefined()

    await create(app, testimonials)

    expect(restorerFor('testimonials')).toBeTypeOf('function')
    expect(ResourceEntryModel.table).toBe('assemora_resource_entries')
  })

  it('registers one for a collection loaded at boot, not only for a created one', async () => {
    useAdapter(adapter)
    await ResourceDefinitionModel.create({
      name: 'testimonials',
      label: 'Testimonials',
      schema: testimonials as never,
      settings: {},
    })

    await build()

    expect(restorerFor('testimonials')).toBeTypeOf('function')
  })

  it('puts an earlier state back, and says what it replaced', async () => {
    const { app } = await build()
    await create(app, testimonials)
    const created = await entry(app, 'testimonials', { author: 'Ada', quote: 'It works' })
    const before = revisions.at(-1)?.after

    await app.commands.execute('entries.update', {
      resource: 'testimonials',
      id: created.id,
      data: { quote: 'It broke' },
    })

    const result = await restore('testimonials', created.id, before)

    expect(await read(app, created.id)).toMatchObject({ quote: 'It works' })
    // The revision of a restore records what it *replaced*, which nothing but the
    // restorer can supply: the caller knows which revision it applied, not what the
    // entry had drifted to since.
    expect(result?.replaced).toMatchObject({ quote: 'It broke' })
  })

  it('takes an entry away again when the state it is restored to is null', async () => {
    const { app } = await build()
    await create(app, testimonials)
    const created = await entry(app, 'testimonials', { author: 'Ada', quote: 'It works' })

    const result = await restore('testimonials', created.id, null)

    expect(await read(app, created.id)).toBeNull()
    expect(result?.replaced).toMatchObject({ author: 'Ada' })
  })

  it('re-creates a deleted entry from its last state', async () => {
    const { app } = await build()
    await create(app, testimonials)
    const created = await entry(app, 'testimonials', { author: 'Ada', quote: 'It works' })
    const deleted = await app.commands.execute('entries.delete', {
      resource: 'testimonials',
      id: created.id,
    })

    expect(deleted).toMatchObject({ id: created.id })

    const result = await restore('testimonials', created.id, revisions.at(-1)?.before)

    expect(result?.replaced).toBeNull()

    const back = (await app.queries.execute('entries.get', {
      resource: 'testimonials',
      id: String(result?.id),
    })) as Record<string, unknown> | null

    expect(back).toMatchObject({ author: 'Ada', quote: 'It works' })
  })

  it('refuses once the collection is gone, rather than writing into nothing', async () => {
    const { app } = await build()
    await create(app, testimonials)
    const created = await entry(app, 'testimonials', { author: 'Ada', quote: 'It works' })
    const state = revisions.at(-1)?.after

    await app.commands.execute('entries.delete', { resource: 'testimonials', id: created.id })
    await app.commands.execute('collections.delete', { name: 'testimonials' })

    // The definition is what makes the JSONB readable, so re-creating a row into a
    // collection that no longer exists would be writing a value nothing can read. The
    // resource is looked up by name when the restore runs for exactly this reason.
    await expect(restore('testimonials', created.id, state)).rejects.toMatchObject({
      code: 'UNKNOWN_RESOURCE',
    })
  })

  it('does not carry a prototype name into what it writes back', async () => {
    const { app } = await build()
    await create(app, {
      name: 'notes',
      fields: [
        { name: 'title', kind: 'text', required: true },
        { name: 'constructor', kind: 'text' },
      ],
    })

    const created = (await app.commands.execute('entries.create', {
      resource: 'notes',
      data: { title: 'One' },
    })) as { id: string }
    const state = revisions.at(-1)?.after

    await app.commands.execute('entries.update', {
      resource: 'notes',
      id: created.id,
      data: { title: 'Two' },
    })

    // `'constructor' in snapshot` is true of every snapshot, so the restorer would
    // write `Object.prototype.constructor` — a function — into the entry, and the
    // resource's own validation would refuse the restore outright.
    await expect(restore('notes', created.id, state)).resolves.toMatchObject({
      replaced: expect.objectContaining({ title: 'Two' }),
    })

    const back = (await app.queries.execute('entries.get', {
      resource: 'notes',
      id: created.id,
    })) as Record<string, unknown>

    expect(back.title).toBe('One')
    expect(Object.hasOwn(back, 'constructor')).toBe(false)
  })
})

/**
 * The path an agent's mutation actually takes (SPEC.md §75, ADR-0019, ADR-0023).
 *
 * `app.commands.dryRun(...)` at the top level is the easy half: there the rollback is
 * the outermost transaction, and anything held against its commit is dropped with it.
 * `changesets.propose` is the half that matters, and it is a *command* whose handler
 * previews other commands — so the preview is a savepoint inside the proposer's
 * transaction, and after-commit work registered with the transaction port would be
 * handed to the proposer's commit and applied for real.
 */
describe('a preview run from inside another command changes nothing either', () => {
  const propose = (app: Application, name: string, input: unknown) =>
    app.commands.execute('proposals.make', { command: name, input }) as Promise<readonly Preview[]>

  it('leaves both registries alone when a create is only proposed', async () => {
    const { app } = await build({ proposals: true })

    const previews = await propose(app, 'collections.create', testimonials)

    expect(previews[0]?.changes).toHaveLength(1)
    expect(adapter.rows('assemora_resource_definitions')).toHaveLength(0)
    // The row was rolled back. A collection registered against it would let entries be
    // written with a `resourceId` that never existed, refuse the name to the person who
    // then tried to make it for real, and vanish at the next boot.
    expect(collectionByName('testimonials')).toBeUndefined()
    expect(app.registry.find('resources', 'testimonials')).toBeUndefined()
    expect(registeredResources().map((each) => each.name)).not.toContain('testimonials')
  })

  it('does not take a live collection offline when a delete is only proposed', async () => {
    const { app } = await build({ proposals: true })
    await create(app, testimonials)

    await propose(app, 'collections.delete', { name: 'testimonials' })

    expect(adapter.rows('assemora_resource_definitions')).toHaveLength(1)
    expect(collectionByName('testimonials')).toBeDefined()
    expect(app.registry.find('resources', 'testimonials')).toMatchObject({ kind: 'dynamic' })

    // Still writable, which is the whole of "nobody approved anything".
    await expect(
      entry(app, 'testimonials', { author: 'Ada', quote: 'It works' }),
    ).resolves.toMatchObject({ id: expect.any(String) })
  })

  it('does not put a proposed shape into the live registry when an update is proposed', async () => {
    const { app } = await build({ proposals: true })
    await create(app, testimonials)

    await propose(app, 'collections.update', {
      ...testimonials,
      fields: [...testimonials.fields, { name: 'injected', kind: 'text' }],
    })

    expect(app.registry.find('resources', 'testimonials')?.fields).toHaveLength(3)
    expect(collectionByName('testimonials')?.definition.fields).toHaveLength(3)

    // A field the stored definition does not declare is a value nothing can read back
    // at the next boot, and one no drop or kind-freeze rule ever saw.
    await expect(
      entry(app, 'testimonials', { author: 'Ada', quote: 'It works', injected: 'never approved' }),
    ).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
      fields: { injected: ['"injected" is not a field of testimonials'] },
    })
  })
})

describe('deleting a definition never withdraws something else of that name', () => {
  /** The row a collection leaves behind when a static resource takes over its name. */
  const storeShadowed = () =>
    ResourceDefinitionModel.create({
      name: 'articles',
      label: 'Articles',
      schema: { name: 'articles', fields: [{ name: 'title', kind: 'text' }] } as never,
      settings: {},
    })

  it('leaves the static resource of that name registered and answering', async () => {
    useAdapter(adapter)
    await storeShadowed()

    const { app } = await build({ statics: true })

    // Boot skipped the stored definition by design, and the log tells the operator to
    // delete it — so deleting it must not take the resource that displaced it with it.
    expect(
      logs.find((record) => record.message === 'A stored collection was skipped'),
    ).toMatchObject({ collection: 'articles' })

    const answer = (await app.commands.execute('collections.delete', {
      name: 'articles',
    })) as { name: string; note: string }

    expect(answer.name).toBe('articles')
    // And the answer says so, rather than reporting a withdrawal that did not happen.
    expect(answer.note).toContain('nothing was withdrawn')

    expect(adapter.rows('assemora_resource_definitions')).toHaveLength(0)
    expect(app.registry.find('resources', 'articles')).toMatchObject({ kind: 'static' })
    expect(registeredResources().map((each) => each.name)).toContain('articles')

    // Which is what the unregistration actually cost: the source-declared resource, its
    // REST routes still mounted and answering 404, gone until a restart.
    await expect(
      app.queries.execute('entries.list', { resource: 'articles' }),
    ).resolves.toMatchObject({ total: 0 })
  })
})

describe('a field cannot be called what an entry is already called (SPEC.md §38)', () => {
  const reserved = ['id', 'status', 'version', 'createdAt', 'updatedAt', 'publishedAt']

  it('refuses every name the entry itself occupies', async () => {
    const { app } = await build()

    for (const name of reserved) {
      await expect(
        create(app, {
          name: `notes_${name.toLowerCase()}`,
          fields: [
            { name: 'title', kind: 'text' },
            { name, kind: 'text' },
          ],
        }),
      ).rejects.toMatchObject({
        code: 'VALIDATION_ERROR',
        fields: { 'fields.1.name': [expect.stringContaining('part of every entry already')] },
      })
    }

    expect(adapter.rows('assemora_resource_definitions')).toHaveLength(0)
  })

  it('was accepted, stored, unreadable, and destroyed by an ordinary save', async () => {
    const { app } = await build()

    // What the refusal above prevents, spelled out: a field called `id` is written over
    // by the row's own id on every read, so pressing Save without touching anything
    // wrote the uuid back into the field. A `required` one could never be satisfied.
    await expect(
      create(app, {
        name: 'field_notes',
        fields: [
          { name: 'id', kind: 'text', required: true },
          { name: 'title', kind: 'text' },
        ],
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' })

    expect(collectionByName('field_notes')).toBeUndefined()
  })

  it('skips a stored one at boot rather than registering it', async () => {
    useAdapter(adapter)
    await ResourceDefinitionModel.create({
      name: 'field_notes',
      label: 'Field notes',
      schema: { name: 'field_notes', fields: [{ name: 'id', kind: 'text' }] } as never,
      settings: {},
    })

    const { app } = await build()

    expect(app.registry.find('resources', 'field_notes')).toBeUndefined()
    expect(
      logs.find((record) => record.message === 'A stored collection was skipped'),
    ).toMatchObject({ collection: 'field_notes' })
  })
})

describe('a name that is already a permission subject (SPEC.md §51, §76)', () => {
  const noted = [{ name: 'note', kind: 'text' }]

  it('is refused, because the grant it inherits was never given to anybody', async () => {
    const { app } = await build({ history: true })

    // `entries.list` on resource X authorizes `X.read`, so a collection called
    // `revisions` is covered by `revisions.*` — which an editor holds to read history.
    await expect(create(app, { name: 'revisions', fields: noted })).rejects.toMatchObject({
      code: 'RESOURCE_NAME_TAKEN',
      status: 409,
      message: expect.stringContaining('revisions.*'),
    })

    expect(adapter.rows('assemora_resource_definitions')).toHaveLength(0)
  })

  it('includes the subjects this package declares itself', async () => {
    const { app } = await build()

    for (const name of ['collections', 'entries']) {
      await expect(create(app, { name, fields: noted })).rejects.toMatchObject({
        code: 'RESOURCE_NAME_TAKEN',
        message: expect.stringContaining('permission subject'),
      })
    }
  })

  it('leaves an ordinary name alone', async () => {
    const { app } = await build({ history: true })

    await expect(create(app, { name: 'testimonials', fields: noted })).resolves.toMatchObject({
      name: 'testimonials',
    })
  })

  it('is skipped at boot too, because a release can add a command group', async () => {
    useAdapter(adapter)
    await ResourceDefinitionModel.create({
      name: 'revisions',
      label: 'Board minutes',
      schema: { name: 'revisions', fields: noted } as never,
      settings: {},
    })

    const { app } = await build({ history: true })

    expect(app.registry.find('resources', 'revisions')).toBeUndefined()
    expect(
      logs.find((record) => record.message === 'A stored collection was skipped'),
    ).toMatchObject({ collection: 'revisions' })
    // Still in the table: the definition is not thrown away for a name clash.
    expect(adapter.rows('assemora_resource_definitions')).toHaveLength(1)
  })
})

describe('a collection is the resource a static one is (SPEC.md §36, §39)', () => {
  const notes = {
    name: 'notes',
    fields: [
      { name: 'title', kind: 'text', required: true },
      { name: 'rank', kind: 'number' },
      { name: 'handle', kind: 'slug', source: 'title' },
    ],
  }

  const read = (app: Application, id: string) =>
    app.queries.execute('entries.get', { resource: 'notes', id }) as Promise<
      Record<string, unknown>
    >

  it('clears an optional field with null, which used to be impossible', async () => {
    const { app } = await build()
    await create(app, notes)
    const created = await entry(app, 'notes', { title: 'One', rank: 3 })

    await app.commands.execute('entries.update', {
      resource: 'notes',
      id: created.id,
      data: { rank: null },
    })

    // Omitting the key keeps the old value, because the JSONB is merged — so `null` was
    // the only way to clear it and the only way was refused.
    expect(await read(app, created.id)).toMatchObject({ rank: null })
  })

  it('still refuses null for a required field', async () => {
    const { app } = await build()
    await create(app, notes)
    const created = await entry(app, 'notes', { title: 'One' })

    await expect(
      app.commands.execute('entries.update', {
        resource: 'notes',
        id: created.id,
        data: { title: null },
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' })
  })

  it('derives a slug from its source on create', async () => {
    const { app } = await build()
    await create(app, notes)
    const created = await entry(app, 'notes', { title: 'Hello World' })

    expect(await read(app, created.id)).toMatchObject({ handle: 'hello-world' })
  })

  it('keeps a slug a caller sent, and leaves it alone when the title is edited', async () => {
    const { app } = await build()
    await create(app, notes)
    const created = await entry(app, 'notes', { title: 'Hello World', handle: 'chosen-by-hand' })

    await app.commands.execute('entries.update', {
      resource: 'notes',
      id: created.id,
      data: { title: 'Something Else' },
    })

    // A published URL does not change because somebody corrected a headline.
    expect(await read(app, created.id)).toMatchObject({ handle: 'chosen-by-hand' })
  })
})

/**
 * `Object.hasOwn` and not `in`, at every site (SPEC.md §86).
 *
 * A field name is chosen by whoever makes the collection, so `constructor` is a legal
 * one — and `'constructor' in data` is true of every object in JavaScript. Each of
 * these fails if that check is written with `in`: the entry comes back holding a
 * function, or a required field reads as provided by every caller, or a slug is never
 * derived because the caller is thought to have sent one.
 */
describe('a field named after something on Object.prototype', () => {
  const prototypal = {
    name: 'notes',
    fields: [
      { name: 'title', kind: 'text', required: true },
      { name: 'constructor', kind: 'text' },
    ],
  }

  it('is not read back from the prototype when the entry does not have it', async () => {
    const { app } = await build()
    await create(app, prototypal)
    const created = await entry(app, 'notes', { title: 'One' })

    const found = (await app.queries.execute('entries.get', {
      resource: 'notes',
      id: created.id,
    })) as Record<string, unknown>

    expect(Object.hasOwn(found, 'constructor')).toBe(false)
  })

  it('is stored and read back when it really was sent', async () => {
    const { app } = await build()
    await create(app, prototypal)
    const created = await entry(app, 'notes', { title: 'One', constructor: 'hello' })

    const found = (await app.queries.execute('entries.get', {
      resource: 'notes',
      id: created.id,
    })) as Record<string, unknown>

    expect(found.constructor).toBe('hello')
  })

  it('is required of a caller who did not send it, rather than satisfied by the prototype', async () => {
    const { app } = await build()
    await create(app, {
      name: 'notes',
      fields: [{ name: 'constructor', kind: 'text', required: true }],
    })

    await expect(entry(app, 'notes', {})).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
      fields: { constructor: ['This field is required'] },
    })
  })

  it('is derived like any other slug, rather than skipped as already provided', async () => {
    const { app } = await build()
    await create(app, {
      name: 'notes',
      fields: [
        { name: 'title', kind: 'text', required: true },
        { name: 'constructor', kind: 'slug', source: 'title' },
      ],
    })

    const created = await entry(app, 'notes', { title: 'Hello World' })

    const found = (await app.queries.execute('entries.get', {
      resource: 'notes',
      id: created.id,
    })) as Record<string, unknown>

    expect(found.constructor).toBe('hello-world')
  })
})

describe('the limits a definition has to have', () => {
  const noted = [{ name: 'note', kind: 'text' }]

  it('refuses a name longer than the column, rather than letting the database do it', async () => {
    const { app } = await build()

    // `name` is varchar(255). Without the cap this was `DATABASE_ERROR` 22001 — a 500
    // blaming the server for what the caller sent — and only on PostgreSQL: the memory
    // adapter has no column width, so it succeeded here and failed in production.
    await expect(create(app, { name: `a${'b'.repeat(400)}`, fields: noted })).rejects.toMatchObject(
      {
        code: 'VALIDATION_ERROR',
        status: 422,
        fields: { name: [expect.stringContaining('at most 255')] },
      },
    )

    expect(adapter.rows('assemora_resource_definitions')).toHaveLength(0)
  })

  it('refuses a label longer than the column for the same reason', async () => {
    const { app } = await build()

    await expect(
      create(app, { name: 'testimonials', label: 'x'.repeat(400), fields: noted }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR', status: 422 })
  })

  it('caps how many fields one collection may declare', async () => {
    const { app } = await build()

    const many = (count: number) =>
      Array.from({ length: count }, (_unused, index) => ({
        name: `field_${index}`,
        kind: 'text',
      }))

    // Not a storage limit: the definition is JSONB. It is what `/api/_introspection`
    // and `assemora.describe` carry on every load, and any holder of
    // `collections.create` could leave six thousand fields there for ever.
    await expect(create(app, { name: 'wide', fields: many(6000) })).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
      status: 422,
      fields: { fields: [expect.stringContaining('at most 200')] },
    })

    await expect(create(app, { name: 'wide', fields: many(200) })).resolves.toMatchObject({
      name: 'wide',
    })
  })

  it('keeps whatever else the settings hold when a field is edited', async () => {
    useAdapter(adapter)
    await ResourceDefinitionModel.create({
      name: 'testimonials',
      label: 'Testimonials',
      schema: testimonials as never,
      // Stands in for §43's per-collection API exposure, which is the value that will
      // arrive in here next. An unrelated field edit must not take it out.
      settings: { api: { create: false } },
    })

    const { app } = await build()

    await app.commands.execute('collections.update', {
      ...testimonials,
      label: 'What people say',
    })

    expect(adapter.rows('assemora_resource_definitions')[0]?.settings).toMatchObject({
      api: { create: false },
      dropped: [],
    })
  })
})

describe('what an agent can learn from the tool schema (ADR-0020)', () => {
  /** Walks a JSON Schema without reaching for `any`. */
  const at = (root: unknown, ...keys: readonly string[]): Record<string, unknown> => {
    let node = root as Record<string, unknown>

    for (const key of keys) node = node[key] as Record<string, unknown>

    return node
  }

  it('publishes the field kinds instead of leaving them to be guessed', async () => {
    const { app } = await build()

    const described = app.registry.find('commands', 'collections.create')
    const kind = at(described?.input, 'properties', 'fields', 'items', 'properties', 'kind')

    // `assemora.collections.create` is an MCP tool by generation, and its schema is the
    // only thing telling an agent what may go here. As a bare string it left the
    // fifteen kinds of SPEC.md §39 to be guessed.
    expect(kind.enum).toEqual(registeredFieldKinds())
    expect(kind.enum).toContain('richText')
    expect(kind.enum).toContain('slug')
  })

  it('publishes the caps too, so a caller can see them before it is refused', async () => {
    const { app } = await build()

    const described = app.registry.find('commands', 'collections.create')

    expect(at(described?.input, 'properties', 'fields')).toMatchObject({
      minItems: 1,
      maxItems: 200,
    })
    expect(at(described?.input, 'properties', 'name')).toMatchObject({ maxLength: 255 })
  })
})
