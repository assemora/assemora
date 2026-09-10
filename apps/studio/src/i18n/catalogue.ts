/**
 * What a message is, and how one becomes a sentence.
 *
 * The catalogue holds the **English** reading of every key, compiled into the bundle.
 * It is the source language in every sense that matters here: it is what a key is
 * drafted in, it is what the call-site types are read off, and it is what a language
 * missing that key falls back to. Every other language arrives as a pack — data, fetched
 * beside the bundle (ADR-0034).
 *
 * That is a deliberate move of one guarantee. `Readonly<Record<Language, string>>` used
 * to mean the compiler refused a key written in English and nothing else, which is worth
 * keeping and is kept: a pack this bundle *ships* is a typed module in `packs/`, checked
 * against these keys by `Pack` and by `packs.test.ts`. What changes is that a pack the
 * bundle does *not* ship — one a deployment adds — cannot be checked by a compiler that
 * never saw it, so a key it lacks is answered in English rather than by a blank.
 */

import type { Language } from './languages.ts'
import { SOURCE } from './languages.ts'

/**
 * A form of a counted message. It must hold the number it is counting.
 *
 * `\`${string}{count}${string}\`` is not decoration: the plural form that forgot its
 * number reads as a sentence about nothing — "entries" where "3 entries" was meant —
 * and it is the single most likely typo in a table of three hundred forms. The
 * compiler refuses it instead.
 */
type Counted = `${string}{count}${string}`

/**
 * The two forms English counts in.
 *
 * Named rather than numbered, and only two. What was here before was a three-element
 * tuple ordered one/few/many, with English written as three because Ukrainian and
 * Russian need three — a Slavic shape in the type of every language's plural. Arabic
 * takes six forms and Japanese takes one, so a fixed arity was a second ceiling beside
 * the fixed list, and CLDR's names are what removes it.
 */
export type EnglishForms = {
  readonly one: Counted
  readonly other: Counted
}

/** One message, in the language it was written in. */
export type Phrase = { readonly en: string }

/** A message with a number in it. */
export type Plural = { readonly en: EnglishForms }

export type Message = Phrase | Plural

export type Catalogue = Readonly<Record<string, Message>>

/** What fills the holes in a message. */
export type Values = Readonly<Record<string, string | number>>

/** CLDR's plural categories. Every language has `other`; the rest it may not. */
export type PluralCategory = 'zero' | 'one' | 'two' | 'few' | 'many' | 'other'

/**
 * The forms a counted message takes in some language.
 *
 * `other` is required and the rest are not, because that is exactly what CLDR
 * guarantees: a language that counts in one form has only `other`, and asking a
 * translator for `few` in Japanese is asking for a sentence that does not exist.
 */
export type Forms = Readonly<Partial<Record<PluralCategory, string>>> & { readonly other: string }

export type PackMessage = string | Forms

/** A pack's messages as they arrive: keyed by whatever the file happened to hold. */
export type Readings = Readonly<Record<string, PackMessage>>

/**
 * Which form a number takes in a language, asked of the platform.
 *
 * This used to be a table of functions — one rule per language, hand-written, with
 * Ukrainian and Russian sharing theirs and English deliberately not. A function is the
 * one thing a pack could not carry (ADR-0027 is about exactly that: a function does not
 * survive `JSON.stringify`), so a hand-written rule would have pinned the language set
 * shut all over again no matter what happened to the strings.
 *
 * It does not need to be carried. `Intl.PluralRules` knows the rule for every language
 * the browser knows, which is every language CLDR has, and it is the same table the
 * translator was reading from when they wrote the forms.
 */
const RULES = new Map<Language, Intl.PluralRules>()

const rulesFor = (language: Language): Intl.PluralRules => {
  const held = RULES.get(language)

  if (held !== undefined) return held

  // A tag is checked by `isLanguage` where it arrives, so this is the belt to that
  // brace: a manifest edited by hand must not take the screen down.
  const made = (() => {
    try {
      return new Intl.PluralRules(language)
    } catch {
      return new Intl.PluralRules(SOURCE)
    }
  })()

  RULES.set(language, made)

  return made
}

export const categoryOf = (language: Language, count: number): PluralCategory =>
  rulesFor(language).select(Number.isFinite(count) ? Math.abs(count) : 0) as PluralCategory

/**
 * A number as this language writes it: `12 480` in Ukrainian, `12,480` in English.
 *
 * Every number that lands in a message goes through this, which is why a value that
 * must *not* be grouped — a port, a year, an HTTP status somebody may search the web
 * for — is passed to `t` as a string. The rule is one line at the call site and the
 * alternative is a second kind of placeholder.
 */
const number = (language: Language, value: number): string => {
  try {
    return new Intl.NumberFormat(language).format(value)
  } catch {
    return new Intl.NumberFormat(SOURCE).format(value)
  }
}

/** `{name}`, wherever it appears in a message. Global, and used with `split` as well. */
export const HOLE = /\{(\w+)\}/g

/**
 * The holes filled, and an unknown one left as it was written.
 *
 * Left rather than blanked, because `{naem}` on the screen is a typo somebody reports
 * and an empty space is a sentence that merely reads badly.
 */
export const fill = (language: Language, text: string, values: Values): string =>
  text.replace(HOLE, (whole, name: string) => {
    const value = values[name]

    if (value === undefined) return whole

    return typeof value === 'number' ? number(language, value) : value
  })

/** The count a message was given, as a number, or zero where it was given none. */
const counting = (count: unknown): number => (typeof count === 'number' ? count : 0)

/**
 * One translated reading, or nothing where the pack has not got this key.
 *
 * Nothing rather than an empty string, because the caller's fallback is the English
 * source and the two have to be told apart: a pack may legitimately hold `''`.
 */
const translated = (
  language: Language,
  packed: PackMessage | undefined,
  count: unknown,
): string | undefined => {
  if (packed === undefined) return undefined
  if (typeof packed === 'string') return packed

  return packed[categoryOf(language, counting(count))] ?? packed.other
}

/**
 * A message in one language, in the form the count asks for, holes still unfilled.
 *
 * Separate from `say` because a sentence with a *node* drawn into it — a name in mono,
 * a link — is filled by React and not by `String.replace`, and both halves have to
 * choose the plural form the same way (see `useWoven`).
 *
 * The fallback is per key rather than per pack: a pack written against an older Studio
 * is a screen in its own language with the newest sentence in English, which is what a
 * reader can work with. Falling back wholesale would turn one missing key into an
 * English admin panel.
 */
export const reading = (
  language: Language,
  message: Message,
  packed: PackMessage | undefined,
  count: unknown,
): string => {
  const said = translated(language, packed, count)

  if (said !== undefined) return said

  const english = message.en

  if (typeof english === 'string') return english

  return categoryOf(SOURCE, counting(count)) === 'one' ? english.one : english.other
}

/** One message, in one language, with its holes filled. */
export const say = (
  language: Language,
  message: Message,
  packed: PackMessage | undefined,
  values: Values,
): string => fill(language, reading(language, message, packed, values.count), values)
