/**
 * Which silence each screen is looking at (SPEC.md §58, §115).
 *
 * `ui/blank.test.tsx` pins what the empty states *say*. This pins the half that decides
 * which of them a screen says, and when — the wiring, which is where the mistake that
 * matters lives: every sentence in `blank.tsx` can be right while the page list shows
 * "no page matches that" to somebody who has never made one.
 *
 * That mistake is invisible to a test of the words and invisible to a reader, because
 * both branches are correct code. It shows up only under a screen that was handed an
 * application's actual answers, which is what the harness below is: a viewer with a
 * permission set, the queries Studio would have fetched already in the cache, and a
 * router, so the screen renders the way it renders in a browser rather than the way it
 * renders in isolation.
 *
 * Rendered rather than mounted: this suite has no DOM, so a screen's own `useState` is
 * only ever seen in its initial state and every case below is a first paint — which is
 * exactly the paint a fresh install is judged on. One thing stays out of reach because
 * of it: a list *after* somebody has typed in its search box. That the two silences are
 * worded apart is pinned in `ui/blank.test.tsx`; that a screen picks the right one for
 * an application with nothing in it is pinned here; that it picks the right one for a
 * search that found nothing needs a keystroke, and a keystroke needs a DOM that
 * `apps/studio` does not currently install.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from '@tanstack/react-router'
import type { ReactElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import type { CollectionList } from '../api/collections.ts'
import type { Introspection, ResourceDescriptor } from '../api/introspection.ts'
import type { Paged, PageSummary } from '../api/pages.ts'
import type { Viewer } from '../api/session.tsx'
import { SessionProvider } from '../api/session.tsx'
import { Collection } from './collection.tsx'
import { Collections } from './collections.tsx'
import { Dashboard } from './dashboard.tsx'
import { Pages } from './pages.tsx'

/**
 * What the application answered, before the screen asked.
 *
 * Seeding the cache rather than stubbing `fetch`: these screens read through the same
 * `useQuery` keys their siblings do, so a key that drifts stops answering here exactly
 * as it stops answering in a browser. A stub would keep passing.
 */
type World = {
  /** What the signed-in viewer holds. Nothing is a real state — a reader, not an editor. */
  readonly permissions?: readonly string[]
  readonly introspection?: Introspection
  readonly collections?: CollectionList
  /** `pages.list` with no filter set, which is what a screen asks for on first paint. */
  readonly pages?: Paged<PageSummary>
  /** `entries.list` for the resource the URL below names, unfiltered and unsorted. */
  readonly entries?: Paged<Readonly<Record<string, unknown>>>
}

/**
 * Where the screen under test lives.
 *
 * A screen that reads a route parameter has to be *at* its route, not at the root with
 * a parameter handed to it: `useParams({ from: '/content/$resource' })` asks the router,
 * and the router only knows because the URL matched.
 */
type Address = { readonly path: string; readonly url: string }

const ROOT: Address = { path: '/', url: '/' }

const viewer = (permissions: readonly string[]): Viewer => ({
  id: 'viewer',
  email: 'ada@assemora.dev',
  name: 'Ada',
  permissions,
})

/**
 * The addresses these screens link to, and live at.
 *
 * Named rather than inferred: a `Link` builds its href from the route tree, so a screen
 * pointing somewhere the application does not route is a broken link this list makes
 * visible instead of silently rendering.
 */
const LINKED = ['/content/$resource', '/collections/$name', '/pages/$id']

const draw = async (
  element: ReactElement,
  world: World = {},
  at: Address = ROOT,
): Promise<string> => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })

  client.setQueryData(['viewer'], viewer(world.permissions ?? []))
  if (world.introspection !== undefined) client.setQueryData(['introspection'], world.introspection)
  if (world.collections !== undefined) client.setQueryData(['collections'], world.collections)
  if (world.pages !== undefined) client.setQueryData(['pages', { page: 1 }], world.pages)
  if (world.entries !== undefined) {
    client.setQueryData(
      ['collection', at.url.split('/').pop(), { search: '', sort: '', page: 1 }],
      world.entries,
    )
  }

  const root = createRootRoute({ component: Outlet })
  // The real tree puts every screen but the page builder under a pathless `shell`
  // layout route, and a screen addresses its params by that route's id. Mirroring it
  // here is what keeps `useParams({ from: … })` resolving the way it does in the app.
  const shell = createRoute({ getParentRoute: () => root, id: 'shell', component: Outlet })
  const paths = LINKED.includes(at.path) ? LINKED : [...LINKED, at.path]
  const router = createRouter({
    routeTree: root.addChildren([
      shell.addChildren(
        paths.map((path) =>
          createRoute({
            getParentRoute: () => shell,
            path,
            component: path === at.path ? () => element : () => null,
          }),
        ),
      ),
    ]),
    history: createMemoryHistory({ initialEntries: [at.url] }),
  })

  // The router resolves the match before anything renders; without this the provider
  // draws its pending state and every assertion below would be against an empty string.
  await router.load()

  return renderToStaticMarkup(
    <QueryClientProvider client={client}>
      <SessionProvider>
        <RouterProvider router={router} />
      </SessionProvider>
    </QueryClientProvider>,
  )
}

