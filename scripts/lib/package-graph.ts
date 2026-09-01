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
  | 'change-sets'
  | 'theme'
  | 'notifications'
  | 'mcp'
  | 'sdk'
  | 'react'
  | 'plugin'
  | 'cli'
  | 'create-assemora'
  | 'queue-bullmq'
  | 'assemora'

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
  'change-sets': ['schema', 'core', 'data'],
  theme: ['schema', 'core', 'data'],
  // Outbound notifications (SPEC.md §81). It declares nouns of its own — recipients,
  // deliveries — so it sits where `pages` sits: on the resource layer, and no higher.
  // It reaches no server: a channel is a driver it is handed, the way media is handed
  // a storage driver.
  notifications: ['schema', 'core', 'data', 'resources'],
  mcp: ['schema', 'core'],
  sdk: ['schema'],
  react: ['schema'],
  plugin: ['schema', 'core'],
  cli: [
    'schema',
    'core',
    'database',
    'data',
    'database-postgres',
    'openapi',
    'sdk',
    'create-assemora',
  ],
  'create-assemora': [],
  // The queue adapter of SPEC.md §82. It implements a port core declares, the way
  // `database-postgres` implements the adapter contract `database` declares — and it
  // is the only package allowed to name BullMQ.
  'queue-bullmq': ['schema', 'core'],
  // The umbrella of SPEC.md §9. It is the only package allowed to depend on
  // everything, because it is the only one nothing depends on: it exists to put the
  // pieces together for an application, and a cycle through it is impossible.
  assemora: [
    'schema',
    'core',
    'database',
    'data',
    'database-postgres',
    'resources',
    'pages',
    'http',
    'openapi',
    'auth',
    'media',
    'revisions',
    'audit',
    'change-sets',
    'theme',
    'mcp',
    'queue-bullmq',
  ],
}

/**
 * Packages whose published name is not `@assemora/<directory>`.
 *
 * There is one, and it is forced by a convention outside this repository:
 * `pnpm create assemora my-project` resolves to the unscoped package
 * `create-assemora`, so that is the name it has to carry (SPEC.md §78).
 */
export const publishedNames: Partial<Record<PackageName, string>> = {
  'create-assemora': 'create-assemora',
  // `import { assemora } from 'assemora'` is the line SPEC.md §9 writes, and
  // `@assemora/assemora` is not that line.
  assemora: 'assemora',
}

/**
 * Packages nothing may depend on.
 *
 * The umbrella is the top of the graph. Letting anything import it would put every
 * package below it on the far side of a cycle, so the ban is machine-checked rather
 * than remembered.
 */
export const terminalPackages: readonly PackageName[] = ['assemora']

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
  bullmq: 'queue-bullmq',
  ioredis: 'queue-bullmq',
  '@node-rs/argon2': 'auth',
}

/** Packages that must carry no dependencies at all. */
// `create-assemora` runs through `pnpm create` before anything is installed, so a
// dependency of its own would have to be fetched first. It writes files and nothing
// else, which is why it can afford to have none.
export const dependencyFreePackages: readonly PackageName[] = ['schema', 'create-assemora']

export const packageNames = Object.keys(allowedDependencies) as PackageName[]
