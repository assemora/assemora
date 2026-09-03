/**
 * Enough content to develop Studio against.
 *
 * Everything here goes through the same commands Studio will use, so seeding is also
 * a rehearsal of the paths the interface takes.
 */

import {
  createAgent,
  hashPassword,
  Permission,
  Role,
  RolePermission,
  User,
  UserRole,
} from '@assemora/auth'
import type { Application } from '@assemora/core'
import { Page } from '@assemora/pages'
import { Article } from './blog.ts'

export const ADMIN_EMAIL = 'ada@assemora.dev'
export const ADMIN_PASSWORD = 'correct horse battery staple'

/**
 * What the seeded agent may do.
 *
 * Enough to be worth connecting to and not enough to be worth borrowing: it reads
 * pages and proposes changes to them, which is the loop SPEC.md §75 is about, and it
 * cannot apply anything — that is a person's, and the whole point.
 */
const AGENT_PERMISSIONS = [
  'assemora.describe',
  'pages.read',
  'pages.list',
  'blocks.update',
  'changesets.propose',
]

/**
 * Two roles, so the Users section has something real to show and so the wildcard
 * grants of SPEC.md §50 are exercised rather than assumed.
 */
const ROLES = [
  { name: 'administrator', label: 'Administrator', permissions: ['*'] },
  {
    name: 'editor',
    label: 'Editor',
    permissions: ['articles.*', 'pages.*', 'blocks.*', 'media.*', 'revisions.*'],
  },
]

/** What the seed leaves behind that the boot output has to say out loud. */
export type Seeded = {
  /** The agent's token, which exists in readable form exactly once. */
  readonly agentToken?: string
}

export const seed = async (app: Application): Promise<Seeded> => {
  if ((await User.count()) > 0) return {}

  const admin = await User.create({
    email: ADMIN_EMAIL,
    name: 'Ada Lovelace',
    passwordHash: await hashPassword(ADMIN_PASSWORD),
    active: true,
    version: 1,
  })

  for (const declared of ROLES) {
    const role = await Role.create({ name: declared.name, label: declared.label, version: 1 })

    if (declared.name === 'administrator') {
      await UserRole.create({ userId: admin.id, roleId: role.id })
    }

    for (const name of declared.permissions) {
      const permission =
        (await Permission.where('name', name).first()) ??
        (await Permission.create({ name, description: null }))

      await RolePermission.create({ roleId: role.id, permissionId: permission.id })
    }
  }

  const editor = await User.create({
    email: 'grace@assemora.dev',
    name: 'Grace Hopper',
    passwordHash: await hashPassword(ADMIN_PASSWORD),
    active: true,
    version: 1,
  })

  const editorRole = await Role.where('name', 'editor').firstOrFail()

  await UserRole.create({ userId: editor.id, roleId: editorRole.id })

  await app.run({ source: 'cli', actor: { type: 'user', id: admin.id } }, async () => {
    const articles = [
      {
        title: 'Notes on the Analytical Engine',
        slug: 'notes-on-the-analytical-engine',
        excerpt: 'What a machine could do if it were told carefully enough.',
        content: 'The Analytical Engine has no pretensions whatever to originate anything.',
        status: 'published',
        views: 1240,
        featured: true,
      },
      {
        title: 'On sequences and loops',
        slug: 'on-sequences-and-loops',
        excerpt: 'A note about repetition.',
        content:
          'A cycle of operations, then, means any set of operations repeated more than once.',
        status: 'published',
        views: 310,
        featured: false,
      },
      {
        title: 'Draft: a language for the engine',
        slug: 'draft-a-language-for-the-engine',
        excerpt: null,
        content: 'Still thinking about notation.',
        status: 'draft',
        views: 0,
        featured: false,
      },
    ]

    for (const article of articles) {
      await app.commands.execute('entries.create', { resource: 'articles', data: article })
    }

    const home = (await app.commands.execute('pages.create', {
      slug: 'home',
      title: 'Home',
      meta: { description: 'The front page' },
    })) as { id: string }

    await app.commands.execute('blocks.add', {
      id: home.id,
      type: 'hero',
      props: {
        title: 'Build visually. Extend with TypeScript.',
        subtitle: 'Control with AI.',
        variant: 'centered',
      },
    })

    const section = (await app.commands.execute('blocks.add', {
      id: home.id,
      type: 'section',
      props: { title: 'Questions', width: 'narrow' },
    })) as { blockId: string }

    await app.commands.execute('blocks.add', {
      id: home.id,
      type: 'faq',
      parentId: section.blockId,
      props: { question: 'Is a page HTML?', answer: 'No. It is a tree of blocks.' },
    })

    await app.commands.execute('pages.publish', { id: home.id })

    // A second page, left in draft, so the Pages list shows both states.
    const about = (await app.commands.execute('pages.create', {
      slug: 'about',
      title: 'About',
      meta: { description: 'Who is behind this' },
    })) as { id: string }

    await app.commands.execute('blocks.add', {
      id: about.id,
      type: 'hero',
      props: { title: 'A note on notation', subtitle: 'Still being written.', variant: 'centered' },
    })
  })

  /**
   * An agent, and its token printed.
   *
   * Every other way to get one needs a session first, and until `assemora agents:create`
   * existed there was none written down at all — so anybody who found `/api/mcp` met a
   * 401 with no route past it. Here the token is printed for the reason the password is:
   * this is a fixture in an in-memory database that dies with the process, not a
   * credential. A starter does the opposite and must.
   */
  const agent = await app.run({ source: 'cli' }, () =>
    createAgent({
      name: 'Content agent',
      description: 'Reads pages and proposes changes to them',
      permissions: AGENT_PERMISSIONS,
    }),
  )

  console.log(
    `[playground] seeded ${await Article.count()} articles and ${await Page.count()} page`,
  )

  return { agentToken: agent.token }
}
