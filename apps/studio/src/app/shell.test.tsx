/**
 * That the sidebar says when proposals are waiting, and only then (SPEC.md §75).
 *
 * An agent proposes from a session nobody in Studio is watching, so the number beside
 * `Proposals` is how a person learns there is something to decide. The ways to get it
 * wrong are all quiet ones: a badge over nothing, a badge that asks a question the
 * viewer may not ask, and a figure a screen reader announces as a bare number. Rendered
 * the way `screens/settings.test.tsx` renders — the registry, the viewer and the count
 * already in the cache, and a router at the dashboard.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import type { Introspection } from '../api/introspection.ts'
import { SessionProvider, type Viewer } from '../api/session.tsx'
import { LanguageContext, type LanguageState } from '../i18n/translate.tsx'
import { Shell, Waiting } from './shell.tsx'

const ENGLISH: LanguageState = {
  languages: [{ tag: 'en', name: 'English' }],
  language: 'en',
  readings: {},
  choose: () => undefined,
}

const LIST = { name: 'changesets.list', input: {} }

const draw = async ({
  pending,
  permissions = ['changesets.read'],
  queries = [LIST],
}: {
  /** What `changesets.list` answered with; absent means it has not answered. */
  pending?: number
  permissions?: readonly string[]
  queries?: Introspection['queries']
}): Promise<string> => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const viewer: Viewer = { id: 'viewer', email: 'ada@assemora.dev', name: 'Ada', permissions }
  const introspection: Introspection = { queries }

  client.setQueryData(['viewer'], viewer)
  client.setQueryData(['introspection'], introspection)
  if (pending !== undefined) {
    client.setQueryData(['changesets', 'pending', 'total'], { total: pending })
  }

  const root = createRootRoute({ component: Shell })
  const router = createRouter({
    routeTree: root.addChildren([
      createRoute({ getParentRoute: () => root, path: '/', component: () => null }),
    ]),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  })

  await router.load()

  return renderToStaticMarkup(
    <LanguageContext.Provider value={ENGLISH}>
      <QueryClientProvider client={client}>
        <SessionProvider>
          <RouterProvider router={router} />
        </SessionProvider>
      </QueryClientProvider>
    </LanguageContext.Provider>,
  )
}

/** The markup of the sidebar row that leads to the proposals screen. */
const proposalsRow = (markup: string): string => {
  const row = [...markup.matchAll(/<li>(.*?)<\/li>/g)]
    .map((match) => match[1] ?? '')
    .find((inside) => inside.includes('href="/proposals"'))

  if (row === undefined) throw new Error('The sidebar has no row leading to /proposals')

  return row
}

describe('the proposals row in the sidebar', () => {
  it('counts the proposals waiting for a decision', async () => {
    const row = proposalsRow(await draw({ pending: 2 }))

    expect(row).toContain('>2</span>')
    expect(row).toContain('2 waiting for a decision')
  })

  it('draws nothing beside the link when nothing is waiting', async () => {
    // A zero is not news, and a badge that is always there stops being read.
    const row = proposalsRow(await draw({ pending: 0 }))

    expect(row).not.toContain('bg-accent')
    expect(row).not.toContain('waiting')
  })

  it('draws nothing before the count has arrived', async () => {
    expect(proposalsRow(await draw({}))).not.toContain('bg-accent')
  })

  it('does not count for a viewer who may not read proposals', async () => {
    // The count is already in the cache here, so only the permission can hide it.
    const row = proposalsRow(await draw({ pending: 2, permissions: [] }))

    expect(row).not.toContain('waiting')
  })

  it('does not count in an application without change sets', async () => {
    const row = proposalsRow(await draw({ pending: 2, queries: [] }))

    expect(row).not.toContain('waiting')
  })
})

describe('the count itself', () => {
  const draw = (count: number, spoken: LanguageState = ENGLISH): string =>
    renderToStaticMarkup(
      <LanguageContext.Provider value={spoken}>
        <Waiting count={count} />
      </LanguageContext.Provider>,
    )

  it('stops counting past 99 and says the exact number in words', () => {
    // The row is 240px wide; the screen it leads to states the real figure.
    const markup = draw(140)

    expect(markup).toContain('>99+</span>')
    expect(markup).toContain('140 waiting for a decision')
  })

  it('is said in the language on screen, with that language’s plural', () => {
    const ukrainian: LanguageState = {
      languages: [
        { tag: 'en', name: 'English' },
        { tag: 'uk', name: 'Українська' },
      ],
      language: 'uk',
      readings: {
        'nav.proposalsWaiting': {
          one: '{count} чекає на рішення',
          few: '{count} чекають на рішення',
          many: '{count} чекають на рішення',
          other: '{count} чекають на рішення',
        },
      },
      choose: () => undefined,
    }

    expect(draw(1, ukrainian)).toContain('1 чекає на рішення')
    expect(draw(3, ukrainian)).toContain('3 чекають на рішення')
    expect(draw(21, ukrainian)).toContain('21 чекає на рішення')
  })
})
