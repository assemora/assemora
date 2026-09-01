/**
 * The languages Studio itself speaks.
 *
 * Not the languages it edits. A deployment's `locales` are a fact about the *content*
 * (SPEC.md §131): they decide which rows a listing holds, they come from the Schema
 * Registry, and a project that serves one language has no choice to make. This is the
 * other question — what language the buttons, the headings and the refusals are written
 * in — and it is a fact about the *person*. A Ukrainian shop whose developer reads
 * English, and an English shop whose editor reads Ukrainian, are both ordinary, so the
 * two are never one control.
 *
 * The set is fixed by the bundle rather than by the application, because these strings
 * ship inside Studio: an application cannot add a language to a build it did not make.
 * Adding one is `LANGUAGES`, a column in every message and nothing else — the catalogue
 * types say so, and the compiler is what refuses a half-translated fourth language.
 */

export const LANGUAGES = ['en', 'uk', 'ru'] as const

export type Language = (typeof LANGUAGES)[number]

/**
 * The language every message is written in first.
 *
 * It is the source in two senses: it is what a new key is drafted in, and it is the
 * reading the parameter names are taken from — `{count}` in the English is what makes
 * `count` required at the call site.
 */
export const SOURCE: Language = 'en'

/** What the switcher prints. A language names itself in itself, never in English. */
export const LANGUAGE_NAMES: Readonly<Record<Language, string>> = {
  en: 'English',
  uk: 'Українська',
  ru: 'Русский',
}

export const isLanguage = (value: string): value is Language =>
  (LANGUAGES as readonly string[]).includes(value)

/**
 * Which language to open in, before anybody has chosen one.
 *
 * `navigator.languages` is the ordered list the person set in their own browser, so it
 * is the one honest guess available on a first visit — better than English for everyone,
 * which is what a fixed default means to the two thirds of this list who did not pick it.
 *
 * Matched on the base tag: `uk-UA` and `ru-RU` are Ukrainian and Russian, and a person
 * who reads `en-GB` is not shown Ukrainian because the region did not match exactly.
 */
export const preferred = (offered: readonly string[]): Language => {
  for (const tag of offered) {
    const base = tag.toLowerCase().split('-')[0] ?? ''

    if (isLanguage(base)) return base
  }

  return SOURCE
}
