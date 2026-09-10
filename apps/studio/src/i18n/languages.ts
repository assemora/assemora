/**
 * The language Studio is read in — a tag, not a member of a list.
 *
 * Not the language it edits. A deployment's `locales` are a fact about the *content*
 * (SPEC.md §131): they decide which rows a listing holds, they come from the Schema
 * Registry, and a project that serves one language has no choice to make. This is the
 * other question — what language the buttons, the headings and the refusals are written
 * in — and it is a fact about the *person*. A Ukrainian shop whose developer reads
 * English, and an English shop whose editor reads Ukrainian, are both ordinary, so the
 * two are never one control.
 *
 * What used to be here was `LANGUAGES = ['en', 'uk', 'ru']`, and it was a ceiling: the
 * three languages its author happened to write shipped inside every bundle, and no
 * deployment could remove one or add a fourth. ADR-0034 replaced it. English is still
 * compiled in, because it is the source every other reading falls back to and a bundle
 * without it could not draw a screen at all; every other language is a pack, and what a
 * deployment offers is read from the manifest beside the bundle rather than known here.
 */

/**
 * The language every message is written in first.
 *
 * It is the source in three senses: it is what a new key is drafted in, it is the
 * reading the parameter names are taken from — `{count}` in the English is what makes
 * `count` required at the call site — and it is what a pack that is missing a key falls
 * back to, one key at a time.
 */
export const SOURCE = 'en'

/**
 * A BCP-47 language tag.
 *
 * A bare `string` rather than a union, which is the whole of the change: a union is a
 * list, and a list is the thing that could not be added to. Nothing is lost at the call
 * site, because no call site ever passed a language — `t('common.save')` names a key and
 * the language comes from the context around it. What a tag *is* is checked where one
 * arrives from outside, by `isLanguage`, and never assumed.
 */
export type Language = string

/** A language on offer: the tag to ask for, and what the switcher prints. */
export type Offered = {
  readonly tag: Language
  /** How the language names itself, in itself. Never in English. */
  readonly name: string
}

/**
 * Whether a tag is one `Intl` will accept.
 *
 * Everything downstream hands the tag to `Intl.PluralRules`, `Intl.NumberFormat` and
 * `toLocaleDateString`, all of which throw on a malformed one. Asking the same library
 * that will be given it is the only check that cannot disagree with them — a regular
 * expression for BCP-47 would be a second opinion, and the wrong one on the day it
 * differs.
 */
export const isLanguage = (value: string): boolean => {
  try {
    return Intl.getCanonicalLocales(value).length === 1
  } catch {
    return false
  }
}

/** The base subtag: `uk` of `uk-UA`, and `en` of `en-GB`. */
const base = (tag: string): string => tag.toLowerCase().split('-')[0] ?? ''

/**
 * Which of the offered languages to open in, before anybody has chosen one.
 *
 * `navigator.languages` is the ordered list the person set in their own browser, so it
 * is the one honest guess available on a first visit — better than English for everyone,
 * which is what a fixed default means to every reader who did not pick it.
 *
 * Matched on the base tag, and in the browser's order rather than the manifest's: a
 * person whose first language is Ukrainian gets Ukrainian even where the deployment
 * lists it last. `en-GB` finds an `en` pack; it does not find Ukrainian because the
 * region failed to match exactly.
 */
export const preferred = (offered: readonly Offered[], wanted: readonly string[]): Language => {
  for (const tag of wanted) {
    const found = offered.find((language) => base(language.tag) === base(tag))

    if (found !== undefined) return found.tag
  }

  return SOURCE
}
