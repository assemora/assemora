/**
 * The source catalogue's own invariants (SPEC.md §115).
 *
 * English only. Every other language is a pack and is held to its own standard in
 * `packs.test.ts` — which is the shape ADR-0034 chose, and the reason these two files
 * are two: what a compiler can see is one question, and what arrives at run time is
 * another.
 *
 * The one invariant checked by the compiler rather than here is that `t` refuses the
 * wrong call: `pnpm typecheck` covers this file, so the `@ts-expect-error` lines at the
 * end fail the build if the machinery ever stops catching what they say it catches.
 */
import { describe, expect, it } from 'vitest'

import { categoryOf } from './catalogue.ts'
import { isLanguage, preferred, SOURCE } from './languages.ts'
import { ENGLISH } from './load.ts'
import { MESSAGES, type MessageKey, SLICES, type Translate, translator } from './messages.ts'

const entries = Object.entries(MESSAGES) as readonly (readonly [MessageKey, unknown])[]

const UKRAINIAN = { tag: 'uk', name: 'Українська' }
const nothing = {}

describe('the catalogue', () => {
  it('loses nothing when the slices are merged', () => {
    // A key written into two slices would silently be one key, and the second would win
    // — the failure mode of assembling an object out of parts.
    const written = SLICES.reduce((total, slice) => total + Object.keys(slice).length, 0)

    expect(Object.keys(MESSAGES).length).toBe(written)
  })

  it('gives a counted message the two forms English counts in, each holding its number', () => {
    for (const [key, message] of entries) {
      const english = (message as { en: string | Record<string, string> }).en

      if (typeof english === 'string') continue

      expect(Object.keys(english).sort(), `${key}`).toEqual(['one', 'other'])

      for (const form of Object.values(english)) {
        expect(form, `${key}`).toContain('{count}')
      }
    }
  })
})

describe('counting', () => {
  /**
   * The rule is not one rule, and 21 is where that shows.
   *
   * Under the Slavic rule 21 takes the form 1 takes, which is right for `21 запис` and
   * wrong for `21 item`. What used to prove this was a hand-written table of functions;
   * what proves it now is that `Intl` is asked per language, which is also what made a
   * language expressible as a file (ADR-0034).
   */
  it('follows each language rather than one rule for all of them', () => {
    expect([1, 2, 5, 11, 21].map((count) => categoryOf('uk', count))).toEqual([
      'one',
      'few',
      'many',
      'many',
      'one',
    ])
    expect([1, 2, 5, 11, 21].map((count) => categoryOf('en', count))).toEqual([
      'one',
      'other',
      'other',
      'other',
      'other',
    ])
  })

  it('counts in a language nobody wrote a rule for', () => {
    // The point of asking the platform: Japanese has one form and Arabic has six, and
    // neither was a language this bundle had heard of when the mechanism was written.
    expect(categoryOf('ja', 5)).toBe('other')
    expect(categoryOf('ar', 2)).toBe('two')
  })

  it('picks the form a number takes in the language being read', () => {
    const readings = {
      'collection.entryCount': {
        one: '{count} запис',
        few: '{count} записи',
        many: '{count} записів',
        other: '{count} записів',
      },
    }
    const uk = translator('uk', readings)

    expect(uk('collection.entryCount', { count: 1 })).toBe('1 запис')
    expect(uk('collection.entryCount', { count: 3 })).toBe('3 записи')
    expect(uk('collection.entryCount', { count: 7 })).toBe('7 записів')
    expect(translator(SOURCE, nothing)('collection.entryCount', { count: 7 })).toBe('7 entries')
  })
})

describe('a language whose pack does not hold the key', () => {
  it('answers in English rather than in nothing', () => {
    // Per key, not per pack. A pack written against an older Studio is a screen in its
    // own language with the newest sentence in English, which is a thing a reader can
    // work with; falling back wholesale would turn one missing key into an English
    // admin panel.
    const partial = { 'common.cancel': 'Скасувати' }
    const uk = translator('uk', partial)

    expect(uk('common.cancel')).toBe('Скасувати')
    expect(uk('common.save')).toBe('Save')
  })

  it('answers a counted message in English in the form English would take', () => {
    const uk = translator('uk', nothing)

    expect(uk('collection.entryCount', { count: 1 })).toBe('1 entry')
    // 3 is `few` in Ukrainian and `other` in English, and the reading being used is the
    // English one — so it must be counted the way English counts.
    expect(uk('collection.entryCount', { count: 3 })).toBe('3 entries')
  })
})

