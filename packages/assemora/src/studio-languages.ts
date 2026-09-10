/**
 * Which languages Studio offers to be read in (ADR-0034).
 *
 * Three facts decide it and no single place held all three, which is why this file
 * exists: what the *bundle* ships, what the *project* wrote, and what the *deployment*
 * narrowed the offer to. The bundle knows only the first, and it was built long before
 * the other two were said — so the manifest it carries is a default, and the one served
 * is computed here and shadows it through the asset mount's `documents`.
 *
 * English is never in it. It is compiled into Studio as the source every reading falls
 * back to, so it is always on offer and is not a pack; a manifest listing it would be
 * describing a file that does not exist. It also cannot be removed, which is not a
 * limitation but the fallback being honest: a deployment that named only Ukrainian still
 * shows English for whatever the Ukrainian pack has not got.
 */
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'

import { ConfigurationError } from '@assemora/core'

import type { ResolvedStudio } from './options.js'

/** The source language, which is in the bundle and never in a pack. */
const SOURCE = 'en'

const MANIFEST = 'manifest.json'
const DIRECTORY = 'i18n'

export type OfferedLanguage = {
  readonly tag: string
  /** How the language names itself, in itself. What the switcher prints. */
  readonly name: string
}

export type StudioLanguages = {
  readonly offered: readonly OfferedLanguage[]
  /** What the mount answers from memory: the manifest, and every pack the project wrote. */
  readonly documents: Readonly<Record<string, unknown>>
}

const parse = async (path: string): Promise<unknown> => {
  const contents = await readFile(path, 'utf8').catch(() => undefined)

  if (contents === undefined) return undefined

  try {
    return JSON.parse(contents)
  } catch {
    return undefined
  }
}

const named = (value: unknown): OfferedLanguage | undefined => {
  if (typeof value !== 'object' || value === null) return undefined

  const { tag, language, name } = value as Record<string, unknown>
  // A manifest entry names itself `tag`, and a pack names itself `language`. One shape
  // reads both, because this asks the same question of the two files.
  const found = typeof tag === 'string' ? tag : language

  if (typeof found !== 'string' || found === '' || found === SOURCE) return undefined
  if (typeof name !== 'string' || name === '') return undefined

  return { tag: found, name }
}

/** What the bundle came with, as its own manifest describes it. */
const shipped = async (root: string): Promise<readonly OfferedLanguage[]> => {
  const document = await parse(join(root, DIRECTORY, MANIFEST))
  const listed = (document as { languages?: unknown } | undefined)?.languages

  if (!Array.isArray(listed)) return []

  return listed.map(named).filter((language) => language !== undefined)
}

/** What the project wrote, read from the directory it named. */
const own = async (
  directory: string,
): Promise<readonly (OfferedLanguage & { readonly pack: unknown })[]> => {
  const files = await readdir(directory).catch(() => {
    throw new ConfigurationError(
      `studio: { languagePacks } names ${directory}, which cannot be read. It is a ` +
        'directory of language packs — one JSON file per language, named for its tag.',
    )
  })

  const packs: (OfferedLanguage & { pack: unknown })[] = []

  for (const file of files.sort()) {
    if (!file.endsWith('.json') || file === MANIFEST) continue

    const pack = await parse(join(directory, file))
    const language = named(pack)

    if (language === undefined) {
      throw new ConfigurationError(
        `${join(directory, file)} is not a language pack. One holds \`language\`, \`name\` ` +
          'and `messages`, and its `language` may not be "en" — English is the source ' +
          'Studio is written in and is not a pack.',
      )
    }

    packs.push({ ...language, pack })
  }

  return packs
}

/**
 * The offer, narrowed to what the deployment asked for.
 *
 * A tag named here that nothing answers is refused rather than dropped. Dropping it
 * would mean a deployment believing it offers a language it does not, discovered by
 * whoever opened the switcher looking for it — and the two ways to get here, a typo and
 * a pack that failed to deploy, are both worth stopping for.
 */
const narrow = (
  available: readonly OfferedLanguage[],
  asked: readonly string[],
): readonly OfferedLanguage[] => {
  for (const tag of asked) {
    if (tag === SOURCE) continue
    if (available.some((language) => language.tag === tag)) continue

    const known = [SOURCE, ...available.map((language) => language.tag)].join(', ')

    throw new ConfigurationError(
      `studio: { languages } names "${tag}", which no pack answers. This deployment has ` +
        `${known}. Add a pack for it with \`studio: { languagePacks }\`, or drop it from the list.`,
    )
  }

  return available.filter((language) => asked.includes(language.tag))
}

export const studioLanguages = async (
  root: string,
  studio: ResolvedStudio,
): Promise<StudioLanguages> => {
  const packs = studio.languagePacks === undefined ? [] : await own(studio.languagePacks)
  const documents: Record<string, unknown> = {}

  // The project's own shadow the bundle's by tag, which is how a deployment corrects a
  // translation it disagrees with without waiting for a release of Studio.
  const available = [
    ...packs.map(({ tag, name }) => ({ tag, name })),
    ...(await shipped(root)).filter((language) => !packs.some((pack) => pack.tag === language.tag)),
  ].sort((a, b) => a.tag.localeCompare(b.tag))

  const offered = studio.languages === undefined ? available : narrow(available, studio.languages)

  for (const { tag, pack } of packs) {
    if (offered.some((language) => language.tag === tag)) {
      documents[`${DIRECTORY}/${tag}.json`] = pack
    }
  }

  documents[`${DIRECTORY}/${MANIFEST}`] = { languages: offered }

  return { offered, documents }
}
