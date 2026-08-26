import { describe, expect, it } from 'vitest'

import { checkBoundaries, findCycles, type PackageManifest } from './boundaries.ts'

const manifest = (
  overrides: Partial<PackageManifest> & { directory: string },
): PackageManifest => ({
  name: `@assemora/${overrides.directory}`,
  dependencies: [],
  devDependencies: [],
  tsconfigReferences: [],
  sourceImports: [],
  testImports: [],
  ...overrides,
})

const rules = (manifests: PackageManifest[]): string[] =>
  checkBoundaries(manifests).map((violation) => violation.rule)

describe('allowed edges', () => {
  it('accepts a declared dependency', () => {
    expect(
      rules([
        manifest({
          directory: 'core',
          dependencies: ['@assemora/schema'],
          tsconfigReferences: ['../schema/tsconfig.build.json'],
        }),
      ]),
    ).toEqual([])
  })

  it('rejects a dependency that runs against the graph', () => {
    expect(
      rules([
        manifest({
          directory: 'schema',
          dependencies: ['@assemora/core'],
          tsconfigReferences: ['../core/tsconfig.build.json'],
        }),
      ]),
    ).toContain('allowed-dependency')
  })

  it('rejects core depending on http', () => {
    expect(
      rules([
        manifest({
          directory: 'core',
          dependencies: ['@assemora/http'],
          tsconfigReferences: ['../http/tsconfig.build.json'],
        }),
      ]),
    ).toContain('allowed-dependency')
  })
})

describe('implementation libraries', () => {
  it('allows drizzle only in the PostgreSQL adapter', () => {
    expect(
      rules([
        manifest({
          directory: 'database-postgres',
          dependencies: ['drizzle-orm'],
        }),
      ]),
    ).toEqual([])
  })

  it('rejects drizzle in data', () => {
    expect(rules([manifest({ directory: 'data', dependencies: ['drizzle-orm'] })])).toContain(
      'implementation-library',
    )
  })

  it('rejects fastify in core', () => {
    expect(rules([manifest({ directory: 'core', dependencies: ['fastify'] })])).toContain(
      'implementation-library',
    )
  })

  it('rejects react in core', () => {
    expect(rules([manifest({ directory: 'core', dependencies: ['react'] })])).toContain(
      'implementation-library',
    )
  })
})

describe('foundation packages', () => {
  it('rejects any dependency in schema', () => {
    expect(rules([manifest({ directory: 'schema', dependencies: ['zod'] })])).toContain(
      'dependency-free',
    )
  })
})

describe('TypeScript project references', () => {
  it('catches a dependency with no matching reference', () => {
    expect(rules([manifest({ directory: 'core', dependencies: ['@assemora/schema'] })])).toContain(
      'tsconfig-references',
    )
  })

  it('catches a reference with no matching dependency', () => {
    expect(
      rules([
        manifest({
          directory: 'core',
          tsconfigReferences: ['../schema/tsconfig.build.json'],
        }),
      ]),
    ).toContain('tsconfig-references')
  })
})

describe('what the sources actually import', () => {
  it('catches an import the dependency graph does not allow', () => {
    expect(rules([manifest({ directory: 'core', sourceImports: ['data'] })])).toContain(
      'source-import',
    )
  })

  it('catches an allowed import that was never declared', () => {
    expect(rules([manifest({ directory: 'core', sourceImports: ['schema'] })])).toContain(
      'undeclared-import',
    )
  })

  it('accepts an import that is both allowed and declared', () => {
    expect(
      rules([
        manifest({
          directory: 'core',
          dependencies: ['@assemora/schema'],
          tsconfigReferences: ['../schema/tsconfig.build.json'],
          sourceImports: ['schema'],
        }),
      ]),
    ).toEqual([])
  })

  it('lets tests reach for a package the sources may not, once it is declared', () => {
    expect(
      rules([
        manifest({
          directory: 'resources',
          devDependencies: ['@assemora/database'],
          testImports: ['database'],
        }),
      ]),
    ).toEqual([])
  })

  it('still refuses an undeclared test import', () => {
    expect(rules([manifest({ directory: 'resources', testImports: ['database'] })])).toContain(
      'undeclared-import',
    )
  })

  it('refuses an implementation library even in devDependencies', () => {
    expect(rules([manifest({ directory: 'data', devDependencies: ['drizzle-orm'] })])).toContain(
      'implementation-library',
    )
  })
})

