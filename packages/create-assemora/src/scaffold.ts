/**
 * `scaffold()` — the whole of what this package does (SPEC.md §78, §79).
 *
 * It copies a directory and rewrites four things on the way: the project's name, the
 * version ranges, the dotfiles npm will not carry, and the parts three questions
 * turned off. Everything else is a byte-for-byte copy, deliberately — the starter is
 * a workspace package that CI typechecks (ADR-0021), and every rule this file invents
 * about generated code is a rule the starter no longer proves.
 *
 * What it leaves behind is decided in `exclusions.ts` rather than here — one list,
 * which `scripts/copy-templates.mjs` reads as well, because two of them drifted.
 *
 * `assemora new` calls this function rather than owning a second scaffolder, so the
 * two commands cannot disagree about what a project is.
 */
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join, relative, resolve, sep } from 'node:path'

import { ScaffoldError } from './error.js'
import { type Ignores, MANIFEST_FILE, templateExclusions } from './exclusions.js'
import { applyFeatures, FEATURES, type Features } from './features.js'
import { dependencyRange, packageVersion, projectPackageJson } from './package-json.js'
import {
  DEFAULT_TEMPLATE,
  type FeatureManifest,
  readManifest,
  resolveTemplate,
  type TemplateManifest,
} from './template.js'

export type ScaffoldOptions = {
  /** The project's name, and the `name` its `package.json` carries. */
  readonly name: string
  /** Where it is written. Absolute. */
  readonly directory: string
  /** The `DATABASE_URL` to write into `.env`. Nothing is written without one. */
  readonly database?: string
  /** SPEC.md §78: all three default to yes. */
  readonly studio?: boolean
  readonly pages?: boolean
  readonly mcp?: boolean
  /** A starter's name, or an absolute path to one. Defaults to `bare`. */
  readonly template?: string
  /** Write into a directory that is not empty, overwriting what collides. */
  readonly force?: boolean
}

export type ScaffoldResult = {
  readonly directory: string
  /** Project-relative, `/`-separated and sorted — a listing, not a set of paths. */
  readonly files: readonly string[]
}

/**
 * `_gitignore` becomes `.gitignore`, and only at the template root.
 *
 * npm strips a real `.gitignore` out of a published tarball, so a template that
 * carried one would scaffold a project without it — and the same is true of
 * `.npmrc`. The convention is one rule rather than a list of the two files it is
 * known to be needed for, so that a template can carry `_github/workflows/ci.yml`
 * without this file learning about it.
 *
 * It applies to the *first* segment only. Applied to every segment it silently
 * corrupted real code: `pages/_app.tsx` and `pages/_document.tsx` are Next.js's own
 * spelling, `app/_components/` is an ordinary private-folder convention, and a
 * bundler's `_00_v442._.js` is a name nobody chose at all — all three arrived in the
 * project as dotfiles, which is to say as files their imports could no longer find.
 * Every dotfile npm actually strips is a root-level one, so the root is where the
 * rewrite belongs.
 */
const undotted = (path: string): string => (path.startsWith('_') ? `.${path.slice(1)}` : path)

/** npm will not take a name longer than this. */
const NAME_LIMIT = 214

const LEGAL_NAME = /^[a-z0-9][a-z0-9._-]*$/

/** `My Project` → `my-project`: what to suggest when a name is nearly one. */
const suggested = (name: string): string =>
  name
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^[-._]+|-+$/g, '')

/**
 * Why a name cannot be one, or nothing.
 *
 * A project's name is its `package.json` name, so the rules are npm's rather than
 * this scaffolder's. They are enforced rather than worked around: silently turning
 * `My Project` into `my-project` would leave a developer with a directory and a
 * package that disagree, and the suggestion in the message costs them one keystroke
 * more than the guess would have.
 */
