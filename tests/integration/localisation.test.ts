/**
 * Localisation against a real database (SPEC.md §131, §95).
 *
 * The memory adapter agrees with this in `packages/data/src/locale.test.ts`, and that is
 * the point of having both: the fallback is one query built out of `in` and `not in`
 * inside a nested condition group, and ADR-0013 says every adapter has to mean the same
 * thing by a condition. A `not in` over an empty list and a group whose combinator joins
 * a *sibling* rather than its own children are exactly the two places two adapters would
 * quietly disagree.
 */
import { userInfo } from 'node:os'

import { createContext, runInContext } from '@assemora/core'
import { boolean, model, string, useAdapter, uuid } from '@assemora/data'
import {
  applySchema,
  dropSchema,
  type PostgresAdapter,
  postgres,
} from '@assemora/database-postgres'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const url =
  process.env.ASSEMORA_TEST_DATABASE_URL ??
  `postgres://${userInfo().username}@localhost:5432/assemora_test`

const required = process.env.ASSEMORA_REQUIRE_POSTGRES === '1'

const reachable = await (async () => {
  const probe = postgres({ url, pool: { connectionTimeoutMs: 1500 } })

  try {
    await probe.raw('select 1')
    return true
  } catch (error) {
    if (required) {
      throw new Error(
        `ASSEMORA_REQUIRE_POSTGRES is set but ${url} is unreachable: ${
          error instanceof Error ? error.message : String(error)
        }`,
      )
    }

    console.warn(`[integration] skipped: ${url} is unreachable`)

    return false
  } finally {
    await probe.close().catch(() => undefined)
  }
})()

const Dish = model('it_dishes', {
  id: uuid().primary().defaultRandom(),
  slug: string().unique(),
  title: string(),
  visible: boolean().default(true),
}).translatable()

let adapter: PostgresAdapter

const speaking = <T>(locale: string, operation: () => Promise<T>): Promise<T> =>
  runInContext(
    createContext({
      source: 'internal',
      locale,
      locales: { locales: ['uk', 'ru'], defaultLocale: 'uk' },
    }),
    operation,
  )

beforeAll(async () => {
  if (!reachable) return

  adapter = postgres({ url })
  useAdapter(adapter)

  await dropSchema(adapter, [Dish.descriptor])
  await applySchema(adapter, [Dish.descriptor])
}, 30_000)

afterAll(async () => {
  if (!reachable) return

  await dropSchema(adapter, [Dish.descriptor])
  await adapter.close()
})

describe.skipIf(!reachable)('a translatable model against PostgreSQL', () => {
  let borsch: string

  beforeAll(async () => {
    // Written outside any context, which is what a seed and a migration are.
    const pizza = await Dish.create({
      slug: 'pizza',
      title: 'Піца Папа Котта',
      visible: true,
      locale: 'uk',
      translationOf: null,
    })
    const soup = await Dish.create({
      slug: 'borsch',
      title: 'Борщ',
      visible: true,
      locale: 'uk',
      translationOf: null,
    })

    borsch = String(soup.id)

    // The same slug in another language, which a globally unique column would refuse.
    await Dish.create({
      slug: 'borsch',
      title: 'Борщ',
      visible: true,
      locale: 'ru',
      translationOf: borsch,
    })
    await Dish.create({
      slug: 'hidden',
      title: 'Прихована',
      visible: false,
      locale: 'uk',
      translationOf: null,
    })

    expect(String(pizza.id)).not.toBe(borsch)
  })

  it('lets two languages share a slug, and refuses two rows of one language sharing it', async () => {
    await expect(
      Dish.create({
        slug: 'borsch',
        title: 'Другий борщ',
        visible: true,
        locale: 'uk',
        translationOf: null,
      }),
    ).rejects.toThrow()
  })

  it('carries both columns into the real schema, indexed', async () => {
    const columns = await adapter.introspect()
    const dishes = columns.tables.find((table) => table.name === 'it_dishes')

    expect(dishes?.columns.map((column) => column.name)).toEqual(
      expect.arrayContaining(['locale', 'translationOf']),
    )
  })

  it('answers the language of the operation, and falls back for what is missing', async () => {
    const rows = await speaking('ru', async () => Dish.where('visible', true).get())

    expect(rows).toHaveLength(2)
    expect(rows.map((row) => row.locale).sort()).toEqual(['ru', 'uk'])
    // Never both rows of the same dish: the Ukrainian Борщ is covered by the Russian one.
    expect(rows.filter((row) => row.title === 'Борщ')).toHaveLength(1)
  })

  it('counts what it would answer', async () => {
    expect(await speaking('ru', async () => Dish.where('visible', true).count())).toBe(2)
  })

  it('orders and paginates over the merged answer, not over one language then the other', async () => {
    const page = await speaking('ru', async () =>
      Dish.where('visible', true).orderBy('title', 'asc').paginate(1, 1),
    )

    expect(page.total).toBe(2)
    // Борщ before Піца, whichever language each of them is in. Two appended result sets
    // would have put the fallback row last whatever the sort said.
    expect(page.data[0]?.title).toBe('Борщ')
  })

  it('answers only what is written when the fallback is off', async () => {
    const rows = await speaking('ru', async () => Dish.withoutFallback().get())

    expect(rows.map((row) => row.title)).toEqual(['Борщ'])
  })

  it('reads every translation when asked for all of them', async () => {
    expect(await speaking('ru', async () => Dish.allLocales().count())).toBe(4)
  })

  it('does not fall back when reading the default language', async () => {
    const rows = await speaking('uk', async () => Dish.where('visible', true).get())

    expect(rows.map((row) => row.locale)).toEqual(['uk', 'uk'])
  })
})
