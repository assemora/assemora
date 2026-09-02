/**
 * The catalogue's own invariants (SPEC.md §115).
 *
 * Four of the five below cannot be argued with by a translator, which is the point: a
 * missing language, a hole a translation invented, a plural with two forms instead of
 * three and a key lost to a duplicate are all mistakes that read as ordinary text on a
 * screen nobody has opened in that language yet.
 *
 * The fifth — that `t` refuses the wrong call — is checked by the compiler rather than
 * here: `pnpm typecheck` covers this file, so the `@ts-expect-error` lines at the end
 * fail the build if the machinery ever stops catching what they say it catches.
 */
import { describe, expect, it } from 'vitest'

import { formOf } from './catalogue.ts'
import { isLanguage, LANGUAGE_NAMES, LANGUAGES, preferred, SOURCE } from './languages.ts'
import { MESSAGES, type MessageKey, SLICES, type Translate, translator } from './messages.ts'

const entries = Object.entries(MESSAGES) as readonly (readonly [MessageKey, unknown])[]

/** Every `{name}` in one reading of a message. */
const holesOf = (text: string): readonly string[] =>
  [...text.matchAll(/\{(\w+)\}/g)].map((match) => match[1] ?? '')

const readings = (message: unknown, language: string): readonly string[] => {
  const value = (message as Record<string, string | readonly string[]>)[language]

  return typeof value === 'string' ? [value] : (value ?? [])
}

describe('the catalogue', () => {
  it('says everything in every language Studio speaks', () => {
    for (const [key, message] of entries) {
      for (const language of LANGUAGES) {
        expect(readings(message, language).length, `${key} in ${language}`).toBeGreaterThan(0)
      }
    }
  })

  it('loses nothing when the slices are merged', () => {
    // A key written into two slices would silently be one key, and the second would win
    // — the failure mode of assembling an object out of parts.
    const written = SLICES.reduce((total, slice) => total + Object.keys(slice).length, 0)

    expect(Object.keys(MESSAGES).length).toBe(written)
  })

  it('never lets a translation invent a hole the English does not have', () => {
    // The other direction is allowed and used: `entries.blank.title` says the resource's
    // name in English and leaves it to the heading in Ukrainian, because a foreign noun
    // cannot be declined into a Slavic sentence. An *extra* hole is always a typo, and
    // it renders as `{naem}` on the screen.
    for (const [key, message] of entries) {
      const english = new Set(readings(message, SOURCE).flatMap(holesOf))

      for (const language of LANGUAGES) {
        for (const reading of readings(message, language)) {
          for (const hole of holesOf(reading)) {
            expect(english, `${key} in ${language} names {${hole}}`).toContain(hole)
          }
        }
      }
    }
  })

  it('gives a counted message three forms, each holding its number', () => {
    for (const [key, message] of entries) {
      const forms = readings(message, SOURCE)

      if (forms.length === 1) continue

      for (const language of LANGUAGES) {
        const written = readings(message, language)

        expect(written.length, `${key} in ${language}`).toBe(3)

        for (const form of written) {
          expect(form, `${key} in ${language}`).toContain('{count}')
        }
      }
    }
  })
})

describe('counting', () => {
  /**
   * The rule is not one rule, and 21 is where that shows.
   *
   * Under the Slavic rule 21 takes the *first* form, which is right for `21 запис` and
   * wrong for `21 item`. Sharing one function between the three languages is the bug
   * this table exists to refuse.
   */
  it('follows each language rather than one rule for all of them', () => {
    expect([1, 2, 5, 11, 21].map((count) => formOf('uk', count))).toEqual([0, 1, 2, 2, 0])
    expect([1, 2, 5, 11, 21].map((count) => formOf('ru', count))).toEqual([0, 1, 2, 2, 0])
    expect([1, 2, 5, 11, 21].map((count) => formOf('en', count))).toEqual(
      [1, 1, 1, 1, 1].map((_, index) => (index === 0 ? 0 : 1)),
    )
  })

  it('picks the form a number takes in the language being read', () => {
    const uk = translator('uk')

    expect(uk('collection.entryCount', { count: 1 })).toBe('1 запис')
    expect(uk('collection.entryCount', { count: 3 })).toBe('3 записи')
    expect(uk('collection.entryCount', { count: 7 })).toBe('7 записів')
    expect(translator('en')('collection.entryCount', { count: 7 })).toBe('7 entries')
  })
})

describe('a message with holes in it', () => {
  it('fills them from what the call site passed', () => {
    expect(translator('en')('collection.unknown', { name: 'wormholes' })).toBe(
      'No collection called “wormholes”',
    )
  })

  it('writes a number the way the language writes one', () => {
    // `12 480` in Ukrainian and `12,480` in English — and the Ukrainian space is a
    // no-break one, which is exactly why the number goes through `Intl` rather than
    // through `String()`. Compared against `Intl`'s own answer for that reason: what is
    // being pinned is that the language decides, not which byte it decided on.
    const grouped = new Intl.NumberFormat('uk').format(12480)

    expect(grouped).not.toBe('12480')
    expect(translator('uk')('collection.entryCount', { count: 12480 })).toBe(`${grouped} записів`)
    expect(translator('en')('collection.entryCount', { count: 12480 })).toBe('12,480 entries')
    // A value that must not be grouped is passed as a string: `v1,024` is not a version.
    expect(translator('en')('builder.published', { version: '1024' })).toBe('Published · v1024')
  })
})

describe('the language Studio opens in', () => {
  it('is the first one the browser asks for that Studio speaks', () => {
    expect(preferred(['uk-UA', 'en-GB'])).toBe('uk')
    expect(preferred(['de-DE', 'ru'])).toBe('ru')
  })

  it('falls back to the language every message is written in first', () => {
    expect(preferred(['de-DE', 'fr'])).toBe(SOURCE)
    expect(preferred([])).toBe(SOURCE)
  })

  it('names each language in itself, never in English', () => {
    expect(LANGUAGE_NAMES.uk).toBe('Українська')
    expect(isLanguage('uk')).toBe(true)
    expect(isLanguage('de')).toBe(false)
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
    expect(translator('en')('common.cancel')).toBe('Cancel')
  })
})
