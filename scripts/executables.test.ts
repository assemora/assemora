/**
 * An executable this repository declares must be linkable at *install* time.
 *
 * A package manager creates the entry in `node_modules/.bin` while it installs, and
 * `dist/` is gitignored and written by `pnpm build`, which runs afterwards. So a `bin`
 * pointing into `dist/` is a name linked to nothing on a fresh clone: pnpm prints one
 * `WARN Failed to create bin` and moves on, nothing re-links it later, and every script
 * that types `assemora` fails for the life of that checkout. That is what took CI down
 * on a repository whose sources were fine, and it took days to see because nothing
 * asserted it — `pnpm verify` builds before it tests, so by the time any other test
 * looks, `dist/bin.js` exists and the broken link is invisible.
 *
 * This test looks at the declaration rather than at the built tree, which is why it
 * still fails when everything else passes.
 */
import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { readdir, readFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

type Manifest = {
  readonly name?: string
  readonly bin?: Readonly<Record<string, string>> | string
  readonly files?: readonly string[]
}

const manifests = async (): Promise<readonly (readonly [string, Manifest])[]> => {
  const directories = await readdir(join(ROOT, 'packages'))
  const found: (readonly [string, Manifest])[] = []

  for (const directory of directories) {
    const path = join(ROOT, 'packages', directory, 'package.json')

    if (!existsSync(path)) continue

    found.push([directory, JSON.parse(await readFile(path, 'utf8')) as Manifest])
  }

  return found
}

/** `bin` is either a map of names to paths, or one path under the package's own name. */
const declared = (manifest: Manifest): readonly (readonly [string, string])[] => {
  if (manifest.bin === undefined) return []
  if (typeof manifest.bin === 'string') return [[manifest.name ?? '', manifest.bin]]

  return Object.entries(manifest.bin)
}

describe('the executables this repository declares', () => {
  it('names a file a fresh clone already has, so the link is made on install', async () => {
    // What a clone would carry, rather than what this machine happens to have.
    // `dist/bin.js` exists on any machine that has built — which is every machine this
    // test runs on — so asking the filesystem passes here and fails on the fresh clone,
    // the one case that matters. `--others --exclude-standard` includes a file that is
    // written but not yet committed, so the check is about `.gitignore` rather than
    // about whether somebody has staged it yet.
    const tracked = new Set(
      execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', 'packages'], {
        cwd: ROOT,
        encoding: 'utf8',
      }).split('\n'),
    )

    for (const [directory, manifest] of await manifests()) {
      for (const [name, target] of declared(manifest)) {
        const path = `packages/${directory}/${target.replace(/^\.\//, '')}`

        expect(
          tracked.has(path),
          `packages/${directory} declares the executable "${name}" as ${target}, which git does not track. A bin under dist/ is linked to nothing on a fresh clone, and nothing re-links it after the build.`,
        ).toBe(true)
      }
    }
  })

  it('carries that file into the published tarball', async () => {
    for (const [directory, manifest] of await manifests()) {
      for (const [name, target] of declared(manifest)) {
        const entry = target.replace(/^\.\//, '')

        expect(
          manifest.files?.includes(entry),
          `packages/${directory} declares the executable "${name}" as ${target} but does not list ${entry} in "files". "files" is an allowlist, so the published package would name a bin it does not ship.`,
        ).toBe(true)
      }
    }
  })
})
