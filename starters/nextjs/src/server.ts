/**
 * What `assemora dev` and `assemora start` run (SPEC.md §79).
 *
 * Boot, seed, listen. The seed is written as commands rather than as inserts on
 * purpose: `entries.create` and `blocks.add` are the same commands Studio sends and
 * an agent proposes over MCP, so nothing in this project reaches the database by a
 * path a person or an agent could not take (SPEC.md §14).
 *
 * This is one of the two processes. The other is Next.js, and it is the one a browser
 * talks to; see the README and `next.config.ts`.
 */
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

const ADMIN_EMAIL = 'admin@example.com'

/** Only ever true of a database nobody else can reach. Change it before deploying. */
const ADMIN_PASSWORD = 'correct horse battery staple'

/**
 * Next.js owns port 3000, because that is the origin a browser is pointed at.
 *
 * Nothing about the framework prefers 4000; it is simply the second port, and
 * `next.config.ts` and `.env.example` both name it.
 */
const DEFAULT_PORT = 4000

/**
 * Enough to sign in and see something.
 *
 * It runs once: on PostgreSQL the first user is the guard, and on the in-memory
 * fallback there is never a first user, which is why `pnpm dev` shows the same page
 * on every restart and why losing it is worth a warning.
 */
const seed = async (app: Application): Promise<void> => {
  if ((await User.count()) > 0) return

  const admin = await User.create({
    email: ADMIN_EMAIL,
    name: 'Admin',
    passwordHash: await hashPassword(ADMIN_PASSWORD),
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
   * It is shown once. Nothing in the system can recover it, which is the point.
   */
  const frontend = await createApiToken({
    name: 'Next.js frontend',
    permissions: ['pages.read', 'articles.read'],
  })

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

  console.log(`seeded ${ADMIN_EMAIL} with the password "${ADMIN_PASSWORD}"`)
  console.log('')
  console.log('Put this in .env, then restart, or the site will render a 403:')
  console.log(`  ASSEMORA_TOKEN=${frontend.token}`)
  console.log('')
}

const app = createApp()

// Booting and listening are separate calls so that seeding can happen between them.
await app.boot()
await seed(app.app)

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
