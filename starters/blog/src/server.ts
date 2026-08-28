/**
 * What `assemora dev` and `assemora start` run (SPEC.md §79).
 *
 * Boot, seed, listen — and the seed is the part worth reading twice. `assemora start`
 * is the production command and it runs *this file*, so anything unconditional here
 * happens on the first boot of a deployment. Creating an administrator is therefore
 * not something this file may do on its own: see the guard below, and `src/seed.ts`
 * for the rest of the reasoning.
 */
import { User } from '@assemora/auth'

import { createApp, databaseUrl } from './app.ts'
import { seed } from './seed.ts'

const app = createApp()

// Booting and listening are separate calls so that seeding can happen between them.
await app.boot()

/**
 * The in-memory fallback seeds itself; a real database does not.
 *
 * Nothing outside this process can reach the in-memory adapter and everything in it
 * is gone at the next restart, so an administrator there costs nothing and is the
 * difference between `pnpm dev` showing a working project and showing a login nobody
 * can pass. A real database is the opposite case in every respect, and the first
 * deploy of a project is exactly when this would fire.
 */
if (databaseUrl() === undefined) await seed(app.app)
else if ((await User.count()) === 0) {
  console.log('This database has no users yet. `pnpm seed` creates the first administrator.')
}

const address = await app.listen()

console.log(`listening on ${address}`)
console.log(`  api      ${address}/api`)
// assemora:if studio
console.log(`  studio   ${address}/studio`)
// assemora:end
// assemora:if pages
// The published tree of the page whose slug is `home`, rendered by `app/`. Other
// pages are `/preview?slug=<slug>`; Studio's canvas frames the same document with
// `?page=<id>&editing=1` and gets the draft instead (SPEC.md §59).
console.log(`  site     ${address}/preview`)
// assemora:end
