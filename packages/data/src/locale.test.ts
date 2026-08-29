/**
 * A read knows its own language, and answers in it (SPEC.md §131).
 *
 * The rows below are the shape §131 fixes: one row per language, `translationOf`
 * pointing at the original or null for one. `Dish 2` is translated into Russian and
 * `Dish 1` is not, which is the whole question — a catalogue that showed a hundred
 * dishes in Ukrainian and twenty in Russian is not a Russian catalogue.
 */

import { createContext, runInContext } from '@assemora/core'
import { createMemoryAdapter, type MemoryAdapter } from '@assemora/database'
import { beforeEach, describe, expect, it } from 'vitest'

import { boolean, string, uuid } from './columns.js'
import { model } from './model.js'
import { useAdapter } from './runtime.js'

const Dish = model('dishes', {
  id: uuid().primary(),
  title: string(),
  visible: boolean(),
}).translatable()

let adapter: MemoryAdapter

const uk = (locale: string | undefined) =>
  createContext({
    source: 'internal',
    ...(locale === undefined ? {} : { locale }),
    locales: { locales: ['uk', 'en', 'ru'], defaultLocale: 'uk' },
  })

const speaking = <T>(locale: string | undefined, operation: () => Promise<T>): Promise<T> =>
  runInContext(uk(locale), operation)

beforeEach(() => {
  adapter = createMemoryAdapter({
    dishes: [
      { id: 'd1', title: 'Піца Папа Котта', visible: true, locale: 'uk', translationOf: null },
      { id: 'd2', title: 'Борщ', visible: true, locale: 'uk', translationOf: null },
      { id: 'd2-ru', title: 'Борщ', visible: true, locale: 'ru', translationOf: 'd2' },
      { id: 'd3', title: 'Прихована', visible: false, locale: 'uk', translationOf: null },
    ],
  })

  useAdapter(adapter)
})

const titles = (rows: readonly { title: unknown }[]) => rows.map((row) => row.title)

describe('the context decides and the query obeys', () => {
  it('filters by the language of the operation, without a caller asking', async () => {
    const ast = await speaking('ru', async () => Dish.toAst())

    expect(ast.where).toEqual([
      { kind: 'comparison', combinator: 'and', field: 'locale', operator: '=', value: 'ru' },
    ])
  })

  it('says nothing about a language on a model that is not translatable', async () => {
    const Plain = model('plain', { id: uuid().primary(), title: string() })

    expect(await speaking('ru', async () => Plain.toAst().where)).toEqual([])
  })

  it('says nothing outside a context, which is what a migration reads in', () => {
    expect(Dish.toAst().where).toEqual([])
  })

  it('reads a language the caller named, whatever the operation is in', async () => {
    const ast = await speaking('ru', async () => Dish.inLocale('uk').toAst())

    expect(ast.where[0]).toMatchObject({ field: 'locale', value: 'uk' })
  })

  it('reads every translation when asked for all of them', async () => {
    const rows = await speaking('ru', async () => Dish.allLocales().get())

    expect(rows).toHaveLength(4)
  })
})

describe('a missing translation falls back to the default language', () => {
  it('answers the untranslated row in the language it is written in', async () => {
    const rows = await speaking('ru', async () => Dish.where('visible', true).get())

    // Борщ in Russian, and Піца in Ukrainian because there is no Russian Борщ… no:
    // because there is no Russian pizza. Two rows, one per dish, never both of Борщ.
    expect(titles(rows)).toHaveLength(2)
    expect(rows.map((row) => row.locale).sort()).toEqual(['ru', 'uk'])
    expect(rows.find((row) => row.locale === 'uk')?.title).toBe('Піца Папа Котта')
  })

  it('carries the caller’s own filter into the fallback', async () => {
    // `visible: false` is filtered out in both languages, not only in the one asked for.
    const rows = await speaking('ru', async () => Dish.where('visible', true).get())

    expect(titles(rows)).not.toContain('Прихована')
  })

  it('counts what it would answer, and not the rows behind it', async () => {
    expect(await speaking('ru', async () => Dish.where('visible', true).count())).toBe(2)
  })

  it('answers only what is written when the fallback is turned off', async () => {
    const rows = await speaking('ru', async () => Dish.withoutFallback().get())

    expect(titles(rows)).toEqual(['Борщ'])
  })

  it('does not fall back when reading the default language itself', async () => {
    const rows = await speaking('uk', async () => Dish.where('visible', true).get())

    expect(rows.map((row) => row.locale)).toEqual(['uk', 'uk'])
  })
})

describe('translated() follows a relation to the entry rather than to the row', () => {
  it('answers the row of this entry in the language being read', async () => {
    // `d2` is the Ukrainian original; asking for it in Russian gives the Russian row.
    const found = await speaking('ru', async () => Dish.translated('d2'))

    expect(found?.id).toBe('d2-ru')
    expect(found?.locale).toBe('ru')
  })

  it('works from either row of the entry, because a foreign key names one of them', async () => {
    const found = await speaking('uk', async () => Dish.translated('d2-ru'))

    expect(found?.id).toBe('d2')
  })

  it('falls back like any other read', async () => {
    const found = await speaking('ru', async () => Dish.translated('d1'))

    expect(found?.locale).toBe('uk')
  })

  it('is find() on a model that is not translatable', async () => {
    const Plain = model('plain_two', { id: uuid().primary(), title: string() })

    expect(await speaking('ru', async () => Plain.translated('nothing'))).toBeNull()
  })
})
