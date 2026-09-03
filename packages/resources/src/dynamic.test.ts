import { createApplication, module, permitAll, ValidationError } from '@assemora/core'
import { useAdapter } from '@assemora/data'
import { createMemoryAdapter, type MemoryAdapter } from '@assemora/database'
import { beforeEach, describe, expect, it } from 'vitest'

import {
  type DynamicDefinition,
  dynamicResource,
  parseDeclaredDefinition,
  parseDynamicDefinition,
} from './dynamic.js'
import { registeredFieldKinds } from './field-registry.js'
import { clearResourceRegistry } from './registry.js'
import './module.js'

const testimonials: DynamicDefinition = {
  name: 'testimonials',
  label: 'Testimonials',
  fields: [
    { name: 'author', kind: 'text', required: true, searchable: true },
    { name: 'quote', kind: 'textarea', required: true, searchable: true },
    { name: 'rating', kind: 'number', filterable: true },
    { name: 'featured', kind: 'boolean', filterable: true },
  ],
}

const RESOURCE_ID = '3f2504e0-4f89-41d3-9a0c-0305e82c3301'

let adapter: MemoryAdapter

beforeEach(() => {
  clearResourceRegistry()
  adapter = createMemoryAdapter({ assemora_resource_entries: [] })
  useAdapter(adapter)
})

describe('parsing a stored definition (SPEC.md §37, §86)', () => {
  it('accepts a declarative definition', () => {
    expect(parseDynamicDefinition(testimonials)).toMatchObject({ name: 'testimonials' })
  })

  it('refuses a field kind nobody registered', () => {
    const failure = (() => {
      try {
        parseDynamicDefinition({
          name: 'bad',
          fields: [{ name: 'x', kind: 'summonDemon' }],
        })
      } catch (error) {
        return error as ValidationError
      }
      return undefined
    })()

    expect(failure).toBeInstanceOf(ValidationError)
    expect(failure?.fields['fields.0.kind']).toEqual(['"summonDemon" is not a known field kind'])
  })

  it('drops anything the definition schema does not declare, so no code can ride along', () => {
    const parsed = parseDynamicDefinition({
      name: 'testimonials',
      fields: [
        {
          name: 'author',
          kind: 'text',
          // None of these are part of the schema, and none of them survive parsing.
          validate: 'eval("process.exit(1)")',
          transform: '() => 1',
          onSave: 'require("node:fs").rmSync("/")',
        },
      ],
    })

    expect(parsed.fields[0]).toEqual({ name: 'author', kind: 'text' })
    expect(JSON.stringify(parsed)).not.toContain('eval')
  })

  it('refuses a duplicate field name', () => {
    expect(() =>
      parseDynamicDefinition({
        name: 'dup',
        fields: [
          { name: 'a', kind: 'text' },
          { name: 'a', kind: 'number' },
        ],
      }),
    ).toThrowError(ValidationError)
  })

  it('refuses names that are not identifiers', () => {
    expect(() =>
      parseDynamicDefinition({ name: 'Not Valid', fields: [{ name: 'a', kind: 'text' }] }),
    ).toThrowError(ValidationError)
    expect(() =>
      parseDynamicDefinition({ name: 'ok', fields: [{ name: '1bad', kind: 'text' }] }),
    ).toThrowError(ValidationError)
  })

  it('demands at least one field', () => {
    expect(() => parseDynamicDefinition({ name: 'empty', fields: [] })).toThrowError(
      ValidationError,
    )
  })

  it('demands what a kind needs: options for select, a source for slug', () => {
    expect(() =>
      parseDynamicDefinition({ name: 'a', fields: [{ name: 'x', kind: 'select' }] }),
    ).toThrowError(ValidationError)
    expect(() =>
      parseDynamicDefinition({ name: 'a', fields: [{ name: 'x', kind: 'slug' }] }),
    ).toThrowError(ValidationError)
  })

  it('lists the kinds a definition may use', () => {
    expect(registeredFieldKinds()).toContain('richText')
    expect(registeredFieldKinds()).not.toContain('summonDemon')
  })
})

/**
 * A collection can publish less, which is the last thing only source could do
 * (SPEC.md §43).
 *
 * The flags were accepted by the command, dropped by the input schema and hard-coded to
 * `true` here — so a definition that asked for a read-only collection got all five
 * endpoints and no word about it.
 */
describe('the endpoints a definition publishes', () => {
  const exposed = (definition: unknown) =>
    dynamicResource(parseDynamicDefinition(definition), { id: RESOURCE_ID }).descriptor.api

  it('is all five when the definition says nothing, as it is in TypeScript', () => {
    expect(exposed(testimonials)).toEqual({
      create: true,
      read: true,
      update: true,
      delete: true,
    })
  })

  it('carries what the definition declared, flag by flag', () => {
    expect(exposed({ ...testimonials, api: { create: false, delete: false } })).toEqual({
      create: false,
      read: true,
      update: true,
      delete: false,
    })
  })

  it('is untrusted data like everything else in a definition', () => {
    expect(() => parseDynamicDefinition({ ...testimonials, api: { create: 'yes' } })).toThrowError(
      ValidationError,
    )

    // And nothing but the four flags survives, so `api` is no more a way in than
    // `fields` is (SPEC.md §86).
    expect(
      parseDynamicDefinition({
        ...testimonials,
        api: { read: true, onRequest: 'require("node:fs").rmSync("/")' },
      }).api,
    ).toEqual({ read: true })
  })
})

