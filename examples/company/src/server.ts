/**
 * Boot, seed, listen (SPEC.md §79).
 *
 * The seed is worth reading as documentation: every page below is assembled with the
 * same commands the builder sends, in the same order a person would use them. Add,
 * nest, set the design, publish — there is no second path into a page tree, which is
 * why an agent can do all four through MCP (SPEC.md §60).
 */
import { hashPassword, Permission, Role, RolePermission, User, UserRole } from '@assemora/auth'
import type { Application } from '@assemora/core'
import type { BlockDesignPatch } from '@assemora/schema'

import { createApp } from './app.ts'

const ADMIN = 'admin@example.com'

/** Only ever true of a database nobody else can reach. */
const PASSWORD = 'correct horse battery staple'

const newPage = async (app: Application, slug: string, title: string): Promise<string> => {
  const created = (await app.commands.execute('pages.create', { slug, title })) as { id: string }

  return created.id
}

/** Answers with the new block's id, which is how the next call nests inside it. */
const add = async (
  app: Application,
  page: string,
  type: string,
  props: Record<string, unknown>,
  parentId?: string,
): Promise<string> => {
  const added = (await app.commands.execute('blocks.add', {
    id: page,
    type,
    props,
    ...(parentId === undefined ? {} : { parentId }),
  })) as { blockId: string }

  return added.blockId
}

/**
 * The universal controls (SPEC.md §61).
 *
 * Every value is a token — `xl`, `wide`, `surface-sunken` — and `app/theme.css` is the
 * only place that decides what one looks like. Nothing here can express a colour or a
 * rule, which is exactly why an agent is allowed to set them.
 */
const design = (app: Application, page: string, blockId: string, patch: BlockDesignPatch) =>
  app.commands.execute('blocks.design', { id: page, blockId, design: patch })

const entry = (app: Application, resource: string, data: unknown) =>
  app.commands.execute('entries.create', { resource, data })

const landing = async (app: Application): Promise<void> => {
  const home = await newPage(app, 'home', 'Home')

  const hero = await add(app, home, 'hero', {
    headline: 'One application layer. Three kinds of author.',
    subhead: 'Developers write TypeScript, people edit in Studio, agents propose changes.',
    action: 'See the open roles',
    href: '/preview?slug=careers',
    variant: 'centered',
  })

  await design(app, home, hero, {
    spacingTop: 'xl',
    spacingBottom: 'xl',
    align: 'center',
    background: 'surface-sunken',
    width: 'normal',
  })

  const what = await add(app, home, 'section', {
    heading: 'What we build',
    lede: 'A schema-first CMS whose application layer is the product.',
    columns: 'three',
  })

  await design(app, home, what, { spacingTop: 'lg', spacingBottom: 'lg', container: 'wide' })

  // Nested: each of these is a child of the section, which accepts them by name.
  await add(
    app,
    home,
    'feature',
    {
      title: 'One declaration',
      body: 'A column becomes a table, a validator, a form, an endpoint and a tool.',
      icon: 'spark',
    },
    what,
  )
  await add(
    app,
    home,
    'feature',
    {
      title: 'One mutation path',
      body: 'Studio, REST, the SDK, the CLI and MCP all arrive through the Command Bus.',
      icon: 'shield',
    },
    what,
  )
  await add(
    app,
    home,
    'feature',
    {
      title: 'One renderer',
      body: 'The builder canvas frames the site itself, so a preview cannot drift.',
      icon: 'graph',
    },
    what,
  )

  const cta = await add(app, home, 'cta', {
    title: 'Come and work on it',
    label: 'Open roles',
    href: '/preview?slug=careers',
  })

  await design(app, home, cta, { spacingTop: 'xl', spacingBottom: 'xl', background: 'brand-soft' })

  await app.commands.execute('pages.publish', { id: home })
}

const teamPage = async (app: Application): Promise<void> => {
  const team = await newPage(app, 'team', 'Team')

  const hero = await add(app, team, 'hero', {
    headline: 'The people',
    subhead: 'Everybody here, in the order they chose.',
    variant: 'centered',
  })

  await design(app, team, hero, { spacingTop: 'lg', spacingBottom: 'md', align: 'center' })

  // No props but a heading: the people themselves are read at render time.
  await add(app, team, 'team', { heading: 'Everybody' })

  await app.commands.execute('pages.publish', { id: team })
}

const careersPage = async (app: Application): Promise<void> => {
  const careers = await newPage(app, 'careers', 'Careers')

  const hero = await add(app, careers, 'hero', {
    headline: 'Open roles',
    subhead: 'Small team, long horizon.',
    variant: 'centered',
  })

  await design(app, careers, hero, { spacingTop: 'lg', spacingBottom: 'md', align: 'center' })

  await add(app, careers, 'prose', {
    body: 'We hire slowly and write things down. Every role below is read from the Open roles screen in Studio, so closing one takes a single toggle and no deploy.',
  })

  await add(app, careers, 'openings', { heading: 'Currently hiring' })

  await app.commands.execute('pages.publish', { id: careers })
}

const content = async (app: Application): Promise<void> => {
  const people = [
    { name: 'Ada Lovelace', title: 'Founder', position: 10, bio: 'Wrote the first program.' },
    { name: 'Grace Hopper', title: 'Engineering', position: 20, bio: 'Wrote the first compiler.' },
    { name: 'Barbara Liskov', title: 'Architecture', position: 30, bio: 'Wrote the rule.' },
    { name: 'Karen Spärck Jones', title: 'Search', position: 40, bio: 'Weighted the words.' },
  ]

  for (const person of people) await entry(app, 'team', { ...person, photo: null, published: true })

  const roles = [
    {
      title: 'Backend engineer',
      slug: 'backend-engineer',
      team: 'Engineering',
      location: 'Remote (EU)',
      employment: 'full-time',
      description: 'Own the query layer and the migration story.',
      status: 'open',
    },
    {
      title: 'Design engineer',
      slug: 'design-engineer',
      team: 'Design',
      location: 'Remote (EU)',
      employment: 'full-time',
      description: 'Make the builder feel like a design tool rather than a form.',
      status: 'open',
    },
    {
      title: 'Technical writer',
      slug: 'technical-writer',
      team: 'Design',
      location: 'Remote',
      employment: 'contract',
      description: 'Turn the specification into something a newcomer can finish.',
      // Closed, and therefore absent from GET /api/site/openings.
      status: 'closed',
    },
  ]

  for (const role of roles) await entry(app, 'openings', role)
}

const seed = async (app: Application): Promise<void> => {
  if ((await User.count()) > 0) return

  const admin = await User.create({
    email: ADMIN,
    name: 'Admin',
    passwordHash: await hashPassword(PASSWORD),
  })

  const role = await Role.create({ name: 'administrator', label: 'Administrator' })
  const everything = await Permission.create({ name: '*', description: null })

  await RolePermission.create({ roleId: role.id, permissionId: everything.id })
  await UserRole.create({ userId: admin.id, roleId: role.id })

  await app.run({ source: 'internal', actor: { type: 'user', id: admin.id } }, async () => {
    await content(app)
    await landing(app)
    await teamPage(app)
    await careersPage(app)
  })

  console.log(`seeded ${ADMIN} with the password "${PASSWORD}"`)
}

const app = createApp()

await app.boot()
await seed(app.app)

const address = await app.listen()

console.log(`listening on ${address}`)
console.log(`  studio   ${address}/studio`)
console.log(`  site     ${address}/preview`)
console.log(`  public   ${address}/api/site/pages/home`)
