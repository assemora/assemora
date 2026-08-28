/**
 * What a project never inherits from the template it was made from.
 *
 * This module is the *single* answer to that question. It used to be two lists — one
 * in `scaffold.ts` and one in `scripts/copy-templates.mjs` — and the bug that shipped
 * was exactly the one two lists produce: `.next` was in neither, so `--template
 * nextjs` copied 40 MB of build output into a new project, and failed outright when a
 * minified chunk turned out to contain the text of a feature marker.
 *
 * The script imports this file directly, types and all, because Node runs TypeScript.
 * That is what keeps the two callers honest: there is nothing left to disagree about.
 *
 * The rule has two halves, and the split is the point.
 *
 * **A template's own `.gitignore` says what its tooling writes.** `.next/`, `out/`,
 * `.svelte-kit/`, `.astro/` — the scaffolder cannot know those names and should not
 * try, because the list changes every time somebody adds a starter. The template
 * author already maintains that list, in a file that is right there: the starter
 * carries it as `_gitignore`, npm's spelling of a `.gitignore` that survives being
 * packed. Reading it means a new starter is excluded correctly on the day it lands,
 * with nothing to remember.
 *
 * **`NEVER_COPIED` covers what no `.gitignore` can be asked to name.** Three kinds:
 * what a checkout of a *workspace package* accumulates whether or not this particular
 * starter thought to ignore it, what running an Assemora project writes, and the
 * tests this repository keeps *about* the template. The second kind is not guesswork
 * — Assemora writes those four paths itself, so this package is entitled to know
 * them, and a project that inherited them would begin life with a migration it did
 * not generate and a snapshot that disagrees with it.
 */
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

/** What a template says about itself. Never copied, and never packed either. */
export const MANIFEST_FILE = 'template.json'

/**
 * Excluded from a scaffolded project *and* from the packed copy of a template.
 *
 * `.gitignore` syntax, matched against template-relative paths, because that is the
 * syntax the other half of the rule is already written in and a reader should not
 * have to hold two.
 */
export const NEVER_COPIED: readonly string[] = [
  // A checkout of a workspace package accumulates all of this. None of it is part of
  // what the starter is a template *of*, and a starter that forgot to ignore one of
  // them would still not want it in somebody's new project.
  'node_modules/',
  'dist/',
  '.turbo/',
  'coverage/',
  '*.tsbuildinfo',
  // Never in a `.gitignore`, because git is what would be reading it. No trailing
  // slash: a worktree or a submodule carries `.git` as a file.
  '.git',
  // Written by running an Assemora project, and owned by the project that ran it.
  // `.assemora/` is the schema snapshot `db:generate` diffs against; the migrations
  // beside it are what that diff produced. Inheriting one without the other is worse
  // than inheriting neither: the new project's first `db:generate` cannot see that
  // `0001_initial.sql` exists and writes every table a second time. `.gitignore`
  // cannot carry these, because a real project commits all four.
  '.assemora/',
  '/database/migrations/*.sql',
  '/openapi.json',
  '/src/generated/',
  // A starter's tests belong to this repository, not to the project made from it.
  // They are how CI proves the template still works — `starters/bare/app/main.tsx`
  // decides what a visitor sees before anything is published, and that is a claim
  // worth a test — and they import a test runner a scaffolded project has no
  // dependency on, so a project that inherited one would not typecheck. It is a
  // template's own `.gitignore` that carries what a *project* should not commit;
  // this is the other direction, and only this list can say it.
  '*.test.ts',
  '*.test.tsx',
  '*.test-d.ts',
  '*.test-d.tsx',
]

/**
 * The template's own ignore file, nearest spelling first.
 *
 * `_gitignore` is what a starter carries, because npm strips a real `.gitignore` out
 * of a published tarball. A template given by absolute path — `--template
 * /path/to/my-starter` — was never packed and may well carry the real thing.
 */
export const IGNORE_FILES: readonly string[] = ['_gitignore', '.gitignore']

/** Whether a path is ignored. `isDirectory` because `build/` only matches directories. */
export type Ignores = (path: string, isDirectory: boolean) => boolean

type Rule = {
  readonly negated: boolean
  readonly directoryOnly: boolean
  readonly matches: RegExp
}

const REGEXP_SPECIAL = /[.*+?^${}()|[\]\\]/g

const literal = (text: string): string => text.replace(REGEXP_SPECIAL, '\\$&')

/**
 * A `[...]` class, copied through the way fnmatch reads it.
 *
 * Returns the regex source and where the class ended, or nothing when the `[` never
 * closes — in which case it is a literal bracket, which is what git does too.
 */
const characterClass = (
  pattern: string,
  start: number,
): { readonly source: string; readonly next: number } | undefined => {
  const end = pattern.indexOf(']', start + (pattern[start + 1] === '!' ? 3 : 2))

  if (end === -1) return undefined

  const body = pattern.slice(start + 1, end)

  return { source: `[${body.startsWith('!') ? `^${body.slice(1)}` : body}]`, next: end + 1 }
}

