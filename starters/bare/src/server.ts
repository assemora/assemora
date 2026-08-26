/**
 * What `assemora dev` and `assemora start` run (SPEC.md §79).
 *
 * Boot, seed, listen. The seed is written as commands rather than as inserts on
 * purpose: `entries.create` and `blocks.add` are the same commands Studio sends and
 * an agent proposes over MCP, so nothing in this project reaches the database by a
 * path a person or an agent could not take (SPEC.md §14).
 */
import { hashPassword, Permission, Role, RolePermission, User, UserRole } from '@assemora/auth'
import type { Application } from '@assemora/core'

import { createApp } from './app.ts'

const ADMIN_EMAIL = 'admin@example.com'

/** Only ever true of a database nobody else can reach. Change it before deploying. */
const ADMIN_PASSWORD = 'correct horse battery staple'

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
}

const app = createApp()

// Booting and listening are separate calls so that seeding can happen between them.
await app.boot()
await seed(app.app)

const address = await app.listen()

console.log(`listening on ${address}`)
console.log(`  api      ${address}/api`)
// assemora:if studio
console.log(`  studio   ${address}/studio`)
// assemora:end
// assemora:if pages
console.log(`  site     ${address}/preview`)
// assemora:end
