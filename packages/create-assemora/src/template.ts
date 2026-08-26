/**
 * Where a template comes from, and what it declares about itself (ADR-0021).
 *
 * `starters/<name>` in the repository is the single source, and it is a real
 * workspace package so that CI proves it still compiles. A published tarball cannot
 * reach outside itself, so `prepack` copies `starters/` into `templates/` and the
 * resolver looks there first — the packed copy is what a published install has, and
 * the workspace copy is what a checkout has.
 *
 * Both places are searched by walking up from this module, which is what makes the
 * package work from `src/` under a test runner and from `dist/` after a build without
 * either of them knowing where it is.
 */
import { readdir, readFile, stat } from 'node:fs/promises'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { ScaffoldError } from './error.js'
import { FEATURES, type Feature, isFeature } from './features.js'

/** What `pnpm create assemora my-project` copies when nobody says otherwise. */
export const DEFAULT_TEMPLATE = 'bare'

/** Inside a published tarball. */
const PACKED = 'templates'

/** Inside the repository. */
const WORKSPACE = 'starters'

/** What a template says about itself, and the one file that is never copied. */
export const MANIFEST_FILE = 'template.json'

export type FeatureManifest = {
  /**
   * Template-relative paths that only exist for this feature.
   *
   * A directory counts: naming `app/blocks/hero` removes everything under it.
   * Paths are written as they appear in the template, so a dotfile is named by the
   * `_` spelling the template carries it under.
   */
  readonly files: readonly string[]
  /** Package names removed from every `package.json` when the answer is no. */
  readonly dependencies: readonly string[]
  /**
   * Script names removed from `package.json` when the answer is no.
   *
   * A script is not a file and not a dependency, and it is the third thing a feature
   * can own: a project with no page builder has no bundle, so its `build` script has
   * nothing to run. A marker comment cannot say so, because JSON carries no comments.
   */
  readonly scripts: readonly string[]
}

export type TemplateManifest = Readonly<Record<Feature, FeatureManifest>>

const EMPTY: FeatureManifest = { files: [], dependencies: [], scripts: [] }

export type ResolveTemplateOptions = {
  /**
   * Where the walk upwards starts. Defaults to the directory holding this module,
   * which is the only thing this package knows about its own location.
   */
  readonly from?: string
}

const isDirectory = async (path: string): Promise<boolean> => {
  try {
    return (await stat(path)).isDirectory()
  } catch {
    return false
  }
}

const isFile = async (path: string): Promise<boolean> => {
  try {
    return (await stat(path)).isFile()
  } catch {
    return false
  }
}

/** A directory and every directory above it, nearest first. */
const ancestors = (from: string): readonly string[] => {
  const found: string[] = []
  let current = resolve(from)

  for (;;) {
    found.push(current)

    const parent = dirname(current)
    if (parent === current) return found

    current = parent
  }
}

/**
 * A directory is only a template if it is a package.
 *
 * A starter is a workspace package so that CI proves it compiles (ADR-0021), which
 * means the one thing every template has is a `package.json`. Checking for it turns
 * the failure that would otherwise happen — a project scaffolded out of an empty
 * placeholder directory, reported as a success — into a sentence naming the
 * directory.
 */
const asTemplate = async (directory: string): Promise<string> => {
  if (await isDirectory(directory)) {
    if (await isFile(join(directory, 'package.json'))) return directory

    throw new ScaffoldError(
      `${directory} is not a template: it has no package.json. A starter is a workspace ` +
        'package, so that CI proves it still compiles.',
    )
  }

  throw new ScaffoldError(`There is no template directory at ${directory}.`)
}

/**
 * The directory a template's files live in.
 *
 * An absolute `name` is taken as a template directory rather than a name, so that
 * `--template /path/to/my-starter` scaffolds from a starter this package has never
 * heard of. A name is looked up in the packed copy first and the workspace second,
 * because after a `prepack` both exist and the packed one is the copy a published
 * install would be reading.
 */