/** Markup with the tags taken out, which is how a person reads it. */
const words = (markup: string): string =>
  markup
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#x27;|&quot;/g, "'")
    .replace(/\s+/g, ' ')
    .trim()

/** How many times a phrase appears — two of one button is one of them being ignored. */
const times = (markup: string, phrase: string): number => words(markup).split(phrase).length - 1

const listing = <T,>(data: readonly T[]): Paged<T> => ({
  data,
  total: data.length,
  page: 1,
  perPage: 20,
  lastPage: 1,
})

const page = (over: Partial<PageSummary> = {}): PageSummary => ({
  id: 'page-1',
  slug: 'about',
  title: 'About us',
  status: 'published',
  version: 3,
  publishedAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-02T00:00:00.000Z',
  ...over,
})

const resource = (over: Partial<ResourceDescriptor> = {}): ResourceDescriptor => ({
  name: 'articles',
  label: 'Articles',
  kind: 'static',
  model: 'Article',
  primaryKey: 'id',
  fields: [],
  api: { create: true, read: true, update: true, delete: true },
  perPage: 20,
  ...over,
})

/** A collection, which is the same descriptor with its schema in a row (SPEC.md §37). */
const collection = (over: Partial<ResourceDescriptor> = {}): ResourceDescriptor =>
  resource({
    name: 'testimonials',
    label: 'Testimonials',
    kind: 'dynamic',
    model: 'ResourceEntry',
    fields: [
      {
        name: 'quote',
        kind: 'text',
        required: true,
        searchable: true,
        sortable: false,
        filterable: false,
        hidden: false,
        readOnly: false,
      },
    ],
    ...over,
  })

/** Where `Collection` lives, and the collection it is looking at. */
const AT_TESTIMONIALS: Address = { path: '/content/$resource', url: '/content/testimonials' }

const registry = (over: Introspection = {}): Introspection => ({
  resources: [],
  blocks: [],
  models: [],
  commands: [],
  queries: [{ name: 'collections.list', input: {} }],
  routes: [],
  ...over,
})

describe('the page list', () => {
  /**
   * The bug this covers: `filtered` is what tells the two silences apart, and passing a
   * constant in its place compiles, renders and reads fine. An application with no pages
   * at all then greets its first editor with "no page matches that" — a sentence about a
   * search they have not run, on a screen whose only job that day is to start them off.
   */
  it('invites a first page when there are none, rather than blaming a filter', async () => {
    const markup = await draw(<Pages />, { pages: listing([]) })

    expect(words(markup)).toContain('Make your first page')
    expect(words(markup)).not.toContain('No page matches that')
  })

  it('leaves out the search and the filter it would have nothing to run against', async () => {
    // Two controls that can only ever return what is already on screen, crowding out
    // the one sentence worth reading.
    const markup = await draw(<Pages />, { pages: listing([]) })

    expect(markup).not.toContain('type="search"')
    expect(markup).not.toContain('Any status')
  })

  it('offers to make one once, under the sentence that explains it', async () => {
    // The header carries the same button on every other screen. Both at once is two
    // primary actions on an otherwise empty page, and one of them is noise.
    expect(times(await draw(<Pages />, { pages: listing([]) }), 'New page')).toBe(1)
  })

  it('draws the list, the filters and the header button once a page exists', async () => {
    const markup = await draw(<Pages />, { pages: listing([page()]) })

    expect(words(markup)).toContain('About us')
    expect(words(markup)).not.toContain('Make your first page')
    expect(markup).toContain('type="search"')
    expect(times(markup, 'New page')).toBe(1)
  })
})

