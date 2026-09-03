/**
 * A running Assemora application (SPEC.md §9, ADR-0022).
 *
 * One call assembles it. CRUD, the OpenAPI document, the API Explorer, the session
 * endpoints, the media URLs, the MCP endpoint, policies, revisions, the audit log and
 * change sets all follow from the modules listed below and from the wiring `assemora`
 * owns — none of it is written here, and a project that had to write it would be
 * carrying a copy the framework could never correct.
 *
 * What is left is the part only this application can know: where its uploads live,
 * where its frontend bundle was built, and which other origin is allowed to reach it.
 */
import { join } from 'node:path'

import { auth } from '@assemora/auth'
import { createMemoryAdapter } from '@assemora/database'
import { media } from '@assemora/media'
import { pages } from '@assemora/pages'
import { collections } from '@assemora/resources'
import { assemora } from 'assemora'

import { blog, Faq, Hero, Section } from './blog.ts'
import { ADMIN_EMAIL, ADMIN_PASSWORD, seed } from './seed.ts'

const PORT = Number(process.env.PORT ?? 4000)

/**
 * Where Studio is being developed, which is the whole reason this application exists.
 *
 * A deployed project serves Studio beside its own API on one origin and names no
 * origins at all. This is the split-origin case the options exist for, and it needs to
 * say two separate things: :5173 may *call* this API, and the Studio served from there
 * may *frame* the preview. An origin trusted to fetch JSON has not thereby been
 * trusted to put a logged-in interface inside an iframe of its own (SPEC.md §59, §85).
 */
const STUDIO_ORIGIN = process.env.STUDIO_ORIGIN ?? 'http://localhost:5173'

const app = assemora({
  // In memory on purpose: this application is started, looked at, and thrown away.
  // PostgreSQL is exercised by `pnpm test:integration`, against a real database.
  database: createMemoryAdapter(),
  // `revisions`, `audit` and `changesets` are deliberately absent: they are not
  // features to opt into, and the umbrella registers them for every application.
  // `collections()` is what makes SPEC.md §37 true: a person or an agent creates a
  // collection here, in Studio, and it becomes a resource like any other — without a
  // TypeScript file and without a deploy.
  modules: [auth(), blog(), pages({ blocks: [Hero, Section, Faq] }), media(), collections()],
  // Written once because three subsystems ask: the OpenAPI title, the name the MCP
  // server announces over the protocol, and what `assemora.describe` tells an agent
  // this project is (SPEC.md §44, §71).
  project: {
    name: 'Assemora playground',
    version: '0.0.0',
    description: 'A blog, built the way the framework intends',
  },
  // An agent proposes and a person applies (SPEC.md §75). Switching this on is also
  // what registers the module whose tools are generated from the registry.
  mcp: true,
  media: { root: join(import.meta.dirname, '../storage') },
  // What Studio's builder canvas frames: this application's own bundle, with its own
  // block views, so an editor sees the real renderer rather than a second one.
  frontend: { root: join(import.meta.dirname, '../web/dist'), framedBy: [STUDIO_ORIGIN] },
  origins: [STUDIO_ORIGIN],
})

// Two calls rather than one, so the seed runs against a booted application before the
// first request can arrive at a half-filled one.
await app.boot()
await seed(app.app)

const address = await app.listen(PORT)

/**
 * Where to go, and how to get in.
 *
 * A demo that ends at a login nobody can pass is the dead end this output exists to
 * close, and the password is printed here for one reason that does not generalise: it
 * is a constant published in the file next to this one, guarding an in-memory database
 * that exists inside this process and is gone when it stops. That is a fixture, not a
 * credential.
 *
 * A scaffolded project does the opposite and must. `starters/bare/src/seed.ts`
 * generates a password, writes it to `.env` and prints only where it went, because
 * `assemora start` inherits the streams of whatever supervises it — and
 * `tests/integration/starters.test.ts` fails if a starter or an example ever prints
 * one (docs/rules/security.md).
 */
console.log(`[playground] api       ${address}/api`)
console.log(`[playground] articles  ${address}/api/articles   (open — no session needed)`)
console.log(`[playground] studio    ${STUDIO_ORIGIN}   (pnpm --filter @assemora/studio dev)`)
console.log(`[playground] sign in   ${ADMIN_EMAIL} / ${ADMIN_PASSWORD}`)