describe('a message with holes in it', () => {
  it('fills them from what the call site passed', () => {
    expect(translator(SOURCE, nothing)('collection.unknown', { name: 'wormholes' })).toBe(
      'No collection called “wormholes”',
    )
  })

  it('writes a number the way the language writes one', () => {
    // `12 480` in Ukrainian and `12,480` in English — and the Ukrainian space is a
    // no-break one, which is exactly why the number goes through `Intl` rather than
    // through `String()`. Compared against `Intl`'s own answer for that reason: what is
    // being pinned is that the language decides, not which byte it decided on.
    const grouped = new Intl.NumberFormat('uk').format(12480)
    const readings = {
      'collection.entryCount': {
        one: '{count} запис',
        few: '{count} записи',
        many: '{count} записів',
        other: '{count} записів',
      },
    }

    expect(grouped).not.toBe('12480')
    expect(translator('uk', readings)('collection.entryCount', { count: 12480 })).toBe(
      `${grouped} записів`,
    )
    expect(translator(SOURCE, nothing)('collection.entryCount', { count: 12480 })).toBe(
      '12,480 entries',
    )
    // A value that must not be grouped is passed as a string: `v1,024` is not a version.
    expect(translator(SOURCE, nothing)('builder.published', { version: '1024' })).toBe(
      'Published · v1024',
    )
  })
})

describe('the language Studio opens in', () => {
  const offered = [ENGLISH, UKRAINIAN]

  it('is the first one the browser asks for that this deployment offers', () => {
    expect(preferred(offered, ['uk-UA', 'en-GB'])).toBe('uk')
    expect(preferred(offered, ['de-DE', 'uk'])).toBe('uk')
  })

  it('falls back to the source rather than to a language nobody offered', () => {
    // The list is the deployment's now, so a browser asking for Russian where Russian
    // is not offered gets English — not a tag with no pack behind it.
    expect(preferred(offered, ['ru-RU'])).toBe(SOURCE)
    expect(preferred(offered, [])).toBe(SOURCE)
  })

  it('takes a tag `Intl` accepts, and only that', () => {
    expect(isLanguage('uk')).toBe(true)
    // The set is open now, so a language nobody shipped is still a language: what is
    // checked is the shape of the tag, because everything downstream hands it to `Intl`.
    expect(isLanguage('pt-BR')).toBe(true)
    expect(isLanguage('not a tag')).toBe(false)
    expect(isLanguage('')).toBe(false)
  })
})

/**
 * What the call site may not write.
 *
 * These are assertions in the type system rather than at run time: `pnpm typecheck`
 * compiles this file, and an `@ts-expect-error` over a line that turns out to compile
 * is itself an error. So the day `t` stops asking for a message's parameters, this
 * fails the build.
 */
/** Never called: every line in it is an assertion the compiler makes, not the runner. */
const refused = (t: Translate): void => {
  // @ts-expect-error a message with a hole in it cannot be called without one
  t('collection.unknown')
  // @ts-expect-error and not with a hole it does not have
  t('collection.unknown', { title: 'x' })
  // @ts-expect-error a counted message asks for the number it counts
  t('collection.entryCount', {})
  // @ts-expect-error a message with no holes takes nothing
  t('common.cancel', { name: 'x' })
  // @ts-expect-error and a key the catalogue does not hold is not a key
  t('common.definitelyNotAKey')
}

describe('what does not compile', () => {
  it('asks for the parameters a message names, and only those', () => {
    expect(refused).toBeTypeOf('function')
    expect(translator(SOURCE, nothing)('common.cancel')).toBe('Cancel')
  })
})
