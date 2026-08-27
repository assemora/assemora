/**
 * Two accounts and some articles (SPEC.md §50, §85).
 *
 * The seed writes through the Command Bus rather than through the models, so nothing
 * in this example reaches the database by a path a person or an agent could not take
 * (SPEC.md §14). The two accounts it creates exist to make `src/policies.ts`
 * observable: one holds every permission, the other holds almost none.
 *
 * Two rules govern *when* it runs, and both exist because `assemora start` — the
 * production command — runs `src/server.ts` and nothing else (SPEC.md §79):
 *
 * 1. `src/server.ts` seeds only the in-memory fallback, the one database where an
 *    account nobody asked for cannot matter. Seeding a real one is `pnpm seed`,
 *    which is this file, run deliberately.
 * 2. The password is never written here. It comes from `ASSEMORA_SEED_PASSWORD`, and
 *    when the environment has none the seed generates one and puts it in `.env` —
 *    never on a stream, and never a constant this repository could publish.
 */
import { randomBytes } from 'node:crypto'
import { realpathSync } from 'node:fs'

import { hashPassword, Permission, Role, RolePermission, User, UserRole } from '@assemora/auth'
import type { Application } from '@assemora/core'

import { createApp } from './app.ts'
import { remember } from './env.ts'

const EDITOR = 'editor@example.com'
const WRITER = 'ada@example.com'

/**
 * The password both accounts get.
 *
 * `ASSEMORA_SEED_PASSWORD` when the environment has one, and otherwise generated and
 * remembered in `.env`, which `src/app.ts` reads back on the next boot. It is written
 * before either account exists: an account whose password went nowhere is one nobody
 * can ever sign in as.
 */
const seedPassword = async (): Promise<string> => {
  const declared = process.env.ASSEMORA_SEED_PASSWORD

  if (declared !== undefined && declared !== '') return declared

  // 144 bits, in the alphabet `.env` needs no quoting for.
  const generated = randomBytes(18).toString('base64url')

  await remember('ASSEMORA_SEED_PASSWORD', generated)

  return generated
}

const permissionNamed = async (name: string): Promise<string> => {
  const existing = await Permission.where('name', name).first()

  return existing === null ? (await Permission.create({ name, description: null })).id : existing.id
}

/** A role, its permissions, and the account that holds it. */
const account = async (
  email: string,
  name: string,
  role: string,
  permissions: readonly string[],
  password: string,
): Promise<string> => {
  const user = await User.create({ email, name, passwordHash: await hashPassword(password) })
  const created = await Role.create({ name: role, label: name })

  for (const permission of permissions) {
    await RolePermission.create({
      roleId: created.id,
      permissionId: await permissionNamed(permission),
    })
  }

  await UserRole.create({ userId: user.id, roleId: created.id })

  return user.id
}

const entry = async (app: Application, resource: string, data: unknown): Promise<string> => {
  const created = (await app.commands.execute('entries.create', { resource, data })) as {
    id: string
  }

  return created.id
}

export const seed = async (app: Application): Promise<void> => {
  if ((await User.count()) > 0) return

  const password = await seedPassword()

  // `*` is every permission there is (SPEC.md §50).
  const editor = await account(EDITOR, 'Editor', 'editor', ['*'], password)

  /**
   * Deliberately narrow. This account may write articles and may not update one, so
   * every `entries.update` it sends falls through to the policy — which is the only
   * way to see the rule of SPEC.md §51 actually decide something.
   */
  const writer = await account(
    WRITER,
    'Ada Lovelace',
    'writer',
    ['articles.read', 'articles.create', 'authors.read', 'categories.read', 'pages.read'],
    password,
  )

  // Commands need to know who is asking: policies, revisions and the audit log all
  // record the actor, and a command run by nobody is refused rather than trusted.
  await app.run({ source: 'internal', actor: { type: 'user', id: editor } }, async () => {
    const engineering = await entry(app, 'categories', {
      name: 'Engineering',
      slug: 'engineering',
    })
    const craft = await entry(app, 'categories', { name: 'Craft', slug: 'craft' })

    // One author profile is wired to the writer's login and one is not, which is the
    // difference the article policy reads.
    const ada = await entry(app, 'authors', {
      name: 'Ada Lovelace',
      slug: 'ada-lovelace',
      bio: 'Writes about the machine underneath.',
      userId: writer,
    })
    const grace = await entry(app, 'authors', {
      name: 'Grace Hopper',
      slug: 'grace-hopper',
      bio: 'A guest writer with no account here.',
    })

    await entry(app, 'articles', {
      title: 'One declaration, seven subsystems',
      slug: 'one-declaration-seven-subsystems',
      excerpt: 'A column is written once and turns up everywhere it is needed.',
      body: 'The table, the validator, the record type, the Studio form, the REST payload, the OpenAPI schema and the MCP tool all come from the same lines in src/models.ts.',
      status: 'published',
      featured: true,
      publishedAt: new Date(),
      authorId: ada,
      categoryId: engineering,
    })

    await entry(app, 'articles', {
      title: 'Scopes are not helpers',
      slug: 'scopes-are-not-helpers',
      excerpt: 'A named piece of a query composes with everything after it.',
      body: 'Article.published() hands back a builder, so the route, the block and the seed all agree on what published means without any of them saying it twice.',
      status: 'published',
      publishedAt: new Date(),
      authorId: grace,
      categoryId: craft,
    })

    await entry(app, 'articles', {
      title: 'Unfinished, and staying that way',
      slug: 'unfinished',
      body: 'A draft shares the slug space with everything published and is served by neither public route.',
      status: 'draft',
      authorId: grace,
      categoryId: craft,
    })

    const home = (await app.commands.execute('pages.create', {
      slug: 'home',
      title: 'The blog',
    })) as { id: string }

    const add = (type: string, props: Record<string, unknown>) =>
      app.commands.execute('blocks.add', { id: home.id, type, props })

    await add('hero', {
      title: 'Written in TypeScript, edited by people',
      subtitle: 'And proposed by agents, through the same commands.',
    })
    await add('prose', {
      body: 'Everything below is read at render time, so an article published a minute from now appears here without this page being touched.',
    })
    await add('articleList', { heading: 'Latest', limit: 6 })

    // A draft is not what a visitor gets. Publishing is its own command, and it
    // refuses a tree holding a block whose required fields are still empty.
    await app.commands.execute('pages.publish', { id: home.id })
  })

  // The addresses, never the password: it is in `.env`, under ASSEMORA_SEED_PASSWORD.
  console.log(`seeded ${EDITOR} (everything) and ${WRITER} (almost nothing)`)
  console.log('Both sign in with the password in .env, as ASSEMORA_SEED_PASSWORD.')
}

/**
 * `pnpm seed` — the same function `src/server.ts` calls, run on its own against
 * whatever `DATABASE_URL` names. Node names the file it was started with in
 * `process.argv[1]`, and that is this file only when it was started directly, so
 * importing the seed does not run it.
 */
const started = process.argv[1]

if (started !== undefined && realpathSync(started) === import.meta.filename) {
  const app = createApp()

  await app.boot()
  await seed(app.app)
  await app.shutdown()
}
