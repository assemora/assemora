/**
 * `entries.translate` — a translation is a change like any other (SPEC.md §131, §75).
 *
 * It goes through the Command Bus, so it is validated, authorized, revised and audited,
 * and an agent reaches it as a generated tool rather than through a surface of its own.
 * That is §131's own requirement: *"this is the case AI is actually good at, and it must
 * not need a second surface"*.
 */
import {
  collectRevisions,
  createApplication,
  module,
  permitAll,
  ValidationError,
} from '@assemora/core'
import { dataTransactions, model, string, useAdapter, uuid } from '@assemora/data'
import { createMemoryAdapter } from '@assemora/database'
import { beforeEach, describe, expect, it } from 'vitest'

import { text } from './fields.js'
import { clearResourceRegistry } from './registry.js'
import { resource } from './resource.js'
import './module.js'

const Dish = model('dishes', {
  id: uuid().primary().defaultRandom(),
  title: string(),
  ingredients: string(),
}).translatable()

const Plain = model('plain_dishes', {
  id: uuid().primary().defaultRandom(),
  title: string(),
})

const build = () => {
  const revisions = collectRevisions()

  const app = createApplication({
    modules: [
      module('menu').resources(
        resource(Dish, { title: text().required(), ingredients: text() }),
        resource(Plain, { title: text().required() }, { name: 'plain' }),
      ),
    ],
    authorization: permitAll(),
    transactions: dataTransactions(),
    revisions,
    locales: ['uk', 'en', 'ru'],
  })

  return { app, revisions }
}

const speaking = <T>(
  app: ReturnType<typeof build>['app'],
  locale: string,
  operation: () => Promise<T>,
): Promise<T> => app.run({ source: 'internal', locale }, operation)

beforeEach(() => {
  clearResourceRegistry()
  useAdapter(createMemoryAdapter({ dishes: [], plain_dishes: [] }))
})

const created = async (app: ReturnType<typeof build>['app'], locale = 'uk') =>
  speaking(app, locale, async () =>
    app.commands.execute('entries.create', {
      resource: 'dishes',
      data: { title: 'Борщ', ingredients: 'буряк, капуста' },
    }),
  ) as Promise<{ id: string; entry: Record<string, unknown> }>

describe('an entry is written in the language it was created in', () => {
  it('sets the language from the operation, and translates nothing', async () => {
    const { app } = build()
    const { entry } = await created(app)

    expect(entry.locale).toBe('uk')
    expect(entry.translationOf).toBeNull()
  })

  it('reads back in the language of the operation, and says which it is in', async () => {
    const { app } = build()

    await created(app)

    const listed = (await speaking(app, 'ru', async () =>
      app.queries.execute('entries.list', { resource: 'dishes' }),
    )) as { data: readonly Record<string, unknown>[] }

    // Untranslated, so the Ukrainian row answers — and says so.
    expect(listed.data).toHaveLength(1)
    expect(listed.data[0]?.locale).toBe('uk')
  })
})

describe('entries.translate', () => {
  it('writes the entry in another language, starting from the original', async () => {
    const { app } = build()
    const { id } = await created(app)

    const translated = (await speaking(app, 'uk', async () =>
      app.commands.execute('entries.translate', {
        resource: 'dishes',
        id,
        locale: 'ru',
        data: { title: 'Борщ по-русски' },
      }),
    )) as { id: string; entry: Record<string, unknown> }

    expect(translated.entry.locale).toBe('ru')
    expect(translated.entry.translationOf).toBe(id)
    expect(translated.entry.title).toBe('Борщ по-русски')
    // What the caller did not send is the original's, not empty: a translator fills a
    // form that already holds the text being translated.
    expect(translated.entry.ingredients).toBe('буряк, капуста')
  })

  it('is a revision of its own, because a translation is a row', async () => {
    const { app, revisions } = build()
    const { id } = await created(app)

    await speaking(app, 'uk', async () =>
      app.commands.execute('entries.translate', { resource: 'dishes', id, locale: 'ru' }),
    )

    const written = revisions.entries.filter((entry) => entry.entityType === 'dishes')

    expect(written).toHaveLength(2)
    expect(written[1]?.before).toBeNull()
  })

  it('makes the translation the one the language reads', async () => {
    const { app } = build()
    const { id } = await created(app)

    await speaking(app, 'uk', async () =>
      app.commands.execute('entries.translate', {
        resource: 'dishes',
        id,
        locale: 'ru',
        data: { title: 'Борщ по-русски' },
      }),
    )

    const listed = (await speaking(app, 'ru', async () =>
      app.queries.execute('entries.list', { resource: 'dishes' }),
    )) as { data: readonly Record<string, unknown>[] }

    expect(listed.data).toHaveLength(1)
    expect(listed.data[0]?.title).toBe('Борщ по-русски')
    expect(listed.data[0]?.locale).toBe('ru')
  })

  it('refuses a language this deployment does not serve', async () => {
    const { app } = build()
    const { id } = await created(app)

    await expect(
      speaking(app, 'uk', async () =>
        app.commands.execute('entries.translate', { resource: 'dishes', id, locale: 'de' }),
      ),
    ).rejects.toThrow(/not a language this deployment serves/)
  })

  it('refuses a second translation into the same language', async () => {
    const { app } = build()
    const { id } = await created(app)

    await speaking(app, 'uk', async () =>
      app.commands.execute('entries.translate', { resource: 'dishes', id, locale: 'ru' }),
    )

    await expect(
      speaking(app, 'uk', async () =>
        app.commands.execute('entries.translate', { resource: 'dishes', id, locale: 'ru' }),
      ),
    ).rejects.toThrow(/already translated/)
  })

  it('refuses translating a row into the language it is already in', async () => {
    const { app } = build()
    const { id } = await created(app)

    await expect(
      speaking(app, 'uk', async () =>
        app.commands.execute('entries.translate', { resource: 'dishes', id, locale: 'uk' }),
      ),
    ).rejects.toThrow(/already written in/)
  })

  it('hangs a translation of a translation off the original', async () => {
    const { app } = build()
    const { id } = await created(app)

    const russian = (await speaking(app, 'uk', async () =>
      app.commands.execute('entries.translate', { resource: 'dishes', id, locale: 'ru' }),
    )) as { id: string }

    const english = (await speaking(app, 'ru', async () =>
      app.commands.execute('entries.translate', {
        resource: 'dishes',
        id: russian.id,
        locale: 'en',
      }),
    )) as { entry: Record<string, unknown> }

    // Otherwise the fallback, which groups by `translationOf`, would see two entries
    // where the site has one.
    expect(english.entry.translationOf).toBe(id)
  })

  it('refuses a resource whose model is not translatable', async () => {
    const { app } = build()

    const { id } = (await speaking(app, 'uk', async () =>
      app.commands.execute('entries.create', { resource: 'plain', data: { title: 'Борщ' } }),
    )) as { id: string }

    await expect(
      speaking(app, 'uk', async () =>
        app.commands.execute('entries.translate', { resource: 'plain', id, locale: 'ru' }),
      ),
    ).rejects.toThrow(/not translatable/)
  })

  it('validates the translation like any other write', async () => {
    const { app } = build()
    const { id } = await created(app)

    await expect(
      speaking(app, 'uk', async () =>
        app.commands.execute('entries.translate', {
          resource: 'dishes',
          id,
          locale: 'ru',
          data: { title: 42 },
        }),
      ),
    ).rejects.toThrow(ValidationError)
  })
})
