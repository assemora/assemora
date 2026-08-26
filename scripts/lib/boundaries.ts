import {
  allowedDependencies,
  dependencyFreePackages,
  implementationLibraries,
  type PackageName,
  publishedNames,
} from './package-graph.ts'

const SCOPE = '@assemora/'

export type PackageManifest = {
  /** Directory name inside `packages/`. */
  directory: string
  /** The `name` field from package.json. */
  name: string
  /** Runtime dependencies: `dependencies` and `peerDependencies`. */
  dependencies: readonly string[]
  /** Development-only dependencies, which tests may use but sources may not. */
  devDependencies: readonly string[]
  /** The `path` values from `references` in tsconfig.build.json. */
  tsconfigReferences: readonly string[]
  /** Workspace packages the production sources import. */
  sourceImports: readonly string[]
  /** Workspace packages only the tests import. */
  testImports: readonly string[]
}

export type Violation = {
  package: string
  rule: string
  message: string
}

/** Every published name that belongs to a workspace package, mapped to its directory. */
const directories = new Map<string, string>(
  Object.entries(publishedNames).map(([directory, published]) => [published, directory]),
)

/**
 * The directory a dependency refers to, if it is one of ours.
 *
 * Almost every workspace package is `@assemora/<directory>`; `create-assemora` is
 * the exception, and it is still an internal edge that the graph has to police.
 */
/** How a package is written in a package.json — the inverse of `internalName`. */
const published = (directory: string): string =>
  publishedNames[directory as PackageName] ?? `${SCOPE}${directory}`

const internalName = (dependency: string): string | undefined =>
  dependency.startsWith(SCOPE) ? dependency.slice(SCOPE.length) : directories.get(dependency)

const isKnownPackage = (name: string): name is PackageName => name in allowedDependencies

const referencedPackage = (path: string): string => {
  const match = /^\.\.\/([^/]+)\/tsconfig\.build\.json$/.exec(path)
  return match?.[1] ?? path
}

const sorted = (values: Iterable<string>): string[] => [...values].sort()

/** Directory, package name and declared policy must agree. */
const checkNaming = (manifest: PackageManifest): Violation[] => {
  const violations: Violation[] = []
  const expected =
    publishedNames[manifest.directory as PackageName] ?? `${SCOPE}${manifest.directory}`

  if (manifest.name !== expected) {
    violations.push({
      package: manifest.directory,
      rule: 'naming',
      message: `package name "${manifest.name}" does not match its directory, expected "${expected}"`,
    })
  }

  if (!isKnownPackage(manifest.directory)) {
    violations.push({
      package: manifest.directory,
      rule: 'policy',
      message:
        'package is missing from scripts/lib/package-graph.ts — declare its boundaries explicitly and record the decision in an ADR',
    })
  }

  return violations
}

/** Workspace dependencies must be listed among the allowed edges. */
const checkInternalDependencies = (manifest: PackageManifest): Violation[] => {
  if (!isKnownPackage(manifest.directory)) return []

  const allowed = allowedDependencies[manifest.directory]

  return manifest.dependencies
    .map(internalName)
    .filter((dependency): dependency is string => dependency !== undefined)
    .filter((dependency) => !allowed.includes(dependency as PackageName))
    .map((dependency) => ({
      package: manifest.directory,
      rule: 'allowed-dependency',
      message: `dependency "${published(dependency)}" is not allowed; permitted: ${
        allowed.length > 0 ? allowed.map(published).join(', ') : 'none'
      }`,
    }))
}

/** An implementation library may only be declared by the package that owns it. */
const allDependencies = (manifest: PackageManifest): readonly string[] => [
  ...manifest.dependencies,
  ...manifest.devDependencies,
]

/**
 * An implementation library is checked in every section: putting Drizzle in
 * `devDependencies` would be just as much of a leak.
 */
const checkImplementationLibraries = (manifest: PackageManifest): Violation[] =>
  allDependencies(manifest)
    .filter((dependency) => dependency in implementationLibraries)
    .filter((dependency) => implementationLibraries[dependency] !== manifest.directory)
    .map((dependency) => ({
      package: manifest.directory,
      rule: 'implementation-library',
      message: `"${dependency}" may only be declared by @assemora/${implementationLibraries[dependency]}; this library never leaks outwards (SPEC.md §8, §125)`,
    }))

