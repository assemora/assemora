/**
 * The languages this bundle ships (ADR-0034).
 *
 * A pack is a JSON file, so no compiler reads it — which is exactly why this file
 * exists. What `Readonly<Record<Language, string>>` used to refuse at build time is
 * refused here instead, and against the same standard: a shipped language that is
 * missing a key, has invented a hole, or has lost a plural form is a mistake that reads
 * as ordinary text on a screen nobody has opened in that language yet.
 *
 * A pack a *deployment* adds is held to none of this, and cannot be — nothing here has
 * seen it. It degrades per key to English instead, which `messages.test.ts` covers.
 */
import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import type { PackMessage } from './catalogue.ts'
import { MESSAGES } from './messages.ts'
import { readPack } from './pack.ts'

const DIRECTORY = fileURLToPath(new URL('../../public/i18n', import.meta.url))

const read = (file: string): unknown => JSON.parse(readFileSync(`${DIRECTORY}/${file}`, 'utf8'))

const files = readdirSync(DIRECTORY)
  .filter((file) => file.endsWith('.json') && file !== 'manifest.json')
  .sort()

/** Every `{name}` in one reading. */
const holesOf = (text: string): readonly string[] =>
  [...text.matchAll(/\{(\w+)\}/g)].map((match) => match[1] ?? '')

/** Every reading of one message: each form of a plural, or the one phrase. */
const readingsOf = (message: PackMessage): readonly string[] =>
  typeof message === 'string' ? [message] : Object.values(message)

/** Every reading of a message's English source. */
const englishOf = (key: string): readonly string[] => {
  const english = (
    MESSAGES[key as keyof typeof MESSAGES] as { en: string | Record<string, string> }
  ).en

  return typeof english === 'string' ? [english] : Object.values(english)
}

const KEYS = Object.keys(MESSAGES).sort()

describe('a pack this bundle ships', () => {
  it('is a pack at all', () => {
    // There is one, so the rest of this file is testing something. A directory that
    // quietly emptied would otherwise make every case below pass by having nothing to
    // check — the failure mode of a suite that iterates over what it finds.
    expect(files.length).toBeGreaterThan(0)
  })

  it.each(files)('%s reads as a pack', (file) => {
    expect(readPack(read(file))).toBeDefined()
  })

  it.each(files)('%s names itself the way its file is named', (file) => {
    const pack = readPack(read(file))

    expect(pack?.language).toBe(file.replace(/\.json$/, ''))
    // In itself, never in English: the switcher prints this, and a person looking for
    // their own language is looking for the word they call it by.
    expect(pack?.name).not.toBe('')
  })

  it.each(files)('%s says everything the catalogue says', (file) => {
    const pack = readPack(read(file))
    const written = Object.keys(pack?.messages ?? {}).sort()

    expect(written).toEqual(KEYS)
  })

  it.each(files)('%s invents no hole the English does not have', (file) => {
    // The other direction is allowed and used: `entries.blank.title` says the resource's
    // name in English and leaves it to the heading in Ukrainian, because a foreign noun
    // cannot be declined into a Slavic sentence. An *extra* hole is always a typo, and
    // it renders as `{naem}` on the screen.
    const pack = readPack(read(file))

    for (const [key, message] of Object.entries(pack?.messages ?? {})) {
      const english = new Set(englishOf(key).flatMap(holesOf))

      for (const reading of readingsOf(message)) {
        for (const hole of holesOf(reading)) {
          expect(english, `${key} in ${file} names {${hole}}`).toContain(hole)
        }
      }
    }
  })

  it.each(files)('%s counts in every form its own language has', (file) => {
    const pack = readPack(read(file))
    const language = pack?.language ?? ''
    // What CLDR says this language needs, asked of the same library that will choose
    // between them at run time. A Ukrainian pack missing `few` reads correctly for 1
    // and 5 and wrongly for 3, which is the kind of gap a reader reports as "sometimes".
    const needed = new Intl.PluralRules(language).resolvedOptions().pluralCategories

    for (const [key, message] of Object.entries(pack?.messages ?? {})) {
      const counted = typeof englishOf(key)[0] === 'string' && englishOf(key).length > 1

      if (!counted) continue

      expect(typeof message, `${key} in ${file}`).toBe('object')
      expect(Object.keys(message).sort(), `${key} in ${file}`).toEqual([...needed].sort())

      for (const form of readingsOf(message)) {
        expect(form, `${key} in ${file}`).toContain('{count}')
      }
    }
  })
})

describe('the manifest beside the packs', () => {
  /**
   * It is a default rather than the answer: the umbrella writes its own from what the
   * deployment offers (ADR-0034). This one is what `pnpm dev` reads and what a bundle
   * served as plain files falls back to, so it has to name what is actually there.
   */
  it('names every pack in the directory and nothing else', () => {
    const listed = (read('manifest.json') as { languages: readonly { tag: string }[] }).languages

    expect(listed.map((language) => language.tag).sort()).toEqual(
      files.map((file) => file.replace(/\.json$/, '')),
    )
  })

  it('calls each language what the pack calls itself', () => {
    const listed = (
      read('manifest.json') as {
        languages: readonly { tag: string; name: string }[]
      }
    ).languages

    for (const language of listed) {
      expect(language.name).toBe(readPack(read(`${language.tag}.json`))?.name)
    }
  })

  it('leaves English out, because English is not a pack', () => {
    const listed = (read('manifest.json') as { languages: readonly { tag: string }[] }).languages

    expect(listed.some((language) => language.tag === 'en')).toBe(false)
  })
})

describe('a pack that is not one', () => {
  it('is refused rather than half-read', () => {
    expect(readPack(undefined)).toBeUndefined()
    expect(readPack('uk')).toBeUndefined()
    expect(readPack({ language: 'uk', name: 'Українська' })).toBeUndefined()
    expect(readPack({ language: 'not a tag', name: 'x', messages: {} })).toBeUndefined()
    expect(readPack({ language: 'uk', name: '', messages: {} })).toBeUndefined()
  })

  it('loses the message it could not read rather than the language', () => {
    // One malformed entry in a pack somebody is still writing should cost that
    // sentence, and the sentence then falls back to English.
    const pack = readPack({
      language: 'uk',
      name: 'Українська',
      messages: {
        'common.save': 'Зберегти',
        'common.cancel': 42,
        // No `other`, so there is a count it could not answer at all.
        'collection.entryCount': { one: '{count} запис' },
      },
    })

    expect(pack?.messages).toEqual({ 'common.save': 'Зберегти' })
  })
})