describe('cycles', () => {
  it('finds no cycle in a well-formed graph', () => {
    expect(
      findCycles([
        manifest({ directory: 'schema' }),
        manifest({ directory: 'core', dependencies: ['@assemora/schema'] }),
        manifest({ directory: 'data', dependencies: ['@assemora/core'] }),
      ]),
    ).toEqual([])
  })

  it('finds a direct cycle', () => {
    const cycles = findCycles([
      manifest({ directory: 'core', dependencies: ['@assemora/data'] }),
      manifest({ directory: 'data', dependencies: ['@assemora/core'] }),
    ])

    expect(cycles).toHaveLength(1)
    expect(cycles[0]).toContain('core')
    expect(cycles[0]).toContain('data')
  })

  it('finds a cycle through an intermediate package', () => {
    const cycles = findCycles([
      manifest({ directory: 'core', dependencies: ['@assemora/data'] }),
      manifest({ directory: 'data', dependencies: ['@assemora/resources'] }),
      manifest({ directory: 'resources', dependencies: ['@assemora/core'] }),
    ])

    expect(cycles.length).toBeGreaterThan(0)
  })
})

describe('naming', () => {
  it('catches a package name that disagrees with its directory', () => {
    expect(rules([{ ...manifest({ directory: 'core' }), name: '@assemora/kernel' }])).toContain(
      'naming',
    )
  })

  it('catches a package with no declared boundaries', () => {
    expect(rules([manifest({ directory: 'unknown-package' })])).toContain('policy')
  })
})

describe('a package published under an unscoped name', () => {
  it('accepts the name the convention forces on it', () => {
    expect(rules([manifest({ directory: 'create-assemora', name: 'create-assemora' })])).toEqual([])
  })

  it('still rejects the scoped name it does not have', () => {
    expect(
      rules([manifest({ directory: 'create-assemora', name: '@assemora/create-assemora' })]),
    ).toEqual(['naming'])
  })

  it('polices an edge to it like any other, rather than mistaking it for a library', () => {
    expect(
      rules([
        manifest({
          directory: 'schema',
          dependencies: ['create-assemora'],
        }),
      ]),
    ).toEqual(['allowed-dependency', 'dependency-free', 'tsconfig-references'])
  })

  it('accepts the one edge the graph allows', () => {
    expect(
      rules([
        manifest({
          directory: 'cli',
          dependencies: ['create-assemora'],
          tsconfigReferences: ['../create-assemora/tsconfig.build.json'],
        }),
      ]),
    ).toEqual([])
  })
})

describe('the top of the graph', () => {
  it('refuses a package that depends on the umbrella, and says why', () => {
    const violations = checkBoundaries([
      manifest({
        directory: 'http',
        dependencies: ['assemora'],
        tsconfigReferences: ['../assemora/tsconfig.build.json'],
      }),
    ])

    expect(violations.map((violation) => violation.rule)).toContain('terminal-package')
    expect(
      violations.find((violation) => violation.rule === 'terminal-package')?.message,
    ).toContain('nothing may depend on it')
  })

  it('lets the umbrella depend on what it assembles', () => {
    expect(
      rules([
        manifest({
          directory: 'assemora',
          name: 'assemora',
          dependencies: ['@assemora/http', '@assemora/pages'],
          tsconfigReferences: ['../http/tsconfig.build.json', '../pages/tsconfig.build.json'],
        }),
      ]),
    ).toEqual([])
  })
})
