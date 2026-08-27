/**
 * The first administrator, the frontend's token, and enough content to see something
 * (SPEC.md §49, §50, §52, §85).
 *
 * The seed is written as commands rather than as inserts on purpose: `entries.create`
 * and `blocks.add` are the same commands Studio sends and an agent proposes over MCP,
 * so nothing in this project reaches the database by a path a person or an agent
 * could not take (SPEC.md §14).
 *
 * Two rules govern *when* it runs, and both exist because `assemora start` — the
 * production command — runs `src/server.ts` and nothing else (SPEC.md §79):
 *
 * 1. `src/server.ts` seeds only the in-memory fallback. That is the one database
 *    where an account nobody asked for cannot matter: nothing outside the process can
 *    reach it and it is gone at the next restart. Seeding a real database is
 *    `pnpm seed`, which is this file, run deliberately, once.
 * 2. Neither the password nor the token is ever printed. Both go into `.env`, which
 *    is where this project's secrets live and where Next.js reads its own.
 */
import { randomBytes } from 'node:crypto'
import { realpathSync } from 'node:fs'

import {
  createApiToken,
  hashPassword,
  Permission,
  Role,
  RolePermission,
  User,
  UserRole,
} from '@assemora/auth'
import type { Application } from '@assemora/core'

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
 * Enough to sign in and see something.
 *
 * It runs once: the first user is the guard, so `pnpm seed` twice is harmless and a
 * database that already has people in it is left alone.
 */
export const seed = async (app: Application): Promise<void> => {
  if ((await User.count()) > 0) return

  const admin = await User.create({
    email: ADMIN_EMAIL,
    name: 'Admin',
    passwordHash: await hashPassword(await seedPassword()),
  })

  // `*` is every permission there is (SPEC.md §50). Narrower roles — `articles.*`,
  // `pages.read` — are made in Studio's Users section, or here.
  const administrator = await Role.create({ name: 'administrator', label: 'Administrator' })
  const everything = await Permission.create({ name: '*', description: null })

  await RolePermission.create({ roleId: administrator.id, permissionId: everything.id })
  await UserRole.create({ userId: admin.id, roleId: administrator.id })

  /**
   * The identity the Next.js server reads with (SPEC.md §49).
   *
   * A visitor arrives with no session, and a read is denied by default like every
   * other operation — so a server-rendered page has to say who is asking. It asks as
   * this token, which holds two read permissions and nothing else: it cannot create,
   * cannot update, cannot delete and cannot see a user. It lives in the Next.js
   * server's environment and never reaches a browser.
   *
   * The plaintext exists exactly once (SPEC.md §52), and it goes into `.env` — the
   * file Next.js already reads and the one place in this project a secret belongs.
   * Not stdout: `assemora start` hands its streams to whatever supervises it, and a
   * token in a log aggregator is a token in everybody's search index.
   */
  const frontend = await createApiToken({
    name: 'Next.js frontend',
    permissions: ['pages.read', 'articles.read'],
  })

  await remember('ASSEMORA_TOKEN', frontend.token)

  // Commands need to know who is asking: policies, revisions and the audit log all
  // record the actor, and a command run by nobody is refused rather than trusted.
  await app.run({ source: 'internal', actor: { type: 'user', id: admin.id } }, async () => {
    await app.commands.execute('entries.create', {
      resource: 'articles',
      data: {
        title: 'Hello from Assemora',
        slug: 'hello-from-assemora',
        body: 'Edit this in Studio, over REST, through the SDK, or ask an agent to.',
        published: true,
      },
    })

    // assemora:if pages
    const home = (await app.commands.execute('pages.create', {
      slug: 'home',
      title: 'Home',
    })) as { id: string }

    await app.commands.execute('blocks.add', {
      id: home.id,
      type: 'hero',
      props: { title: 'Build visually. Extend with TypeScript.', subtitle: 'Control with AI.' },
    })

    await app.commands.execute('blocks.add', {
      id: home.id,
      type: 'richText',
      props: {
        body: 'A page is a tree of blocks with stable ids, never a blob of HTML. Move one in the builder and the tree changes; nothing is re-parsed.',
      },
    })

    // A draft is not what a visitor gets. Publishing is its own command, so the two
    // trees a page carries can differ until somebody says they should not.
    await app.commands.execute('pages.publish', { id: home.id })
    // assemora:end
  })

  // The names of the two credentials, never their values. Both are in `.env`.
  console.log(`seeded ${ADMIN_EMAIL}`)
  console.log('  ASSEMORA_SEED_PASSWORD and ASSEMORA_TOKEN are in .env, not in this log')
  console.log('  restart the Next.js half so it reads the new token')
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
  await seed(app.app)
  await app.shutdown()
}
