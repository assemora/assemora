/**
 * The application (SPEC.md §9).
 *
 * `createApp()` hands back an application that has **not** been booted, because two
 * callers need one and neither should get the other's: `src/server.ts`, which serves
 * it, and `assemora.config.ts`, through which the `assemora` command boots it to
 * describe the real application rather than a parse of this source (ADR-0021).
 */
import { join } from 'node:path'

import { auth } from '@assemora/auth'
import { createMemoryAdapter, type DatabaseAdapter } from '@assemora/database'
import { postgres } from '@assemora/database-postgres'
import { pages } from '@assemora/pages'
import { studioAssets } from '@assemora/studio/assets'
import { type AssemoraApplication, assemora } from 'assemora'

import { blogBlocks } from './blocks.ts'
import { blog } from './blog.ts'
import { ENV_FILE } from './env.ts'

// Node does not read `.env` on its own, and the CLI reaches this file through
// `assemora.config.ts`, so loading it here is what makes one `.env` serve the server
// and every `assemora db:*` command alike.
try {
  process.loadEnvFile(ENV_FILE)
} catch {
  // There is no .env, which is the ordinary case.
}

/**
 * Where this example's data lives, or `undefined` when nowhere yet.
 *
 * `src/server.ts` asks the same question for a different reason: the in-memory
 * fallback is the one database its seed may create accounts on.
 */
export const databaseUrl = (): string | undefined => {
  const url = process.env.DATABASE_URL

  return url === undefined || url === '' ? undefined : url
}

/** PostgreSQL when `DATABASE_URL` says where, and otherwise in memory — out loud. */
const database = (): DatabaseAdapter => {
  const url = databaseUrl()

  if (url !== undefined) return postgres({ url })

  console.warn(
    'DATABASE_URL is not set: this example is running on an in-memory database, and ' +
      'everything in it disappears when the process restarts.',
  )

  return createMemoryAdapter()
}

export const createApp = (): AssemoraApplication =>
  assemora({
    database: database(),
    modules: [auth(), pages({ blocks: [...blogBlocks] }), blog()],
    project: {
      name: 'example-blog',
      version: '0.0.0',
      description: 'Articles with authors and categories, and a policy over who edits them',
    },
    studio: { root: studioAssets() },
    mcp: true,
    frontend: { root: join(import.meta.dirname, '../app/dist') },
  })
