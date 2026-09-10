/**
 * A language, as data (ADR-0034).
 *
 * A pack is a JSON file and nothing else — the two this bundle ships live in `public/`
 * and are copied beside it, and one a deployment adds is the same kind of file served
 * from the same directory. That sameness is the point rather than a convenience: a
 * first-party language with a privileged representation would mean the set was still
 * closed, with a courtesy extended to outsiders.
 *
 * So nothing here is compiled, and nothing may be assumed. `readPack` takes `unknown`
 * and answers with what it could actually read. What keeps the *shipped* packs complete
 * is `packs.test.ts`, which holds them against the English catalogue — the guarantee
 * ADR-0030 asked of its three-language records, moved from the type system to the suite
 * that runs on every commit.
 */
import type { PackMessage, Readings } from './catalogue.ts'
import { isLanguage } from './languages.ts'

/** A pack as it comes back. Complete as far as it happens to be. */
export type LoadedPack = {
  readonly language: string
  readonly name: string
  readonly messages: Readings
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/**
 * One message, or nothing where what was written is not one.
 *
 * A form set must hold `other`, because that is the one CLDR promises and the one every
 * fallback lands on. A set without it would be a message that reads correctly for some
 * counts and vanishes for others, which is worse than the English it would otherwise
 * have fallen back to.
 */
const message = (value: unknown): PackMessage | undefined => {
  if (typeof value === 'string') return value
  if (!isRecord(value)) return undefined
  if (typeof value.other !== 'string') return undefined

  const forms: Record<string, string> = {}

  for (const [category, reading] of Object.entries(value)) {
    if (typeof reading === 'string') forms[category] = reading
  }

  return forms as PackMessage
}

/**
 * A pack read out of whatever was served, or nothing where that was not a pack.
 *
 * Every unreadable message is dropped rather than the file being refused, for the same
 * reason the fallback is per key: one malformed entry in a pack somebody is still
 * writing should cost that sentence and not the language.
 */
export const readPack = (value: unknown): LoadedPack | undefined => {
  if (!isRecord(value)) return undefined

  const { language, name, messages } = value

  if (typeof language !== 'string' || !isLanguage(language)) return undefined
  if (typeof name !== 'string' || name === '') return undefined
  if (!isRecord(messages)) return undefined

  const readings: Record<string, PackMessage> = {}

  for (const [key, written] of Object.entries(messages)) {
    const read = message(written)

    if (read !== undefined) readings[key] = read
  }

  return { language, name, messages: readings }
}
