/**
 * `starters/` → `templates/`, run by `prepack` (ADR-0021).
 *
 * The starter is a workspace package so that CI proves it still compiles, and a
 * published tarball cannot reach outside itself — so the one directory is copied into
 * the other at pack time. `templates/` is machine-made and gitignored; every edit
 * belongs in `starters/`.
 *
 * It is `.mjs` rather than TypeScript on purpose: it has to run from a tarball's
 * `prepack` with nothing built, and this package has no build of its own to depend on
 * at that point.
 */
import { cp, mkdir, readdir, rm, stat } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/** Anything a checkout of a workspace package accumulates that is not part of it. */
const NEVER_COPIED = new Set(['node_modules', 'dist', '.turbo', '.assemora', 'coverage'])

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

const root = await repositoryRoot()

if (root === undefined) {
  console.error(
    'create-assemora: no pnpm-workspace.yaml above this package, so starters/ cannot be found. ' +
      'This script only runs inside a checkout of the framework.',
  )
  process.exit(1)
}

const starters = join(root, 'starters')
const templates = join(packageRoot, 'templates')

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
  if (!entry.isDirectory() || NEVER_COPIED.has(entry.name)) continue

  const source = join(starters, entry.name)

  if (!(await exists(join(source, 'package.json')))) {
    console.warn(`create-assemora: skipping starters/${entry.name} — it has no package.json.`)
    continue
  }

  await cp(source, join(templates, entry.name), {
    recursive: true,
    filter: (path) => !NEVER_COPIED.has(basename(path)) && !path.endsWith('.tsbuildinfo'),
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
