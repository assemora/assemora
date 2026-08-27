/**
 * The application (SPEC.md §9).
 *
 * Un-booted, because `src/server.ts` serves it and `assemora.config.ts` hands it to
 * the CLI, and neither should get the other's (ADR-0021).
 */
import { join } from 'node:path'

import { auth } from '@assemora/auth'
import { createMemoryAdapter, type DatabaseAdapter } from '@assemora/database'
import { postgres } from '@assemora/database-postgres'
import { pages } from '@assemora/pages'
import { studioAssets } from '@assemora/studio/assets'
import { type AssemoraApplication, assemora } from 'assemora'

import { siteBlocks } from './blocks.ts'
import { ENV_FILE } from './env.ts'
import { site } from './site.ts'

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
 * fallback is the one database its seed may create an account on.
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
    modules: [auth(), pages({ blocks: [...siteBlocks] }), site()],
    project: {
      name: 'example-company',
      version: '0.0.0',
      description: 'A marketing site assembled from blocks',
    },
    studio: { root: studioAssets() },
    mcp: true,
    /**
     * The bundle `pnpm build` writes, served at `/preview`.
     *
     * It is one bundle for two audiences: Studio's canvas frames it with
     * `?editing=1&page=<id>` and gets the draft over the authorized query, and a
     * visitor opens it plainly and gets the published tree over the public route.
     * The renderer is the same either way, which is the whole reason the canvas is an
     * iframe (SPEC.md §59).
     */
    frontend: { root: join(import.meta.dirname, '../app/dist') },
  })
