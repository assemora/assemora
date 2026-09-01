/**
 * What a message is, and how one becomes a sentence.
 *
 * The catalogue holds every language of a key together rather than one file per
 * language, and that is the whole of its correctness: a key is added by writing all
 * three readings at once, they are read against each other while they are being
 * written, and `Readonly<Record<Language, …>>` means the compiler refuses a key that
 * has English and nothing else. A missing translation is therefore not a thing that
 * can ship and be noticed later by whoever was reading the screen at the time.
 *
 * The price is stated rather than hidden: adding a fourth language does not compile
 * until every message has been written in it. That is the intended shape — a half
 * translated admin panel is the failure this file exists to make impossible — and it
 * is why `LANGUAGES` is a short, deliberate list rather than an open door.
 */
import type { Language } from './languages.ts'

/** One message, in every language Studio speaks. */
export type Phrase = Readonly<Record<Language, string>>

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
 * A message with a number in it, in the three forms Ukrainian and Russian need.
 *
 * English has two and is written as three, which costs one repeated string and saves a
 * second mechanism. The forms are ordered as the Slavic rule reads them: one, a few,
 * many.
 */
export type Plural = Readonly<Record<Language, readonly [Counted, Counted, Counted]>>

export type Message = Phrase | Plural

export type Catalogue = Readonly<Record<string, Message>>

/** What fills the holes in a message. */
export type Values = Readonly<Record<string, string | number>>

/**
 * Which of the three forms a number takes, which is not one rule.
 *
 * Ukrainian and Russian share theirs — one for 1 but not 11, a few for 2–4 but not
 * 12–14, many for the rest — and English does not: 21 is *one* under the Slavic rule
 * and `21 item` is wrong in English. Sharing the rule is the bug this table exists to
 * refuse; a language is added here as well as in the catalogue.
 */
const slavic = (count: number): 0 | 1 | 2 => {
  const ten = count % 10
  const hundred = count % 100

  if (ten === 1 && hundred !== 11) return 0
  if (ten >= 2 && ten <= 4 && (hundred < 10 || hundred >= 20)) return 1

  return 2
}

const FORMS: Readonly<Record<Language, (count: number) => 0 | 1 | 2>> = {
  en: (count) => (count === 1 ? 0 : 1),
  uk: slavic,
  ru: slavic,
}

export const formOf = (language: Language, count: number): 0 | 1 | 2 =>
  FORMS[language](Number.isFinite(count) ? Math.abs(count) : 0)

/**
 * A number as this language writes it: `12 480` in Ukrainian, `12,480` in English.
 *
 * Every number that lands in a message goes through this, which is why a value that
 * must *not* be grouped — a port, a year, an HTTP status somebody may search the web
 * for — is passed to `t` as a string. The rule is one line at the call site and the
 * alternative is a second kind of placeholder.
 */
const number = (language: Language, value: number): string =>
  new Intl.NumberFormat(language).format(value)

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

/**
 * A message in one language, in the form the count asks for, holes still unfilled.
 *
 * Separate from `say` because a sentence with a *node* drawn into it — a name in mono,
 * a link — is filled by React and not by `String.replace`, and both halves have to
 * choose the plural form the same way (see `useWoven`).
 */
export const reading = (language: Language, message: Message, count: unknown): string => {
  const forms = message[language]

  if (typeof forms === 'string') return forms

  return forms[formOf(language, typeof count === 'number' ? count : 0)]
}

/** One message, in one language, with its holes filled. */
export const say = (language: Language, message: Message, values: Values): string =>
  fill(language, reading(language, message, values.count), values)