/** Foundation packages must stay dependency-free. */
const checkDependencyFree = (manifest: PackageManifest): Violation[] => {
  if (!dependencyFreePackages.includes(manifest.directory as PackageName)) return []

  return allDependencies(manifest).map((dependency) => ({
    package: manifest.directory,
    rule: 'dependency-free',
    message: `package must stay dependency-free, found "${dependency}"`,
  }))
}

/** TypeScript project references must mirror the workspace dependencies exactly. */
const checkTsconfigReferences = (manifest: PackageManifest): Violation[] => {
  const declared = sorted(
    manifest.dependencies
      .map(internalName)
      .filter((dependency): dependency is string => dependency !== undefined),
  )
  const referenced = sorted(manifest.tsconfigReferences.map(referencedPackage))

  if (declared.join('|') === referenced.join('|')) return []

  return [
    {
      package: manifest.directory,
      rule: 'tsconfig-references',
      message: `references in tsconfig.build.json (${
        referenced.join(', ') || 'empty'
      }) disagree with package.json dependencies (${declared.join(', ') || 'empty'})`,
    },
  ]
}

/**
 * What the sources actually import has to match what the package declares.
 *
 * package.json alone is not enough: a workspace hoists packages into a shared
 * `node_modules`, so an undeclared import resolves at runtime and would otherwise
 * pass every other rule here unnoticed.
 */
const checkImports = (manifest: PackageManifest): Violation[] => {
  if (!isKnownPackage(manifest.directory)) return []

  const allowed = allowedDependencies[manifest.directory]
  const declared = new Set(
    allDependencies(manifest)
      .map(internalName)
      .filter((dependency): dependency is string => dependency !== undefined),
  )

  const violations: Violation[] = []

  for (const imported of manifest.sourceImports) {
    if (!allowed.includes(imported as PackageName)) {
      violations.push({
        package: manifest.directory,
        rule: 'source-import',
        message: `sources import "${published(imported)}", which the dependency graph does not allow`,
      })
    } else if (!declared.has(imported)) {
      violations.push({
        package: manifest.directory,
        rule: 'undeclared-import',
        message: `sources import "${published(imported)}" without declaring it in package.json`,
      })
    }
  }

  // Tests may reach for a package the production code must not use — an in-memory
  // adapter, for instance — but only if the package says so out loud.
  for (const imported of manifest.testImports) {
    if (!declared.has(imported)) {
      violations.push({
        package: manifest.directory,
        rule: 'undeclared-import',
        message: `tests import "${published(imported)}" without declaring it in package.json`,
      })
    }
  }

  return violations
}

/** Cycles between packages are forbidden (SPEC.md §8). */
export const findCycles = (manifests: readonly PackageManifest[]): string[][] => {
  const graph = new Map<string, string[]>()

  for (const manifest of manifests) {
    graph.set(
      manifest.directory,
      manifest.dependencies
        .map(internalName)
        .filter((dependency): dependency is string => dependency !== undefined),
    )
  }

  const cycles: string[][] = []
  const visiting = new Set<string>()
  const visited = new Set<string>()

  const walk = (node: string, path: string[]): void => {
    if (visiting.has(node)) {
      cycles.push([...path.slice(path.indexOf(node)), node])
      return
    }
    if (visited.has(node)) return

    visiting.add(node)
    for (const next of graph.get(node) ?? []) {
      walk(next, [...path, node])
    }
    visiting.delete(node)
    visited.add(node)
  }

  for (const name of sorted(graph.keys())) {
    walk(name, [])
  }

  return cycles
}

/** Full boundary check. An empty array means the architecture is intact. */
export const checkBoundaries = (manifests: readonly PackageManifest[]): Violation[] => {
  const violations = manifests.flatMap((manifest) => [
    ...checkNaming(manifest),
    ...checkInternalDependencies(manifest),
    ...checkImplementationLibraries(manifest),
    ...checkDependencyFree(manifest),
    ...checkTsconfigReferences(manifest),
    ...checkImports(manifest),
  ])

  const cycles = findCycles(manifests).map((cycle) => ({
    package: cycle[0] ?? 'unknown',
    rule: 'no-cycles',
    message: `dependency cycle: ${cycle.join(' → ')}`,
  }))

  return [...violations, ...cycles]
}
