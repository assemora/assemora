/**
 * `starters/` → `templates/`, run by `prepack` (ADR-0021).
 *
 * The starter is a workspace package so that CI proves it still compiles, and a
 * published tarball cannot reach outside itself — so the one directory is copied into
 * the other at pack time. `templates/` is machine-made and gitignored; every edit
 * belongs in `starters/`.
 *
 * What it must not carry is decided by `src/exclusions.ts`, which is the *only* place
 * that decides it. This script used to keep a second copy of the list, and the two
 * drifted exactly as two lists do: neither had `.next` in it, so a built checkout
 * packed 40 MB of Next.js output into the tarball and scaffolded it into every
 * project made from it.
 *
 * It is `.mjs` rather than TypeScript on purpose: it has to run from a tarball's
 * `prepack` with nothing built, and this package has no build of its own to depend on
 * at that point. Node runs the `.ts` module it imports without one either.
 *
 * `node scripts/copy-templates.mjs [starters] [templates]` — the two directories
 * default to the ones a checkout has, and are arguments so that a test can point it
 * somewhere harmless.
 */
import { cp, mkdir, readdir, rm, stat } from 'node:fs/promises'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

import { templateExclusions } from '../src/exclusions.ts'

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)))

const exists = async (path) => {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

/** The directory holding `pnpm-workspace.yaml`, walking up from this package. */
const repositoryRoot = async () => {
  let current = packageRoot

  for (;;) {
    if (await exists(join(current, 'pnpm-workspace.yaml'))) return current

    const parent = dirname(current)
    if (parent === current) return undefined

    current = parent
  }
}

const [givenStarters, givenTemplates] = process.argv.slice(2)

const defaultStarters = async () => {
  const root = await repositoryRoot()

  if (root === undefined) {
    console.error(
      'create-assemora: no pnpm-workspace.yaml above this package, so starters/ cannot be found. ' +
        'This script only runs inside a checkout of the framework.',
    )
    process.exit(1)
  }

  return join(root, 'starters')
}

const starters = givenStarters === undefined ? await defaultStarters() : resolve(givenStarters)
const templates =
  givenTemplates === undefined ? join(packageRoot, 'templates') : resolve(givenTemplates)

if (!(await exists(starters))) {
  console.error(`create-assemora: ${starters} does not exist, so there is nothing to pack.`)
  process.exit(1)
}

// Removed rather than merged: a starter renamed or deleted upstream would otherwise
// stay in the tarball for ever, and nothing would say where it came from.
await rm(templates, { recursive: true, force: true })
await mkdir(templates, { recursive: true })

const entries = await readdir(starters, { withFileTypes: true })
const copied = []

for (const entry of entries) {
  if (!entry.isDirectory()) continue

  const source = join(starters, entry.name)

  if (!(await exists(join(source, 'package.json')))) {
    console.warn(`create-assemora: skipping starters/${entry.name} — it has no package.json.`)
    continue
  }

  const excluded = await templateExclusions(source)

  await cp(source, join(templates, entry.name), {
    recursive: true,
    // `cp` asks about the starter root itself as the empty path, and about a
    // directory before its contents — refusing a directory skips everything under it,
    // so `node_modules` is never walked. The manifest is not excluded here: a packed
    // template still has to be able to say what its optional parts are, and it is the
    // scaffolder that drops it.
    filter: async (path) => {
      const inside = relative(source, path)

      if (inside === '') return true

      return !excluded(
        sep === '/' ? inside : inside.split(sep).join('/'),
        (await stat(path)).isDirectory(),
      )
    },
  })

  copied.push(entry.name)
}

if (copied.length === 0) {
  // Packing this package with no template in it would publish a scaffolder that
  // cannot scaffold, and the failure would only show up on somebody else's machine.
  console.error(
    `create-assemora: no starter under ${starters} has a package.json, so templates/ would be ` +
      'empty. A starter is a workspace package (ADR-0021); this package cannot be packed until ' +
      'there is one.',
  )
  process.exit(1)
}

console.log(`create-assemora: packed ${copied.length} template(s): ${copied.join(', ')}.`)
