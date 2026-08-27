/**
 * Boot, seed, listen (SPEC.md §79).
 *
 * `assemora start` runs this file, so anything unconditional here happens on the
 * first boot of a deployment. Creating accounts is therefore guarded: see below, and
 * `src/seed.ts` for the rest of the reasoning.
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
  console.log('This database has no users yet. `pnpm seed` creates the two accounts.')
}

const address = await app.listen()

console.log(`listening on ${address}`)
console.log(`  studio   ${address}/studio`)
// `/preview` renders a page through the *authorized* query, so it is the builder's
// preview rather than the site: signed out it says so instead of drawing anything.
// The public surface of this blog is the two routes in `src/routes.ts`.
console.log(`  preview  ${address}/preview   (sign in to Studio first)`)
console.log(`  public   ${address}/api/blog/articles`)
