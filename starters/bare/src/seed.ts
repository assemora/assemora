/**
 * The first administrator, and nothing else (SPEC.md §50, §85).
 *
 * There is no content to seed: this project declares none, and a starter that put an
 * article in your database to have something to show would be choosing your content
 * model for you. What the seed exists for is the one account that cannot be made
 * through the application, because signing in is how anything is made at all.
 *
 * Two rules govern *when* it runs, and both exist because `assemora start` — the
 * production command — runs `src/server.ts` and nothing else (SPEC.md §79):
 *
 * 1. `src/server.ts` seeds only the in-memory fallback. That is the one database
 *    where an account nobody asked for cannot matter: nothing outside the process can
 *    reach it and it is gone at the next restart. Seeding a real database is
 *    `pnpm seed`, which is this file, run deliberately, once.
 * 2. The password is never written here. It comes from `ASSEMORA_SEED_PASSWORD`, and
 *    when the environment has none the seed generates one and puts it in `.env` —
 *    never on a stream, and never a constant this repository could publish.
 *
 * Seeding *content* is a different act, and the shape is worth knowing before you need
 * it: a record goes in through `entries.create` on the Command Bus rather than through
 * `Post.create()`, so that validation, policies, revisions and the audit log all see
 * it exactly as they see Studio and an agent (SPEC.md §14). That needs an actor, so
 * `seed()` grows an `app: Application` parameter and wraps the writes in
 * `app.run({ source: 'internal', actor: { type: 'user', id: admin.id } }, …)`.
 * `--template blog` scaffolds a project that already does it.
 */
import { randomBytes } from 'node:crypto'
import { realpathSync } from 'node:fs'

import { hashPassword, Permission, Role, RolePermission, User, UserRole } from '@assemora/auth'

import { createApp } from './app.ts'
import { remember } from './env.ts'

const ADMIN_EMAIL = 'admin@example.com'

/**
 * The password the seeded administrator gets.
 *
 * `ASSEMORA_SEED_PASSWORD` first, because that is how a real database is seeded and
 * how CI does it. Otherwise one is generated and remembered in `.env`, which
 * `src/app.ts` reads back on the next boot — so `pnpm dev` does not hand you a
 * different login every time a saved file restarts the watcher.
 *
 * It is written *before* the account exists on purpose. An administrator whose
 * password went nowhere is an account nobody can ever sign in as, and a failed write
 * has to stop the seed rather than leave one behind.
 */
const seedPassword = async (): Promise<string> => {
  const declared = process.env.ASSEMORA_SEED_PASSWORD

  if (declared !== undefined && declared !== '') return declared

  // 144 bits, in the alphabet `.env` needs no quoting for.
  const generated = randomBytes(18).toString('base64url')

  await remember('ASSEMORA_SEED_PASSWORD', generated)

  return generated
}

/**
 * Enough to sign in.
 *
 * It runs once: the first user is the guard, so `pnpm seed` twice is harmless and a
 * database that already has people in it is left alone.
 */
export const seed = async (): Promise<void> => {
  if ((await User.count()) > 0) return

  const admin = await User.create({
    email: ADMIN_EMAIL,
    name: 'Admin',
    passwordHash: await hashPassword(await seedPassword()),
  })

  // `*` is every permission there is (SPEC.md §50). Narrower roles — `posts.*`,
  // `pages.read` — are made in Studio's Users section, or here.
  const administrator = await Role.create({ name: 'administrator', label: 'Administrator' })
  const everything = await Permission.create({ name: '*', description: null })

  await RolePermission.create({ roleId: administrator.id, permissionId: everything.id })
  await UserRole.create({ userId: admin.id, roleId: administrator.id })

  // The address, never the password. The password is in `.env`, under
  // ASSEMORA_SEED_PASSWORD, and that is the only place it exists in the clear.
  console.log(`seeded ${ADMIN_EMAIL} — its password is in .env, as ASSEMORA_SEED_PASSWORD`)
}

/**
 * `pnpm seed`.
 *
 * The same function `src/server.ts` calls, run on its own against whatever
 * `DATABASE_URL` names — which is the only way this project ever creates an account
 * on a real database. Node names the file it was started with in `process.argv[1]`,
 * and that is this file only when it was started directly, so `src/server.ts`
 * importing the seed does not run it. Both sides are resolved through the real
 * filesystem, because `import.meta.filename` already is and a temporary directory on
 * macOS is reached through a symlink.
 */
const entry = process.argv[1]

if (entry !== undefined && realpathSync(entry) === import.meta.filename) {
  const app = createApp()

  await app.boot()
  await seed()
  await app.shutdown()
}