describe('a collection with nothing in it', () => {
  const opened = (descriptor: ResourceDescriptor, entries: readonly Record<string, unknown>[]) =>
    draw(
      <Collection />,
      { introspection: registry({ resources: [descriptor] }), entries: listing(entries) },
      AT_TESTIMONIALS,
    )

  /**
   * The same two silences the page list has, one screen along. A collection that holds
   * nothing is where somebody lands the moment they finish making one, so it is the
   * screen most likely to be seen empty and the one least able to afford "no entry
   * matches that search".
   */
  it('says what an entry is, rather than answering a search nobody ran', async () => {
    const markup = words(await opened(collection(), []))

    expect(markup).toContain('No testimonial yet')
    expect(markup).toContain('An entry is one testimonial')
    expect(markup).not.toContain('matches that')
  })

  it('offers the shape while it is still free, and only to a collection', async () => {
    // What a stored value *is* freezes as soon as one exists. A resource declared in
    // TypeScript has its fields in a file, and this screen has no business on them.
    expect(words(await opened(collection(), []))).toContain('the cheapest moment to change')
    expect(words(await opened(collection({ kind: 'static' }), []))).not.toContain('cheapest moment')
  })

  it('offers nothing to somebody the resource does not let create', async () => {
    const shut = collection({ api: { create: false, read: true, update: false, delete: false } })

    expect(times(await opened(shut, []), 'Create Testimonial')).toBe(0)
    expect(times(await opened(collection(), []), 'Create Testimonial')).toBe(1)
  })

  it('draws the table and the header button once an entry exists', async () => {
    const markup = await opened(collection(), [{ id: 'e1', quote: 'It reads like a product.' }])

    expect(words(markup)).toContain('It reads like a product.')
    expect(words(markup)).not.toContain('No testimonial yet')
    expect(times(markup, 'Create Testimonial')).toBe(1)
  })
})

describe('the collection list', () => {
  const nothing: CollectionList = { data: [], taken: [] }

  const made: CollectionList = {
    data: [
      {
        id: 'c1',
        name: 'testimonials',
        label: 'Testimonials',
        fields: 3,
        api: { create: true, read: true, update: true, delete: false },
      },
    ],
    taken: ['testimonials', 'articles'],
  }

  /**
   * The bug this covers: `canCreate` is read off the viewer's permissions, and a
   * constant in its place is invisible until somebody who may not create one is invited
   * to. The refusal would be correct and would arrive after the form.
   */
  it('invites somebody who may make one', async () => {
    const markup = await draw(<Collections />, {
      collections: nothing,
      permissions: ['collections.*'],
    })

    expect(words(markup)).toContain('Make your first collection')
    expect(times(markup, 'New collection')).toBe(1)
  })

  it('explains rather than invites when the viewer may only read', async () => {
    const markup = await draw(<Collections />, {
      collections: nothing,
      permissions: ['collections.read'],
    })

    expect(words(markup)).toContain('A collection is a kind of content')
    expect(words(markup)).toContain('a permission this account does not have')
    expect(times(markup, 'New collection')).toBe(0)
  })

  /**
   * The defect this covers: an application whose content is all declared in TypeScript
   * has nothing *made here*, and the screen told it to "make your first collection" over
   * an empty box while seventeen resources stood in the sidebar beside it. The
   * invitation belongs to a fresh install and nowhere else.
   */
  it('does not call a populated application empty', async () => {
    const populated: CollectionList = { data: [], taken: ['articles', 'dishes'] }
    const markup = words(
      await draw(<Collections />, { collections: populated, permissions: ['*'] }),
    )

    expect(markup).not.toContain('Make your first collection')
    expect(markup).toContain('Nothing has been made here yet')
    expect(markup).toContain('Declared in this application’s source')
    expect(markup).toContain('articles')
    expect(markup).toContain('dishes')
  })

  it('moves the button back to the header once there is a list under it', async () => {
    const markup = await draw(<Collections />, { collections: made, permissions: ['*'] })

    expect(words(markup)).not.toContain('Make your first collection')
    expect(times(markup, 'New collection')).toBe(1)
  })

  it('names only the resources it cannot edit, not every name in use', async () => {
    // `taken` is every resource name in the application, its own included. Printing it
    // whole tells somebody their collection is "declared in this application's source".
    const markup = words(await draw(<Collections />, { collections: made, permissions: ['*'] }))
    const declared = markup.slice(markup.indexOf('Declared in this'))

    expect(declared).toContain('articles')
    expect(declared).not.toContain('testimonials')
  })

  /**
   * The order a person controls, rather than the alphabet.
   *
   * `taken` is a sorted set of names — sorted for the job it exists to do, refusing a
   * name where it is typed — and this screen used to read its list off it. So the same
   * fifteen resources stood in two orders: alphabetical here, and the order they were
   * registered in in the sidebar beside it. The registry is the one that carries the
   * order somebody wrote in `module().resources(…)`, so the registry decides.
   */
  it('lists what the application declared in the order the application declared it', async () => {
    const markup = words(
      await draw(<Collections />, {
        collections: { data: [], taken: ['articles', 'dishes', 'orders'] },
        introspection: registry({
          resources: [
            resource({ name: 'orders', label: 'Orders' }),
            resource({ name: 'dishes', label: 'Dishes' }),
            resource({ name: 'articles', label: 'Articles' }),
          ],
        }),
        permissions: ['*'],
      }),
    )

    const declared = markup.slice(markup.indexOf('Declared in this'))

    expect(declared.indexOf('Orders')).toBeLessThan(declared.indexOf('Dishes'))
    expect(declared.indexOf('Dishes')).toBeLessThan(declared.indexOf('Articles'))
  })

  it('keeps a name it cannot describe, and puts it after the ones it can', async () => {
    // A name in `taken` the registry does not describe exists — a new collection may not
    // take it — but this viewer may not read it, so it is listed without a link rather
    // than sorted in among the ones that open.
    const markup = words(
      await draw(<Collections />, {
        collections: { data: [], taken: ['articles', 'secrets'] },
        introspection: registry({ resources: [resource({ name: 'articles', label: 'Articles' })] }),
        permissions: ['*'],
      }),
    )

    const declared = markup.slice(markup.indexOf('Declared in this'))

    expect(declared).toContain('secrets')
    expect(declared.indexOf('Articles')).toBeLessThan(declared.indexOf('secrets'))
  })

  it('says where a declared resource is shown from, so the screen is not a dead end', async () => {
    // The note above it says the fields cannot be rewritten here, which is true and is
    // the important half. This is the half it left out: the label, the heading and the
    // icon are one line in the same declaration.
    const markup = words(await draw(<Collections />, { collections: made, permissions: ['*'] }))

    expect(markup).toContain('label, group, icon')
  })

  it('shows what a collection actually publishes, not four badges by rote', async () => {
    // Equal rights runs both ways: a collection that publishes less has to look like it.
    const markup = words(await draw(<Collections />, { collections: made, permissions: ['*'] }))

    expect(markup).toContain('created')
    expect(markup).toContain('updated')
    expect(markup).not.toContain('deleted')
  })
})