/** A glob's body as a regular expression over one `/`-separated path. */
const expression = (pattern: string): string => {
  let source = ''
  let index = 0

  while (index < pattern.length) {
    const char = pattern[index] ?? ''

    if (char === '*' && pattern[index + 1] === '*') {
      // `**` spans directories; `**/` also matches no directory at all, so that
      // `**/build` matches `build` as well as `app/build`.
      if (pattern[index + 2] === '/') {
        source += '(?:[^/]+/)*'
        index += 3
      } else {
        source += '.*'
        index += 2
      }

      continue
    }

    if (char === '*') {
      source += '[^/]*'
      index += 1
      continue
    }

    if (char === '?') {
      source += '[^/]'
      index += 1
      continue
    }

    if (char === '[') {
      const parsed = characterClass(pattern, index)

      if (parsed !== undefined) {
        source += parsed.source
        index = parsed.next
        continue
      }
    }

    if (char === '\\') {
      source += literal(pattern[index + 1] ?? '\\')
      index += 2
      continue
    }

    source += literal(char)
    index += 1
  }

  return source
}

const rule = (line: string): Rule | undefined => {
  const trimmed = line.replace(/\s+$/, '')

  if (trimmed === '' || trimmed.startsWith('#')) return undefined

  const negated = trimmed.startsWith('!')
  const unescaped = negated ? trimmed.slice(1) : trimmed.replace(/^\\(?=[#!])/, '')
  const directoryOnly = unescaped.endsWith('/')
  const body = directoryOnly ? unescaped.slice(0, -1) : unescaped

  if (body === '') return undefined

  // git: a separator anywhere but the end anchors the pattern to the ignore file's
  // own directory. `dist/` matches at any depth; `src/generated/` matches one place.
  const anchored = body.includes('/')
  const source = expression(body.startsWith('/') ? body.slice(1) : body)

  return {
    negated,
    directoryOnly,
    matches: new RegExp(anchored ? `^${source}$` : `^(?:.*/)?${source}$`),
  }
}

/**
 * A matcher for a set of `.gitignore` patterns.
 *
 * The last matching pattern decides, so `!keep.log` after `*.log` re-includes it —
 * git's own rule, and the one a template author will expect from a file they wrote
 * for git. An excluded *directory* settles everything beneath it before any of that:
 * a `!` cannot reach inside one, which is git's rule as well, and it is what makes
 * this answer the same whether or not the caller pruned the walk.
 */
export const ignoring = (patterns: Iterable<string>): Ignores => {
  const rules = [...patterns].map(rule).filter((entry) => entry !== undefined)

  const decide = (path: string, isDirectory: boolean): boolean => {
    let ignored = false

    for (const entry of rules) {
      if (entry.directoryOnly && !isDirectory) continue
      if (entry.matches.test(path)) ignored = !entry.negated
    }

    return ignored
  }

  return (path: string, isDirectory: boolean): boolean => {
    const segments = path.split('/')

    for (let depth = 1; depth < segments.length; depth += 1) {
      if (decide(segments.slice(0, depth).join('/'), true)) return true
    }

    return decide(path, isDirectory)
  }
}

const isMissing = (error: unknown): boolean =>
  typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 'ENOENT'

/**
 * What this template says its own tooling writes.
 *
 * A template with no ignore file declares nothing, which is a legitimate thing for a
 * template to be — and the reason the built-in half exists at all.
 */
const declared = async (template: string): Promise<Ignores> => {
  for (const file of IGNORE_FILES) {
    try {
      return ignoring((await readFile(join(template, file), 'utf8')).split('\n'))
    } catch (error) {
      if (!isMissing(error)) throw error
    }
  }

  return () => false
}

/**
 * Everything a template holds that must not travel with it — the whole rule.
 *
 * Both callers ask this one question: the scaffolder, deciding what a project gets,
 * and `scripts/copy-templates.mjs`, deciding what a published tarball gets. The two
 * halves are asked separately and either one excludes, rather than being concatenated
 * into a single pattern list: `.gitignore` lets a later `!` re-include an earlier
 * match, and a template does not get to opt its own `node_modules` back in.
 *
 * Paths are template-relative and `/`-separated. A caller must skip an excluded
 * *directory* without descending into it — nothing inside one is reconsidered, which
 * is git's rule as well as the reason this never walks `node_modules`.
 */
export const templateExclusions = async (template: string): Promise<Ignores> => {
  const always = ignoring(NEVER_COPIED)
  const declaredByTemplate = await declared(template)

  return (path: string, isDirectory: boolean): boolean =>
    always(path, isDirectory) || declaredByTemplate(path, isDirectory)
}
