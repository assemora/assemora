/**
 * That the settings screen draws the registry and nothing of its own (ADR-0031).
 *
 * `settings/search.test.ts` pins the search and core pins the validator. This pins the
 * wiring in between — which is where the mistake that matters would live: every group
 * could reach the screen and the sidebar could still file them wrong, drop the tag a
 * locked block is owed, or open a group nobody asked for. Rendered the way
 * `blank.test.tsx` renders: a viewer, the registry's answer already in the cache, and a
 * router at the screen's own address, so `useSearch` reads the group from the URL the
 * way it does in a browser.
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
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import type {
  Introspection,
  SettingsGroupDescriptor,
  SingletonDescriptor,
} from '../api/introspection.ts'
import { SessionProvider, type Viewer } from '../api/session.tsx'
import { Settings } from './settings.tsx'

const VIEWER: Viewer = {
  id: 'viewer',
  email: 'ada@assemora.dev',
  name: 'Ada',
  permissions: [],
}

/** A singleton the registry described, and the row `singletons.get` answered with. */
type Stored = {
  readonly declared: SingletonDescriptor
  readonly values: Readonly<Record<string, unknown>>
  readonly version: number
}

/** The screen at `/settings`, with the query string the address carries. */
const draw = async (
  settings: readonly SettingsGroupDescriptor[],
  search = '',
  singletons: readonly Stored[] = [],
): Promise<string> => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const introspection: Introspection = {
    settings,
    singletons: singletons.map((one) => one.declared),
  }

  client.setQueryData(['viewer'], VIEWER)
  client.setQueryData(['introspection'], introspection)
  for (const one of singletons) {
    client.setQueryData(['singleton', one.declared.name], {
      name: one.declared.name,
      values: one.values,
      version: one.version,
      updatedAt: null,
    })
  }

  const root = createRootRoute({ component: Outlet })
  const router = createRouter({
    routeTree: root.addChildren([
      createRoute({
        getParentRoute: () => root,
        path: '/settings',
        component: Settings,
        // The same guard `app/router.tsx` writes: a name, or nothing.
        validateSearch: (raw: Record<string, unknown>): { group?: string } =>
          typeof raw.group === 'string' ? { group: raw.group } : {},
      }),
      createRoute({ getParentRoute: () => root, path: '/', component: () => null }),
    ]),
    history: createMemoryHistory({ initialEntries: [`/settings${search}`] }),
  })

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

/** The sidebar's rows, in order, as `<li>` markup — what the nav says and in what order. */
const sidebar = (markup: string): string[] =>
  [...markup.matchAll(/<li>(.*?)<\/li>/g)].map((match) => words(match[1] ?? ''))

const group = (over: Partial<SettingsGroupDescriptor> = {}): SettingsGroupDescriptor => ({
  name: 'general',
  section: 'workspace',
  label: 'General',
  blurb: 'What this application is called.',
  icon: 'settings-2',
  blocks: [
    {
      title: 'Identity',
      locked: true,
      note: 'Declared in assemora.config.ts.',
      rows: [{ key: 'project.name', kind: 'value', label: 'Name', value: 'Papa Cotta' }],
    },
  ],
  ...over,
})

const MEDIA = group({
  name: 'media',
  section: 'content',
  label: 'Media',
  icon: 'image',
  badge: '2',
  blocks: [
    {
      title: 'Uploads',
      rows: [{ key: 'media.max-upload', kind: 'value', label: 'Largest file', value: '16 MB' }],
    },
  ],
})

const API = group({
  name: 'api',
  section: 'platform',
  label: 'API',
  icon: 'plug',
  blocks: [
    {
      title: 'Documentation',
      rows: [
        {
          key: 'api.openapi',
          kind: 'link',
          label: 'OpenAPI document',
          href: '/api/openapi.json',
          action: 'Open',
        },
      ],
    },
  ],
})

