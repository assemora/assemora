/**
 * The single machine-readable source of truth for package boundaries.
 *
 * SPEC.md §8 fixes the direction of dependencies and forbids cycles. Here that is
 * expressed as explicit allowed edges: for a package to gain the right to depend on
 * another package, the edge has to be added here deliberately, together with an ADR
 * (see docs/adr/).
 */

export type PackageName =
  | 'schema'
  | 'core'
  | 'database'
  | 'data'
  | 'database-postgres'
  | 'resources'
  | 'pages'
  | 'http'
  | 'openapi'
  | 'auth'
  | 'media'
  | 'revisions'
  | 'audit'
  | 'mcp'
  | 'sdk'
  | 'react'
  | 'plugin'
  | 'cli'

/** Allowed workspace dependencies for every package. */
export const allowedDependencies: Record<PackageName, readonly PackageName[]> = {
  schema: [],
  core: ['schema'],
  database: ['schema', 'core'],
  data: ['schema', 'core', 'database'],
  'database-postgres': ['schema', 'core', 'database'],
  resources: ['schema', 'core', 'data'],
  pages: ['schema', 'core', 'data', 'resources'],
  http: ['schema', 'core'],
  openapi: ['schema', 'core', 'http'],
  auth: ['schema', 'core', 'data'],
  media: ['schema', 'core', 'data'],
  revisions: ['schema', 'core', 'data'],
  audit: ['schema', 'core', 'data'],
  mcp: ['schema', 'core', 'resources', 'pages'],
  sdk: ['schema'],
  react: ['schema'],
  plugin: ['schema', 'core'],
  cli: ['schema', 'core', 'data', 'database-postgres', 'openapi', 'sdk'],
}

/**
 * Implementation libraries and their single owning package.
 *
 * SPEC.md §8 and §125: Drizzle, Fastify and React must not leak into the other
 * packages. Ownership is verified against package.json rather than left to
 * convention.
 */
export const implementationLibraries: Record<string, PackageName> = {
  'drizzle-orm': 'database-postgres',
  'drizzle-kit': 'database-postgres',
  pg: 'database-postgres',
  postgres: 'database-postgres',
  'node-postgres': 'database-postgres',
  fastify: 'http',
  '@fastify/cors': 'http',
  '@fastify/cookie': 'http',
  '@fastify/rate-limit': 'http',
  react: 'react',
  'react-dom': 'react',
  '@types/react': 'react',
  '@types/react-dom': 'react',
  '@modelcontextprotocol/sdk': 'mcp',
  '@node-rs/argon2': 'auth',
}

/** Packages that must carry no dependencies at all. */
export const dependencyFreePackages: readonly PackageName[] = ['schema']

export const packageNames = Object.keys(allowedDependencies) as PackageName[]