/**
 * A flag nothing could honour is refused where it is written (SPEC.md §38).
 *
 * `sortable` was accepted, stored and then answered with a 422 by `entries.list` for
 * ever: a collection's entries are ordered by the entry's own columns, because the
 * values live in one JSONB document and the Query AST has no ordering term for one.
 */
describe('a claim a collection cannot honour', () => {
  const declaring = (fields: readonly unknown[]) => () =>
    parseDeclaredDefinition({ name: 'reviews', fields })

  it('refuses it, and says why', () => {
    const failure = (() => {
      try {
        declaring([{ name: 'score', kind: 'number', sortable: true }])()
      } catch (error) {
        return error as ValidationError
      }
      return undefined
    })()

    expect(failure).toBeInstanceOf(ValidationError)
    expect(failure?.fields['fields.0.sortable']?.[0]).toContain('"score" cannot be sortable')
    expect(failure?.fields['fields.0.sortable']?.[0]).toContain('createdAt')
  })

  it('is refused inside a group and inside a repeater too, a layer earlier', () => {
    const inside = (() => {
      try {
        declaring([
          {
            name: 'meta',
            kind: 'object',
            fields: [{ name: 'author', kind: 'text', sortable: true }],
          },
          { name: 'gallery', kind: 'array', element: { kind: 'text', sortable: true } },
        ])()
      } catch (error) {
        return error as ValidationError
      }
      return undefined
    })()

    // Not this rule's doing: `object()` and `array()` refuse a nested `sortable` for a
    // static resource as well, because sorting addresses a resource field by name. The
    // outcome is what matters, and it is the same at every depth.
    expect(Object.keys(inside?.fields ?? {})).toEqual([
      'fields.0.fields.0.sortable',
      'fields.1.element.sortable',
    ])
  })

  it('still loads a row written before the rule, so a collection is not lost to it', () => {
    // The boot loader's parser. Refusing here would skip the collection at the next
    // boot — content out of a running application, and out of reach of the very update
    // that would remove the flag, over a value that never did anything.
    expect(
      parseDynamicDefinition({
        name: 'reviews',
        fields: [{ name: 'score', kind: 'number', sortable: true }],
      }).fields[0],
    ).toMatchObject({ sortable: true })
  })
})

