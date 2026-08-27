/**
 * What `assemora dev` and `assemora start` run (SPEC.md §79).
 *
 * Boot, seed, listen — and the seed is the part worth reading twice. `assemora start`
 * is the production command and it runs *this file*, so anything unconditional here
 * happens on the first boot of a deployment. Creating an administrator is therefore
 * not something this file may do on its own: see the guard below, and `src/seed.ts`
 * for the rest of the reasoning.
 *
 * This is one of the two processes. The other is Next.js, and it is the one a browser
 * talks to; see the README and `next.config.ts`.
 */
import { User } from '@assemora/auth'

import { createApp, databaseUrl } from './app.ts'
import { seed } from './seed.ts'

/**
 * Next.js owns port 3000, because that is the origin a browser is pointed at.
 *
 * Nothing about the framework prefers 4000; it is simply the second port, and
 * `next.config.ts` and `.env.example` both name it.
 */
const DEFAULT_PORT = 4000

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
  console.log('This database has no users yet. `pnpm seed` creates the first administrator')
  console.log('and the read-only token the Next.js half reads with.')
}

const declared = Number(process.env.PORT)
const address = await app.listen(
  Number.isFinite(declared) && declared > 0 ? declared : DEFAULT_PORT,
)

console.log(`the application is listening on ${address}`)
console.log(`  api      ${address}/api`)
// assemora:if studio
console.log(`  studio   ${address}/studio`)
// assemora:end
console.log('')
console.log(
  'A browser goes to Next.js, not here: run `pnpm dev:web` and open http://localhost:3000',
)
