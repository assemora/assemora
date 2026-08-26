/**
 * The application (SPEC.md §9).
 *
 * One call assembles it. REST CRUD, the OpenAPI document, the API Explorer, the SDK
 * and the Schema Registry follow from the modules listed below; policies, revisions,
 * the audit log and change sets are not options at all, because an application
 * without them silently throws its history away.
 *
 * `createApp()` hands back an application that has **not** been booted, because two
 * callers need one and neither should get the other's: `src/server.ts`, which serves
 * it, and `assemora.config.ts`, through which the `assemora` command boots it to
 * describe the real application rather than a parse of this source (ADR-0021).
 */
// assemora:if pages
import { join } from 'node:path'

// assemora:end
import { auth } from '@assemora/auth'
import { createMemoryAdapter, type DatabaseAdapter } from '@assemora/database'
import { postgres } from '@assemora/database-postgres'
// assemora:if pages
import { pages } from '@assemora/pages'
// assemora:end
import { type AssemoraApplication, assemora } from 'assemora'

import manifest from '../package.json' with { type: 'json' }
// assemora:if pages
import { Hero } from './blocks/hero.ts'
import { RichText } from './blocks/rich-text.ts'
// assemora:end
import { content } from './modules/content.ts'

/**
 * A real database when there is one, and a loud fallback when there is not.
 *
 * `pnpm create assemora demo && pnpm dev` has to show something working before
 * anybody has provisioned PostgreSQL, and a first run that dies on a connection error
 * loses people. The bargain is that it says so on every single boot: an in-memory
 * database is honest only while it is announcing itself.
 */
const database = (): DatabaseAdapter => {
  const url = process.env.DATABASE_URL

  if (url !== undefined && url !== '') return postgres({ url })

  console.warn(
    'DATABASE_URL is not set: this project is running on an in-memory database, and ' +
      'everything in it disappears when the process restarts. Put a URL in .env, then ' +
      'run `pnpm db:generate initial && pnpm db:migrate`.',
  )

  return createMemoryAdapter()
}

export const createApp = (): AssemoraApplication =>
  assemora({
    database: database(),
    modules: [
      // Users, sessions, roles, permissions and policies. Authorization denies by
      // default, so without this nobody — including you — could do anything at all.
      auth(),
      // assemora:if pages
      // A block reaches the builder by being listed here, and by nothing else.
      pages({ blocks: [Hero, RichText] }),
      // assemora:end
      content(),
    ],
    // Read from package.json so the three places that ask agree: the OpenAPI title,
    // the name the MCP server announces over the protocol, and what
    // `assemora.describe` tells an agent this project is.
    project: { name: manifest.name, version: manifest.version },
    // assemora:if studio
    // Studio, served at /studio on this same origin, so its session cookie and CSRF
    // protection are first-party. The bundle comes from `@assemora/studio`, which
    // this project depends on and the framework deliberately does not.
    studio: true,
    // assemora:end
    // assemora:if mcp
    // An agent proposes; a person applies (SPEC.md §75). `mutations: 'direct'` is the
    // deliberate opt-out, and it belongs here where it can be seen.
    mcp: true,
    // assemora:end
    // assemora:if pages
    // The bundle `pnpm build` writes. Studio's canvas frames it at /preview, so what
    // an editor sees is this site's own components rather than an imitation of them
    // (SPEC.md §59).
    frontend: { root: join(import.meta.dirname, '../app/dist') },
    // assemora:end
  })