export const projectNameError = (name: string): string | undefined => {
  if (name === '') return 'A project needs a name: `pnpm create assemora my-project`.'

  if (name.length > NAME_LIMIT) {
    return `A package name has to be ${NAME_LIMIT} characters or fewer, and "${name}" is ${name.length}.`
  }

  if (/[A-Z]/.test(name)) {
    return `"${name}" cannot be a package name, because npm has no uppercase ones. Try "${suggested(name)}".`
  }

  if (name.startsWith('.') || name.startsWith('_')) {
    return `A package name cannot begin with "." or "_", and "${name}" does.`
  }

  if (!LEGAL_NAME.test(name)) {
    const fixed = suggested(name)

    return (
      `"${name}" is not a package name. Use lowercase letters, digits, "-", "_" and "."` +
      (fixed === '' ? '.' : `, for example "${fixed}".`)
    )
  }

  return undefined
}

/** A template-relative path, always `/`-separated whatever the platform uses. */
const posix = (path: string): string => (sep === '/' ? path : path.split(sep).join('/'))

/** Whether a path is the entry itself or something underneath it. */
const isUnder = (path: string, entry: string): boolean =>
  path === entry || path.startsWith(`${entry}/`)

const declined = (manifest: TemplateManifest, features: Features): readonly FeatureManifest[] =>
  FEATURES.filter((feature) => !features[feature]).map((feature) => manifest[feature])

/** Text is anything without a NUL in it: an image is copied, a template is rewritten. */
const isText = (contents: Buffer): boolean => !contents.includes(0)

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null

/**
 * Refuses to write into somebody's work.
 *
 * `force` is what says "I meant that directory". It overwrites what collides and
 * leaves everything else, because that is what makes it useful for re-running a
 * scaffold after changing one answer.
 */
const checkTarget = async (directory: string, force: boolean): Promise<void> => {
  let entries: readonly string[]

  try {
    entries = await readdir(directory)
  } catch (error) {
    if (isRecord(error) && error.code === 'ENOENT') return
    if (isRecord(error) && error.code === 'ENOTDIR') {
      throw new ScaffoldError(`${directory} is a file, so a project cannot be written into it.`)
    }

    throw error
  }

  if (entries.length > 0 && !force) {
    throw new ScaffoldError(
      `${directory} is not empty, and scaffolding into it would write over what is there. ` +
        'Pass --force to do that anyway, or choose another directory.',
    )
  }
}

/**
 * A `.env` holding the one answer that was given, and nothing else.
 *
 * `.env.example` is copied as it stands, so every variable the starter reads is
 * documented. It is not the basis of this file: an example's values are placeholders,
 * and a `.env` full of placeholder credentials is a file somebody eventually commits
 * believing it to be real.
 */
const envFile = (database: string): string =>
  [
    '# Written by create-assemora from the database URL you gave it.',
    '# Every other variable this project reads is documented in .env.example.',
    `DATABASE_URL=${envValue(database)}`,
    '',
  ].join('\n')

