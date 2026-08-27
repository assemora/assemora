/**
 * Boot, seed, listen (SPEC.md §79).
 *
 * `assemora start` runs this file, so anything unconditional here happens on the
 * first boot of a deployment. Creating an administrator is therefore guarded: see
 * below, and `src/seed.ts` for the rest of the reasoning.
 */
import { User } from '@assemora/auth'

import { createApp, databaseUrl } from './app.ts'
import { seed } from './seed.ts'

const app = createApp()

await app.boot()

// The in-memory fallback is throwaway and unreachable from outside this process, so
// it seeds itself; a real database is seeded by `pnpm seed`, deliberately, once.
if (databaseUrl() === undefined) await seed(app.app)
else if ((await User.count()) === 0) {
  console.log('This database has no users yet. `pnpm seed` creates the administrator.')
}

const address = await app.listen()

console.log(`listening on ${address}`)
console.log(`  studio   ${address}/studio`)
// Genuinely the site: `/preview` reads the published tree of `home` through the
// public route in `src/routes.ts`, with no session. `?slug=` picks another page.
console.log(`  site     ${address}/preview`)
console.log(`  public   ${address}/api/site/pages/home`)
