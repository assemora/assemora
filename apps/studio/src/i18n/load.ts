/**
 * Where a language comes from at run time (ADR-0034).
 *
 * Two files beside the bundle, under the base Studio was built with: a manifest saying
 * which languages this deployment offers, and one pack per language. Both are static
 * assets rather than endpoints, which is the property the sign-in screen needs — it is
 * read before anybody has a session, and `/api/_introspection` answers 401 there. The
 * umbrella writes the manifest, because it is the only thing that knows all three facts
 * that decide it: what the bundle ships, what the project added, and what the
 * deployment narrowed the offer to.
 *
 * English is never fetched. It is compiled in, it is what every pack falls back to, and
 * a deployment that served no manifest at all still has a Studio that draws.
 */
import type { Readings } from './catalogue.ts'
import type { Language, Offered } from './languages.ts'
import { isLanguage, SOURCE } from './languages.ts'
import { type LoadedPack, readPack } from './pack.ts'

const BASE = import.meta.env.BASE_URL.replace(/\/+$/, '')

export const ENGLISH: Offered = { tag: SOURCE, name: 'English' }

/** Nothing, for English and for a pack that has not arrived. */
export const NO_READINGS: Readings = {}

const fetchJson = async (path: string): Promise<unknown> => {
  const response = await fetch(`${BASE}${path}`, { headers: { accept: 'application/json' } })

  if (!response.ok) throw new Error(`${path} answered ${response.status}`)

  return response.json()
}

/**
 * The languages on offer, English always among them and always first.
 *
 * Always, because it is the source: a manifest that omitted it would be a deployment
 * where every fallback lands on a language nobody may choose. Always *first* for the
 * same reason a fallback is announced rather than hidden — the list a person reads
 * should open with the one they are certainly being shown.
 *
 * A manifest that is missing, malformed or served as the index document by a
 * single-page fallback leaves English alone rather than an error: Studio has to draw
 * for somebody debugging exactly that.
 */
export const offered = async (): Promise<readonly Offered[]> => {
  const document_ = await fetchJson('/i18n/manifest.json').catch(() => undefined)

  if (typeof document_ !== 'object' || document_ === null) return [ENGLISH]

  const listed = (document_ as { languages?: unknown }).languages

  if (!Array.isArray(listed)) return [ENGLISH]

  const languages: Offered[] = [ENGLISH]

  for (const entry of listed) {
    if (typeof entry !== 'object' || entry === null) continue

    const { tag, name } = entry as { tag?: unknown; name?: unknown }

    if (typeof tag !== 'string' || !isLanguage(tag) || tag === SOURCE) continue
    if (typeof name !== 'string' || name === '') continue
    if (languages.some((language) => language.tag === tag)) continue

    languages.push({ tag, name })
  }

  return languages
}

const HELD = new Map<Language, Readings>()

/**
 * One language's readings, remembered for as long as the tab is open.
 *
 * A failure answers with nothing rather than throwing, and nothing means English: a
 * pack that 404s is a deployment mistake, and the screen that reports it has to be
 * legible. Switching back and forth costs one fetch each way and then none.
 */
export const readingsOf = async (language: Language): Promise<Readings> => {
  if (language === SOURCE) return NO_READINGS

  const held = HELD.get(language)

  if (held !== undefined) return held

  const loaded: LoadedPack | undefined = await fetchJson(`/i18n/${language}.json`)
    .then(readPack)
    .catch(() => undefined)

  const readings = loaded?.messages ?? NO_READINGS

  HELD.set(language, readings)

  return readings
}
