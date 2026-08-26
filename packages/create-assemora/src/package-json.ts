/**
 * The one file in a template that is rewritten rather than copied.
 *
 * Three things change and nothing else does. The project takes its own name; every
 * `workspace:*` becomes a range a package manager outside this repository can
 * actually resolve; and the dependencies of a feature that was answered "no" go, so
 * that turning the page builder off does not leave `@assemora/pages` in the install.
 *
 * `private` is deliberately left alone. A starter declares `"private": true` because
 * a generated application is not a library anybody publishes, and that is exactly as
 * true of the project as it is of the starter.
 */
import { readFile } from 'node:fs/promises'

import { ScaffoldError } from './error.js'

/** Every section a package manager reads a version range out of. */
const SECTIONS = [
  'dependencies',
  'devDependencies',
  'peerDependencies',
  'optionalDependencies',
] as const

const WORKSPACE_PROTOCOL = 'workspace:'

/**
 * What `"workspace:*"` becomes — the one line to change when this is wrong.
 *
 * The scaffolder and the framework ship from the same repository at the same version,
 * so `create-assemora@0.4.2` writes a project against `^0.4.2`: what it knows how to
 * scaffold is what it was built beside, and a caret keeps the project on that minor
 * line, which is the right width before 1.0.
 *
 * Today that version is `0.0.0` and nothing is published to npm, so a generated
 * project cannot be installed at all yet. The executable says so in as many words
 * rather than leaving somebody to read it out of a resolver error.
 */
export const dependencyRange = (version: string): string => `^${version}`

const UNKNOWN_VERSION = '0.0.0'

/**
 * This package's own version.
 *
 * Read rather than compiled in, so a published build writes the version it was
 * published as. `package.json` sits one directory above both `src/` and `dist/`, so
 * the same URL is right under a test runner and after a build.
 */
export const packageVersion = async (): Promise<string> => {
  try {
    const parsed: unknown = JSON.parse(
      await readFile(new URL('../package.json', import.meta.url), 'utf8'),
    )
    const version =
      typeof parsed === 'object' && parsed !== null
        ? (parsed as { version?: unknown }).version
        : undefined

    return typeof version === 'string' ? version : UNKNOWN_VERSION
  } catch {
    return UNKNOWN_VERSION
  }
}

/** Whether the framework this scaffolder belongs to has ever been released. */
export const isUnreleased = (version: string): boolean => version.startsWith(UNKNOWN_VERSION)

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

export type PackageJsonOptions = {
  /** The project's name. Left alone for a `package.json` below the template root. */
  readonly name?: string
  /** What every `workspace:` range becomes. */
  readonly range: string
  /** Package names to remove, because the feature that wanted them was declined. */
  readonly drop: readonly string[]
}

/**
 * A template's `package.json`, as the project's.
 *
 * Sections are rebuilt in their original key order rather than mutated, so the file
 * a developer opens has its dependencies where its author put them.
 */
export const projectPackageJson = (
  source: string,
  file: string,
  options: PackageJsonOptions,
): string => {
  let parsed: unknown

  try {
    parsed = JSON.parse(source)
  } catch {
    throw new ScaffoldError(`${file} is not JSON, so it cannot be a package.json.`)
  }

  if (!isRecord(parsed)) throw new ScaffoldError(`${file} must hold an object.`)

  const manifest: Record<string, unknown> = { ...parsed }
  const drop = new Set(options.drop)

  if (options.name !== undefined) manifest.name = options.name

  for (const section of SECTIONS) {
    const declared = manifest[section]
    if (!isRecord(declared)) continue

    // Anything that is not a workspace range is carried over exactly as written,
    // whatever it is: a git URL, a `file:` path, or something this scaffolder has
    // never seen. Rewriting only what it recognises is what keeps it out of the way.
    const kept: Record<string, unknown> = {}

    for (const [dependency, range] of Object.entries(declared)) {
      if (drop.has(dependency)) continue

      kept[dependency] =
        typeof range === 'string' && range.startsWith(WORKSPACE_PROTOCOL) ? options.range : range
    }

    manifest[section] = kept
  }

  return `${JSON.stringify(manifest, null, 2)}\n`
}