describe('the settings screen', () => {
  it('files every group the registry sent under its section, and Studio’s own last in Workspace', async () => {
    const markup = await draw([API, MEDIA, group()])

    // Section order is the prototype's, not the order the registry answered in; within a
    // section the registry's order stands, and Studio's group closes Workspace.
    expect(sidebar(markup)).toEqual(['General', 'Studio', 'Media 2', 'API'])
    expect(words(markup)).toMatch(/Workspace .* Content .* Platform/)
  })

  it('opens the first group when the address names none, and the named one when it does', async () => {
    const first = await draw([API, MEDIA, group()])
    const asked = await draw([API, MEDIA, group()], '?group=media')

    expect(first).toContain('aria-current="true"')
    expect(words(first)).toContain('Name Papa Cotta')
    expect(words(asked)).toContain('Largest file 16 MB')
    expect(words(asked)).not.toContain('Papa Cotta')
  })

  it('falls back to the first group for an address the registry does not have, rather than drawing nothing', async () => {
    const markup = await draw([group()], '?group=billing')

    expect(words(markup)).toContain('Name Papa Cotta')
  })

  it('draws the locked tag on a locked block and on no other', async () => {
    const markup = await draw([group()])
    const media = await draw([MEDIA], '?group=media')

    expect(words(markup)).toContain('Identity locked')
    expect(words(media)).toContain('Uploads')
    expect(words(media)).not.toContain('locked')
  })

  it('draws a link row as its action and a value row as its value, in the words that arrived', async () => {
    const markup = await draw([API], '?group=api')

    expect(words(markup)).toContain('OpenAPI document')
    expect(words(markup)).toContain('Open')
  })

  it('does not draw a group filed under a section the sidebar does not have', async () => {
    const stray = group({
      name: 'billing',
      label: 'Billing',
      section: 'money' as SettingsGroupDescriptor['section'],
    })
    const markup = await draw([group(), stray])

    expect(sidebar(markup)).toEqual(['General', 'Studio'])
  })

  it('reads a word the application wrote in several languages in the one on screen', async () => {
    // Studio is read in English here (no browser to prefer another), so the English
    // reading is picked; a word with no English falls to the first the application wrote.
    const bilingual = group({
      label: { uk: 'Загальні', en: 'General' },
      blocks: [
        {
          title: { en: 'Identity', uk: 'Ідентичність' },
          rows: [
            {
              key: 'project.name',
              kind: 'value',
              label: { uk: 'Назва', ru: 'Название' },
              value: 'Papa Cotta',
            },
          ],
        },
      ],
    })
    const markup = await draw([bilingual])

    expect(sidebar(markup)).toEqual(['General', 'Studio'])
    expect(words(markup)).toContain('Identity')
    expect(words(markup)).toContain('Назва Papa Cotta')
    expect(words(markup)).not.toContain('Ідентичність')
  })

  it('draws a singleton as a group under Content whose rows are its fields, filled from its row', async () => {
    const site: Stored = {
      declared: {
        name: 'site',
        label: 'Site settings',
        description: 'What the site calls itself.',
        icon: 'building',
        fields: [
          {
            name: 'title',
            kind: 'text',
            required: true,
            searchable: false,
            sortable: false,
            filterable: false,
            hidden: false,
            readOnly: false,
            label: 'Title',
            help: 'Shown in the tab.',
          },
          {
            name: 'notes',
            kind: 'text',
            required: false,
            searchable: false,
            sortable: false,
            filterable: false,
            hidden: true,
            readOnly: false,
          },
        ],
      },
      values: { title: 'Papa Cotta' },
      version: 3,
    }
    const markup = await draw([group()], '?group=site', [site])

    expect(sidebar(markup)).toEqual(['General', 'Studio', 'Site settings'])
    expect(words(markup)).toContain('Site settings What the site calls itself. Content')
    expect(words(markup)).toContain('Title Shown in the tab.')
    expect(markup).toContain('value="Papa Cotta"')
    expect(words(markup)).not.toContain('Notes')
  })

  it('draws Studio’s own language group even when the registry sent nothing', async () => {
    const markup = await draw([])

    expect(sidebar(markup)).toEqual(['Studio'])
    expect(words(markup)).toContain('English')
  })
})
