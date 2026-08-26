import { createApplication, module, permitAll, ValidationError } from '@assemora/core'
import { useAdapter } from '@assemora/data'
import { createMemoryAdapter, type MemoryAdapter } from '@assemora/database'
import { beforeEach, describe, expect, it } from 'vitest'

import { type DynamicDefinition, dynamicResource, parseDynamicDefinition } from './dynamic.js'
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