/** A value with a `#` in it ends the line unless it is quoted, and takes the password with it. */
const envValue = (value: string): string =>
  /[\s#"'`$]/.test(value) ? `"${value.replace(/([\\"])/g, '\\$1')}"` : value

type CopyPlan = {
  readonly template: string
  readonly directory: string
  readonly features: Features
  readonly excluded: readonly string[]
  readonly dropped: readonly string[]
  readonly droppedScripts: readonly string[]
  readonly range: string
  readonly name: string
}

/**
 * A text file's contents, as the project gets them.
 *
 * A `package.json` is the one file the markers stay out of, because JSON cannot carry
 * a comment — what a feature contributes to it is named in the manifest instead. Only
 * the one at the template root takes the project's name; a `package.json` further
 * down belongs to something inside the project and keeps whatever it is called.
 */
const rewritten = (plan: CopyPlan, path: string, target: string, text: string): string => {
  if (!target.endsWith('package.json')) return applyFeatures(text, plan.features, path)

  const shared = { range: plan.range, drop: plan.dropped, dropScripts: plan.droppedScripts }

  return target === 'package.json'
    ? projectPackageJson(text, path, { ...shared, name: plan.name })
    : projectPackageJson(text, path, shared)
}

/**
 * One file, from the template to the project.
 *
 * Returns the project-relative path it wrote, or nothing when the feature answers
 * excluded it. Directories are created here rather than as the walk descends, so a
 * directory whose whole contents were declined does not survive as an empty one.
 */
const copyFile = async (plan: CopyPlan, path: string): Promise<string | undefined> => {
  if (plan.excluded.some((entry) => isUnder(path, entry))) return undefined

  const target = undotted(path)
  const destination = join(plan.directory, ...target.split('/'))
  const contents = await readFile(join(plan.template, ...path.split('/')))

  await mkdir(dirname(destination), { recursive: true })

  if (!isText(contents)) {
    await writeFile(destination, contents)

    return target
  }

  await writeFile(destination, rewritten(plan, path, target, contents.toString('utf8')), 'utf8')

  return target
}

/**
 * Every file in the template, template-relative, in a stable order.
 *
 * `ignores` is asked about directories as well as files, so `node_modules/` is pruned
 * rather than descended into — the difference between reading a starter and reading
 * everything it depends on. Nothing under an excluded directory is reconsidered,
 * which is git's rule as well.
 *
 * What it is asked about is the path the *project* will have, because a template's
 * `.gitignore` was written for the project rather than for the directory it is
 * carried in.
 */
const templateFiles = async (
  template: string,
  ignores: Ignores,
  prefix = '',
): Promise<readonly string[]> => {
  const entries = await readdir(join(template, ...(prefix === '' ? [] : prefix.split('/'))), {
    withFileTypes: true,
  })
  const found: string[] = []

  for (const entry of [...entries].sort((left, right) => left.name.localeCompare(right.name))) {
    const path = prefix === '' ? entry.name : `${prefix}/${entry.name}`

    // The manifest is the template talking about itself, at its own root. One further
    // down belongs to something inside the project and is none of this file's business.
    if (path === MANIFEST_FILE) continue
    if (ignores(undotted(path), entry.isDirectory())) continue

    if (entry.isDirectory()) found.push(...(await templateFiles(template, ignores, path)))
    else found.push(path)
  }

  return found
}

/**
 * Writes a project.
 *
 * The name is trimmed before it is checked, because a name pasted into a terminal
 * often arrives with a space on the end and refusing that would be pedantry rather
 * than a rule. Everything else about it is npm's rule, unbent.
 */
export const scaffold = async (options: ScaffoldOptions): Promise<ScaffoldResult> => {
  const name = options.name.trim()
  const problem = projectNameError(name)

  if (problem !== undefined) throw new ScaffoldError(problem)

  const directory = resolve(options.directory)

  await checkTarget(directory, options.force ?? false)

  const template = await resolveTemplate(options.template ?? DEFAULT_TEMPLATE)
  const manifest = await readManifest(template)
  const features: Features = {
    studio: options.studio ?? true,
    pages: options.pages ?? true,
    mcp: options.mcp ?? true,
  }

  const off = declined(manifest, features)
  const plan: CopyPlan = {
    template,
    directory,
    features,
    name,
    excluded: off.flatMap((entry) => entry.files),
    dropped: off.flatMap((entry) => entry.dependencies),
    droppedScripts: off.flatMap((entry) => entry.scripts),
    range: dependencyRange(await packageVersion()),
  }

  const written: string[] = []

  for (const path of await templateFiles(template, await templateExclusions(template))) {
    const target = await copyFile(plan, path)
    if (target !== undefined) written.push(target)
  }

  const database = options.database?.trim() ?? ''

  if (database !== '') {
    await writeFile(join(directory, '.env'), envFile(database), 'utf8')
    written.push('.env')
  }

  return { directory, files: [...new Set(written)].sort() }
}

/** `relative()`, unless that is the longer way to say it. What `cd` wants. */
export const shortestPath = (from: string, directory: string): string => {
  const step = posix(relative(from, directory))

  return step === '' || step.startsWith('..') ? directory : step
}
