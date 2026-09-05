/**
 * One version for every package, then npm.
 *
 *   pnpm release 0.1.0
 *
 * The packages ship in lockstep: `assemora@0.1.0` depends on `@assemora/core@0.1.0`,
 * and `create-assemora@0.1.0` writes a project against `^0.1.0`, because what it knows
 * how to scaffold is what it was built beside (`packages/create-assemora/src/package-json.ts`).
 * One number, so a project that says which framework it is on says it once.
 *
 * In order: refuse a dirty tree, write the version into every publishable package,
 * build, commit, publish, tag. The commit comes before the publish because `pnpm
 * publish` checks that the tree is clean and the branch is `main` — the published
 * tarball is then exactly the commit the tag points at. `pnpm -r publish` rewrites every
 * `workspace:*` to the version it is publishing and skips a package marked private, so
 * the playground, the examples and the starters never leave this repository.
 *
 * Deliberately no changelog machinery. There is one author and one line of history;
 * the tag and `git log` between two tags are the changelog until that stops being true.
 */
import { execFileSync } from 'node:child_process'
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/

const version = process.argv[2]

if (version === undefined || !VERSION.test(version)) {
  console.error('usage: pnpm release <version>   e.g. pnpm release 0.1.0')
  process.exit(2)
}

const run = (command: string, args: readonly string[]): string =>
  execFileSync(command, [...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] })

if (run('git', ['status', '--porcelain']).trim() !== '') {
  console.error('The working tree is not clean. Commit or stash first; a release is a commit.')
  process.exit(1)
}

/** Every workspace package that is not private: `packages/*` and the apps that publish. */
const manifests = (): string[] =>
  ['packages', 'apps'].flatMap((root) =>
    readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => join(root, entry.name, 'package.json'))
      .filter((file) => {
        try {
          return JSON.parse(readFileSync(file, 'utf8')).private !== true
        } catch {
          return false
        }
      }),
  )

const bumped: string[] = []

for (const file of manifests()) {
  const manifest = JSON.parse(readFileSync(file, 'utf8')) as { name: string; version: string }

  manifest.version = version
  writeFileSync(file, `${JSON.stringify(manifest, null, 2)}\n`)
  bumped.push(manifest.name)
}

console.log(`${bumped.length} packages at ${version}: ${bumped.join(', ')}`)

run('pnpm', ['build'])
run('git', ['add', ...manifests()])
run('git', ['commit', '-q', '-m', `release: v${version}`])
run('pnpm', ['-r', 'publish', '--access', 'public'])
run('git', ['tag', `v${version}`])

console.log(`\nPublished v${version}. Now: git push --follow-tags`)