describe('the dashboard', () => {
  /**
   * The bug this covers: `fresh` decides between an invitation and a scoreboard, and a
   * constant in its place shows one of them to the wrong application — "nothing has been
   * made here yet" over a project with fifty articles in it, or `0 Resources · 0 Blocks`
   * as the first screen of the product.
   */
  it('offers the ways to start when nothing has been declared or made', async () => {
    const markup = words(
      await draw(<Dashboard />, { introspection: registry(), permissions: ['*'] }),
    )

    expect(markup).toContain('Nothing has been made here yet')
    expect(markup).toContain('Describe some content')
    expect(markup).toContain('Build a page')
    expect(markup).toContain('Declare a block')
  })

  it('does not count the two things it is asking for', async () => {
    // `0 Resources` under a heading saying what is already wired up is the sentence
    // arguing with itself.
    const markup = words(await draw(<Dashboard />, { introspection: registry() }))

    expect(markup).not.toContain('Resources')
    expect(markup).toContain('Endpoints')
  })

  it('counts instead once the application has something of its own', async () => {
    const markup = words(
      await draw(<Dashboard />, { introspection: registry({ resources: [resource()] }) }),
    )

    expect(markup).toContain('What this application declares')
    expect(markup).not.toContain('Describe some content')
    expect(markup).toContain('Resources')
  })

  /**
   * A step that is a door onto a refusal is worse than no step. The application decides
   * the first half — an application without `collections()` registers no
   * `collections.list` query — and the viewer's permissions the second.
   */
  it('leaves out the collection step when this application has no collections', async () => {
    const markup = words(
      await draw(<Dashboard />, { introspection: registry({ queries: [] }), permissions: ['*'] }),
    )

    expect(markup).not.toContain('Describe some content')
    expect(markup).toContain('Build a page')
  })

  it('leaves it out for a viewer who may not make one', async () => {
    const markup = words(
      await draw(<Dashboard />, { introspection: registry(), permissions: ['pages.*'] }),
    )

    expect(markup).not.toContain('Describe some content')
    expect(markup).toContain('Build a page')
  })
})
