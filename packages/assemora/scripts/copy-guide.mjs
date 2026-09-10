/**
 * `docs/guide/` → `packages/assemora/guide/`, run by `prepack`.
 *
 * The guide is written where it is read in a checkout — beside the code it documents,
 * so a chapter and the API it describes are edited in one commit and reviewed
 * together. A published tarball cannot reach outside itself, so the one directory is
 * copied into the other at pack time, the way `create-assemora` packs the starters
 * (ADR-0021). `guide/` is machine-made and gitignored; every edit belongs in
 * `docs/guide/`.
 *
 * Why it ships at all: the guide is what the documentation site renders, and that site
 * is a different repository. Carrying it here means the pages a deployment serves are
 * the pages for the version it is running, rather than whatever is on the framework's
 * main branch — a guide that describes a newer CLI than the one installed is worse
 * than no guide. It is Markdown, so nothing imports it and no runtime pays for it.
 *
 * It is `.mjs` rather than TypeScript for the reason `copy-templates.mjs` gives: it has
 * to run from `prepack` with nothing built.
 *
 * `node scripts/copy-guide.mjs [source] [destination]` — both default to the ones a
 * checkout has, and are arguments so a test can point it somewhere harmless.
 */
import { cp, mkdir, readdir, rm } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)))

const source = resolve(process.argv[2] ?? join(packageRoot, '..', '..', 'docs', 'guide'))
const destination = resolve(process.argv[3] ?? join(packageRoot, 'guide'))

/** The Markdown, and nothing else a checkout happens to have left in there. */
export const copyGuide = async (from = source, to = destination) => {
  const entries = await readdir(from, { withFileTypes: true })
  const pages = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.md'))
    .map((entry) => entry.name)
    .sort()

  if (pages.length === 0) {
    throw new Error(`No guide to pack: ${from} holds no Markdown.`)
  }

  await rm(to, { recursive: true, force: true })
  await mkdir(to, { recursive: true })

  for (const page of pages) {
    await cp(join(from, page), join(to, page))
  }

  return pages
}

// Only when run, so a test may import the function without packing anything.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const packed = await copyGuide()

  console.log(`Packed ${packed.length} guide pages into ${destination}`)
}