describe('a dynamic resource behaves like any other', () => {
  const build = () => {
    const testimonialsResource = dynamicResource(parseDynamicDefinition(testimonials), {
      id: RESOURCE_ID,
      perPage: 2,
    })

    const app = createApplication({
      modules: [module('content').resources(testimonialsResource)],
      authorization: permitAll(),
    })

    return { app, resource: testimonialsResource }
  }

  const create = (app: ReturnType<typeof build>['app'], data: Record<string, unknown>) =>
    app.commands.execute('entries.create', { resource: 'testimonials', data }) as Promise<{
      id: string
    }>

  it('describes itself the same way a static resource does', () => {
    const { app } = build()

    expect(app.registry.find('resources', 'testimonials')).toMatchObject({
      kind: 'dynamic',
      model: 'assemora_resource_entries',
      label: 'Testimonials',
    })
  })

  it('creates, reads and updates entries through the same commands', async () => {
    const { app, resource } = build()

    const created = await create(app, { author: 'Ada', quote: 'It works', rating: 5 })
    const found = (await resource.find(created.id)) as Record<string, unknown>

    expect(found).toMatchObject({ author: 'Ada', quote: 'It works', rating: 5, version: 1 })

    await app.commands.execute('entries.update', {
      resource: 'testimonials',
      id: created.id,
      data: { rating: 4 },
    })

    const updated = (await resource.find(created.id)) as Record<string, unknown>

    expect(updated).toMatchObject({ author: 'Ada', rating: 4, version: 2 })
  })

  it('validates against the stored definition', async () => {
    const { app } = build()

    await expect(create(app, { quote: 'no author' })).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
      fields: { author: ['This field is required'] },
    })

    await expect(create(app, { author: 'Ada', quote: 'x', rating: 'five' })).rejects.toMatchObject({
      fields: { rating: ['Expected a number'] },
    })

    await expect(create(app, { author: 'Ada', quote: 'x', isAdmin: true })).rejects.toThrowError(
      ValidationError,
    )
  })

  it('filters, searches and paginates over JSONB', async () => {
    const { app, resource } = build()

    await create(app, { author: 'Ada', quote: 'It compiles', rating: 5, featured: true })
    await create(app, { author: 'Alan', quote: 'It thinks', rating: 3, featured: false })
    await create(app, { author: 'Grace', quote: 'It compiles well', rating: 5, featured: false })

    expect((await resource.list({ filters: { rating: 5 } })).total).toBe(2)
    expect((await resource.list({ filters: { featured: true } })).total).toBe(1)

    const searched = await resource.list({ search: 'compiles' })
    expect(searched.total).toBe(2)

    const byAuthor = await resource.list({ search: 'Alan' })
    expect(byAuthor.total).toBe(1)

    const page = await resource.list()
    expect(page).toMatchObject({ total: 3, perPage: 2, lastPage: 2 })
  })

  /**
   * The ordering, read off what the adapter was actually asked for.
   *
   * Asserted against the Query AST rather than against the rows that come back,
   * because the rows are the adapter's answer and the defect is a *missing
   * instruction*. An in-memory store returns insertion order whether it was told to
   * or not, so a test that reads the rows agrees with the bug — which is how a
   * listing shipped with no `ORDER BY` at all.
   */
  it('always tells the database how to order, and how to break a tie', async () => {
    const { app, resource } = build()

    await create(app, { author: 'Ada', quote: 'It compiles' })

    const asked: { limit?: unknown; order?: unknown }[] = []
    const underneath = adapter.execute.bind(adapter)

    adapter.execute = async (query, context) => {
      asked.push(query as { limit?: unknown; order?: unknown })

      return await underneath(query, context)
    }

    // `paginate` asks twice — how many there are, and which ones are on this page.
    // The one that takes a page is the one an ordering decides.
    const paged = () => asked.find((query) => query.limit !== undefined)?.order

    await resource.list()

    expect(paged()).toEqual([
      { field: 'createdAt', direction: 'desc' },
      { field: 'id', direction: 'asc' },
    ])

    asked.length = 0
    await resource.list({ sort: 'status' })

    // `status` ties for every draft in the collection, so the key underneath it is
    // what stops page two from repeating page one.
    expect(paged()).toEqual([
      { field: 'status', direction: 'asc' },
      { field: 'id', direction: 'asc' },
    ])
  })

  it('pages through a collection without repeating or losing a row', async () => {
    const { app, resource } = build()

    // All alike on everything but their identity: same author, same status, written
    // as fast as the machine allows. Whatever the ordering leads with, these tie.
    for (let index = 0; index < 25; index++) {
      await create(app, { author: 'Ada', quote: `Note ${index}` })
    }

    const seen: string[] = []
    let page = 1

    while (true) {
      const answered = await resource.list({ page, perPage: 4, sort: 'status' })

      seen.push(...answered.data.map((entry) => String((entry as { id: unknown }).id)))

      if (page >= answered.lastPage) break

      page++
    }

    expect(seen).toHaveLength(25)
    expect(new Set(seen).size).toBe(25)
  })

  it('refuses a filter the definition did not mark filterable', async () => {
    const { app, resource } = build()
    await create(app, { author: 'Ada', quote: 'x' })

    await expect(resource.list({ filters: { author: 'Ada' } })).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    })
  })

  it('soft-deletes an entry rather than losing it', async () => {
    const { app, resource } = build()
    const created = await create(app, { author: 'Ada', quote: 'x' })

    await app.commands.execute('entries.delete', { resource: 'testimonials', id: created.id })

    expect((await resource.list()).total).toBe(0)
    expect(adapter.rows('assemora_resource_entries')).toHaveLength(1)
  })
})

describe('a dynamic resource hides what it declared hidden (SPEC.md §28)', () => {
  const leads: DynamicDefinition = {
    name: 'leads',
    label: 'Leads',
    fields: [
      { name: 'company', kind: 'text', required: true },
      { name: 'score', kind: 'number', hidden: true },
    ],
  }

  const build = () => {
    const resource = dynamicResource(parseDynamicDefinition(leads), { id: RESOURCE_ID })

    const app = createApplication({
      modules: [module('content').resources(resource)],
      authorization: permitAll(),
    })

    return { app, resource }
  }

  it('does not return a hidden field, though the data is one JSONB blob', async () => {
    const { app, resource } = build()

    await app.commands.execute('entries.create', {
      resource: 'leads',
      data: { company: 'Acme', score: 91 },
    })

    const listed = await resource.list()

    expect(listed.data[0]).toHaveProperty('company', 'Acme')
    // Spreading the JSONB whole used to hand this to anybody who asked.
    expect(listed.data[0]).not.toHaveProperty('score')
  })

  it('still records the whole row in a revision, so a restore loses nothing', async () => {
    const { app } = build()

    const created = (await app.commands.execute('entries.create', {
      resource: 'leads',
      data: { company: 'Acme', score: 91 },
    })) as { entry: Record<string, unknown> }

    expect(created.entry).toMatchObject({ company: 'Acme', score: 91 })
  })
})
