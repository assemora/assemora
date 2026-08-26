/**
 * Verifies the monorepo package boundaries (SPEC.md §8).
 *
 * Usage: pnpm boundaries
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { extname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { checkBoundaries, type PackageManifest } from './lib/boundaries.ts'

const root = fileURLToPath(new URL('..', import.meta.url))
const packagesDir = join(root, 'packages')

const readJson = (path: string): Record<string, unknown> => {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>
  } catch {
    return {}
  }
}

const SCOPE_IMPORT = /from\s+['"]@assemora\/([a-z-]+)['"]/g

const sourceFiles = (directory: string): string[] => {
  const found: string[] = []

  const walk = (current: string): void => {
    for (const entry of readdirSync(current)) {
      const path = join(current, entry)

      if (statSync(path).isDirectory()) walk(path)
      // `.tsx` counts: `@assemora/react` ships components, and an import in a
      // component crosses a package boundary exactly like any other.
      else if (extname(path) === '.ts' || extname(path) === '.tsx') found.push(path)
    }
  }

  const src = join(packagesDir, directory, 'src')

  try {
    walk(src)
  } catch {
    return []
  }

  return found
}

const isTestFile = (path: string): boolean => /\.test(-d)?\.ts$/.test(path)

const collectImports = (directory: string): { source: string[]; test: string[] } => {
  const source = new Set<string>()
  const test = new Set<string>()

  for (const path of sourceFiles(directory)) {
    const target = isTestFile(path) ? test : source
    const contents = readFileSync(path, 'utf8')

    for (const match of contents.matchAll(SCOPE_IMPORT)) {
      const name = match[1]
      if (name !== undefined) target.add(name)
    }
  }

  // An import that production code already makes is not also a test-only import.
  for (const name of source) test.delete(name)

  return { source: [...source].sort(), test: [...test].sort() }
}

const collectManifests = (): PackageManifest[] =>
  readdirSync(packagesDir)
    .filter((entry) => statSync(join(packagesDir, entry)).isDirectory())
    .sort()
    .map((directory) => {
      const packageJson = readJson(join(packagesDir, directory, 'package.json'))
      const buildTsconfig = readJson(join(packagesDir, directory, 'tsconfig.build.json'))

      const dependencies = {
        ...((packageJson.dependencies as Record<string, string> | undefined) ?? {}),
        ...((packageJson.peerDependencies as Record<string, string> | undefined) ?? {}),
      }

      const devDependencies =
        (packageJson.devDependencies as Record<string, string> | undefined) ?? {}

      const references = (buildTsconfig.references as { path?: string }[] | undefined) ?? []
      const imports = collectImports(directory)

      return {
        directory,
        name: typeof packageJson.name === 'string' ? packageJson.name : '',
        dependencies: Object.keys(dependencies),
        devDependencies: Object.keys(devDependencies),
        tsconfigReferences: references.map((reference) => reference.path ?? ''),
        sourceImports: imports.source,
        testImports: imports.test,
      }
    })

const manifests = collectManifests()
const violations = checkBoundaries(manifests)

if (violations.length === 0) {
  console.log(`Package boundaries are intact: ${manifests.length} packages checked.`)
  process.exit(0)
}

console.error(`Boundary violations: ${violations.length}\n`)
for (const violation of violations) {
  console.error(`  ${violation.package} [${violation.rule}]`)
  console.error(`    ${violation.message}\n`)
}
console.error(
  'Boundaries live in scripts/lib/package-graph.ts and docs/architecture/package-graph.md.',
)
console.error('Changing the dependency direction requires a new ADR (docs/adr/).')
process.exit(1)