export const resolveTemplate = async (
  name: string,
  options: ResolveTemplateOptions = {},
): Promise<string> => {
  if (isAbsolute(name)) return asTemplate(name)

  const from = options.from ?? dirname(fileURLToPath(import.meta.url))
  const roots = ancestors(from)

  // Candidates whose containing directory exists at all. They are what the failure
  // names: "there is a templates/ here and your template is not in it" is a sentence
  // somebody can act on, and a list of eight paths that never existed is not.
  const reachable: string[] = []

  for (const place of [PACKED, WORKSPACE]) {
    for (const root of roots) {
      const candidate = join(root, place, name)

      if (await isDirectory(candidate)) return asTemplate(candidate)
      if (await isDirectory(join(root, place))) reachable.push(candidate)
    }
  }

  const looked =
    reachable.length > 0
      ? reachable
      : [join(roots[0] ?? from, PACKED, name), join(roots[0] ?? from, WORKSPACE, name)]

  throw new ScaffoldError(
    `There is no template called "${name}". Looked for it in:\n` +
      looked.map((path) => `  ${path}`).join('\n') +
      `\nand in every "${PACKED}" and "${WORKSPACE}" directory above them. A template is a ` +
      `directory under "${WORKSPACE}" in the framework repository; a published install carries ` +
      `the same directories under "${PACKED}".`,
  )
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const stringList = (value: unknown, file: string, field: string): readonly string[] => {
  if (value === undefined) return []
  if (!Array.isArray(value) || !value.every((entry) => typeof entry === 'string')) {
    throw new ScaffoldError(`${file}: "${field}" must be a list of strings.`)
  }

  return value
}

/**
 * What the template declares is optional, defaulted to "nothing is".
 *
 * A template with no `template.json` is a template with no optional parts, which is a
 * legitimate thing to be — the failure worth having is the opposite one, a manifest
 * naming a feature this scaffolder does not ask about, because that template expects
 * a question nobody is answering.
 */
export const readManifest = async (directory: string): Promise<TemplateManifest> => {
  const file = join(directory, MANIFEST_FILE)
  let text: string

  try {
    text = await readFile(file, 'utf8')
  } catch {
    return { studio: EMPTY, pages: EMPTY, mcp: EMPTY }
  }

  let parsed: unknown

  try {
    parsed = JSON.parse(text)
  } catch {
    throw new ScaffoldError(`${file} is not JSON.`)
  }

  if (!isRecord(parsed)) throw new ScaffoldError(`${file} must hold an object.`)

  const declared = parsed.features

  if (declared !== undefined && !isRecord(declared)) {
    throw new ScaffoldError(`${file}: "features" must be an object.`)
  }

  const features = declared ?? {}
  const unknown = Object.keys(features).filter((name) => !isFeature(name))

  if (unknown.length > 0) {
    throw new ScaffoldError(
      `${file}: "features.${unknown[0] ?? ''}" is not one of the questions a project is ` +
        `scaffolded with (${FEATURES.join(', ')}).`,
    )
  }

  const read = (feature: Feature): FeatureManifest => {
    const entry = features[feature]

    if (entry === undefined) return EMPTY
    if (!isRecord(entry))
      throw new ScaffoldError(`${file}: "features.${feature}" must be an object.`)

    return {
      files: stringList(entry.files, file, `features.${feature}.files`),
      dependencies: stringList(entry.dependencies, file, `features.${feature}.dependencies`),
      scripts: stringList(entry.scripts, file, `features.${feature}.scripts`),
    }
  }

  return { studio: read('studio'), pages: read('pages'), mcp: read('mcp') }
}

/** Whether a directory holds anything at all. A missing one holds nothing. */
export const isEmptyDirectory = async (path: string): Promise<boolean> => {
  try {
    return (await readdir(path)).length === 0
  } catch (error) {
    if (isRecord(error) && error.code === 'ENOENT') return true

    throw error
  }
}
