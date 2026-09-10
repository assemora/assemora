/**
 * The site, for people who are not signed in (SPEC.md §41).
 *
 * A marketing site has no readers with accounts, and authorization denies by default
 * (SPEC.md §50), so every one of these three is a deliberate opening — and each one
 * opens exactly one thing.
 *
 * `pages.get` is the query Studio and the builder canvas use, and it cannot be the
 * public door: it accepts `mode=draft`, and a policy answering "may this actor read
 * pages" never sees which mode was asked for. It would publish every unfinished draft
 * on the site. A route can insist, because it writes the filter itself — `status`
 * published, and the *published* tree, never the draft beside it.
 */
import { NotFoundError } from '@assemora/core'
import { route } from '@assemora/http'
import { Page } from '@assemora/pages'
import { array, blockTree, emptyTree, enumOf, object, string } from '@assemora/schema'

import { Opening, TeamMember } from './models.ts'

export const readPage = route.get('/site/pages/:slug', {
  description: 'The published tree of one page',
  tags: ['site'],
  params: { slug: string().min(1) },
  response: { slug: string(), title: string(), tree: blockTree() },
  errors: [{ code: 'NOT_FOUND', status: 404, description: 'No published page has that slug' }],
  handler: async ({ params }) => {
    const page = await Page.where('slug', params.slug).where('status', 'published').firstOrFail()

    // A page published and then unpublished keeps its tree; `status` is what decides,
    // and `?? emptyTree()` is the honest answer for one that has never been published.
    return { slug: page.slug, title: page.title, tree: page.publishedTree ?? emptyTree() }
  },
})

export const listTeam = route.get('/site/team', {
  description: 'Everybody currently shown on the site, in their chosen order',
  tags: ['site'],
  response: {
    members: array(
      object({
        name: string(),
        title: string(),
        bio: string().nullable(),
        photo: string().nullable(),
      }),
    ),
  },
  handler: async () => {
    const members = await TeamMember.onTheSite().orderBy('position').get()

    return {
      members: members.map((member) => ({
        name: member.name,
        title: member.title,
        bio: member.bio,
        photo: member.photo,
      })),
    }
  },
})

export const listOpenings = route.get('/site/openings', {
  description: 'Roles currently open',
  tags: ['site'],
  response: {
    roles: array(
      object({
        slug: string(),
        title: string(),
        team: string(),
        location: string(),
        employment: enumOf('full-time', 'part-time', 'contract'),
        description: string(),
      }),
    ),
  },
  handler: async () => {
    const open = await Opening.open().orderBy('team').orderBy('title').get()

    return {
      roles: open.map((role) => ({
        slug: role.slug,
        title: role.title,
        team: role.team,
        location: role.location,
        employment: role.employment,
        description: role.description,
      })),
    }
  },
})

/**
 * Who to sign in as, for a demo that publishes its own administrator.
 *
 * A public demo whose front door is a password field is a closed door: a visitor
 * arrives, finds a form, and has no way to know what to type. The credentials are
 * published on purpose here — the database is in memory and a restart is a clean site
 * — so the honest thing is to say them where the visitor is, rather than only in
 * whatever post linked here.
 *
 * Two conditions, both required, because this file is an example people copy. It
 * answers only when the deployment has opted in with `ASSEMORA_DEMO=1` *and* is
 * running on the throwaway in-memory database. Copied into a project with a real
 * `DATABASE_URL`, it answers 404 and nothing else — a route that hands out a password
 * must be impossible to enable by accident.
 */
export const demoCredentials = route.get('/site/demo', {
  description: "The demo's published administrator, when this deployment is a demo",
  tags: ['site'],
  response: { email: string(), password: string() },
  errors: [{ code: 'NOT_FOUND', status: 404, description: 'This deployment is not a demo' }],
  handler: async () => {
    const declared = process.env.ASSEMORA_SEED_PASSWORD
    const isDemo = process.env.ASSEMORA_DEMO === '1' && process.env.DATABASE_URL === undefined

    if (!isDemo || declared === undefined || declared === '') {
      throw new NotFoundError('demo', 'credentials')
    }

    return { email: 'admin@example.com', password: declared }
  },
})

export const siteRoutes = [readPage, listTeam, listOpenings, demoCredentials] as const
