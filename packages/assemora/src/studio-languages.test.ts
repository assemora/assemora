/**
 * What a deployment offers Studio to be read in (ADR-0034).
 *
 * The three facts that decide it arrive from three different places and at three
 * different times — the bundle was built months ago, the project wrote its pack last
 * week, and the deployment narrowed the offer in its own source — so every case here is
 * about which of them wins where they disagree.
 */
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'

import { DEFAULT_STUDIO_PATH, type ResolvedStudio } from './options.js'
import { studioLanguages } from './studio-languages.js'

const pack = (language: string, name: string): string =>
  JSON.stringify({ language, name, messages: { 'common.save': name } })

let bundle: string
let bare: string
let project: string

beforeAll(async () => {
  const root = await mkdtemp(join(tmpdir(), 'assemora-languages-'))

  bundle = join(root, 'bundle')
  bare = join(root, 'bare')
  project = join(root, 'project')

  await mkdir(join(bundle, 'i18n'), { recursive: true })
  await writeFile(
    join(bundle, 'i18n', 'manifest.json'),
    JSON.stringify({
      languages: [
        { tag: 'uk', name: 'Українська' },
        { tag: 'ru', name: 'Русский' },
      ],
    }),
  )

  await mkdir(bare, { recursive: true })

  await mkdir(project, { recursive: true })
  await writeFile(join(project, 'de.json'), pack('de', 'Deutsch'))
  await writeFile(join(project, 'uk.json'), pack('uk', 'Українська (наша)'))
})

const studio = (given: Partial<ResolvedStudio> = {}): ResolvedStudio => ({
  root: undefined,
  path: DEFAULT_STUDIO_PATH,
  languages: undefined,
  languagePacks: undefined,
  ...given,
})

const tags = (offered: readonly { tag: string }[]): readonly string[] =>
  offered.map((language) => language.tag)

describe('the offer', () => {
  it('is what the bundle ships when the deployment says nothing', async () => {
    const { offered } = await studioLanguages(bundle, studio())

    expect(tags(offered)).toEqual(['ru', 'uk'])
  })

  it('never names English, because English is not a pack', async () => {
    // It is compiled into Studio as the source every reading falls back to, so it is
    // always on offer and there is no file to fetch. A manifest listing it would send
    // the browser after one.
    const { offered } = await studioLanguages(bundle, studio())

    expect(tags(offered)).not.toContain('en')
  })

  it('leaves English alone rather than failing where the bundle has no manifest', async () => {
    // A Studio built before packs existed, or a `studio: { root }` pointed at something
    // else. It draws — in English — instead of refusing to start.
    const { offered } = await studioLanguages(bare, studio())

    expect(offered).toEqual([])
  })

  it('adds what the project wrote beside what the bundle ships', async () => {
    const { offered } = await studioLanguages(bundle, studio({ languagePacks: project }))

    expect(tags(offered)).toEqual(['de', 'ru', 'uk'])
  })

  it("lets the project's own pack shadow a shipped one of the same tag", async () => {
    // Which is how a deployment corrects a translation it disagrees with, without
    // waiting for a release of Studio.
    const { offered } = await studioLanguages(bundle, studio({ languagePacks: project }))

    expect(offered.find((language) => language.tag === 'uk')?.name).toBe('Українська (наша)')
  })
})

describe('a deployment that narrows the offer', () => {
  it('keeps only what it asked for', async () => {
    const { offered } = await studioLanguages(bundle, studio({ languages: ['en', 'uk'] }))

    expect(tags(offered)).toEqual(['uk'])
  })

  it('offers no pack at all where it asked for English alone', async () => {
    // The switcher then has one option, which is the case the whole change exists for:
    // a bundle that shipped three languages could not be told that this deployment's
    // readers want none of the other two.
    const { offered, documents } = await studioLanguages(bundle, studio({ languages: ['en'] }))

    expect(offered).toEqual([])
    expect(documents['i18n/manifest.json']).toEqual({ languages: [] })
  })

  it('refuses a language nothing answers, and says what there is', async () => {
    // Rather than dropping it: a deployment believing it offers German and not offering
    // it is discovered by whoever opens the switcher looking for German.
    await expect(studioLanguages(bundle, studio({ languages: ['en', 'de'] }))).rejects.toThrow(
      /names "de".*en, ru, uk/s,
    )
  })

  it('accepts a language the project added, which is what makes it addable', async () => {
    const { offered } = await studioLanguages(
      bundle,
      studio({ languages: ['en', 'de'], languagePacks: project }),
    )

    expect(tags(offered)).toEqual(['de'])
  })
})

describe('what the mount answers from memory', () => {
  it('is the computed manifest, which shadows the one in the bundle', async () => {
    const { documents } = await studioLanguages(bundle, studio({ languagePacks: project }))

    expect(documents['i18n/manifest.json']).toEqual({
      languages: [
        { tag: 'de', name: 'Deutsch' },
        { tag: 'ru', name: 'Русский' },
        { tag: 'uk', name: 'Українська (наша)' },
      ],
    })
  })

  it("carries the project's packs, because nothing else serves them", async () => {
    const { documents } = await studioLanguages(bundle, studio({ languagePacks: project }))

    expect(documents['i18n/de.json']).toMatchObject({ language: 'de', name: 'Deutsch' })
    expect(documents['i18n/uk.json']).toMatchObject({ name: 'Українська (наша)' })
    // Shipped and unshadowed, so it is served from the bundle's own directory.
    expect(documents['i18n/ru.json']).toBeUndefined()
  })

  it('leaves out a pack the deployment narrowed away', async () => {
    const { documents } = await studioLanguages(
      bundle,
      studio({ languages: ['en'], languagePacks: project }),
    )

    expect(documents['i18n/de.json']).toBeUndefined()
  })
})

describe('a directory that is not a directory of packs', () => {
  it('is refused where it cannot be read at all', async () => {
    await expect(
      studioLanguages(bundle, studio({ languagePacks: join(project, 'nowhere') })),
    ).rejects.toThrow(/cannot be read/)
  })

  it('is refused where a file in it is not a pack', async () => {
    const broken = await mkdtemp(join(tmpdir(), 'assemora-broken-'))

    await writeFile(join(broken, 'pt.json'), '{ "messages": {} }')

    await expect(studioLanguages(bundle, studio({ languagePacks: broken }))).rejects.toThrow(
      /is not a language pack/,
    )
  })

  it('is refused where one of them claims to be English', async () => {
    // English is the source and is compiled in. A pack claiming the tag would be a file
    // that shadows nothing and is never fetched, which is worse than a refusal.
    const english = await mkdtemp(join(tmpdir(), 'assemora-english-'))

    await writeFile(join(english, 'en.json'), pack('en', 'English'))

    await expect(studioLanguages(bundle, studio({ languagePacks: english }))).rejects.toThrow(
      /may not be "en"/,
    )
  })
})
