/**
 * The route tree (SPEC.md §58).
 *
 * Collections are one route with a parameter rather than one route each: what
 * exists is decided by the application, not by this file.
 */
import { createRootRoute, createRoute, createRouter, Outlet } from '@tanstack/react-router'

import { useSession } from '../api/session.tsx'
import { Builder } from '../screens/builder.tsx'
import { ChangeSets } from '../screens/changesets.tsx'
import { Collection } from '../screens/collection.tsx'
import { CollectionEditor } from '../screens/collection-editor.tsx'
import { Collections } from '../screens/collections.tsx'
import { Dashboard } from '../screens/dashboard.tsx'
import { Design } from '../screens/design.tsx'
import { DEVELOPER_VIEWS, Developer, type DeveloperView } from '../screens/developer.tsx'
import { EntryForm } from '../screens/entry.tsx'
import { History } from '../screens/history.tsx'
import { LayoutEditor } from '../screens/layout.tsx'
import { Login } from '../screens/login.tsx'
import { MediaLibrary } from '../screens/media.tsx'
import { Pages } from '../screens/pages.tsx'
import { Settings } from '../screens/settings.tsx'
import { Users } from '../screens/users.tsx'
import { Spinner } from '../ui/index.tsx'
import { Shell } from './shell.tsx'

/** Nothing is rendered until it is known who is asking. */
const Gate = () => {
  const { viewer, isLoading } = useSession()

  if (isLoading) {
    return (
      <div className="grid min-h-dvh place-items-center">
        <Spinner />
      </div>
    )
  }

  return viewer === undefined ? <Login /> : <Outlet />
}

const rootRoute = createRootRoute({ component: Gate })

/**
 * The chrome every screen but one is drawn inside.
 *
 * A pathless layout route rather than the root's own component, because the page
 * builder is not a screen in the shell — it is a mode, edge to edge, with a chrome bar
 * of its own (SPEC.md §59; `design_handoff_studio_redesign` §4). Nesting it under the
 * sidebar would leave two bars stacked and a canvas in a column too narrow to judge a
 * page in.
 */
const shellRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: 'shell',
  component: Shell,
})

const routes = [
  createRoute({ getParentRoute: () => shellRoute, path: '/', component: Dashboard }),
  createRoute({
    getParentRoute: () => shellRoute,
    path: '/content/$resource',
    component: Collection,
  }),
  createRoute({
    getParentRoute: () => shellRoute,
    path: '/content/$resource/new',
    component: () => <EntryForm mode="create" />,
  }),
  // Before `$id`, so `form` is a screen and never an entry that happens to be called
  // that: how the resource's entry form is arranged (ADR-0033).
  createRoute({
    getParentRoute: () => shellRoute,
    path: '/content/$resource/form',
    component: LayoutEditor,
  }),
  createRoute({
    getParentRoute: () => shellRoute,
    path: '/content/$resource/$id',
    component: () => <EntryForm mode="edit" />,
  }),
  // Where a collection is made. Deliberately not under `/content`: these screens edit
  // what a resource *is*, and the ones above edit what it holds (SPEC.md §37).
  createRoute({ getParentRoute: () => shellRoute, path: '/collections', component: Collections }),
  createRoute({
    getParentRoute: () => shellRoute,
    path: '/collections/new',
    component: () => <CollectionEditor mode="create" />,
  }),
  createRoute({
    getParentRoute: () => shellRoute,
    path: '/collections/$name',
    component: () => <CollectionEditor mode="edit" />,
  }),
  createRoute({ getParentRoute: () => shellRoute, path: '/pages', component: Pages }),
  createRoute({ getParentRoute: () => shellRoute, path: '/pages/$id/history', component: History }),
  createRoute({ getParentRoute: () => shellRoute, path: '/media', component: MediaLibrary }),
  createRoute({ getParentRoute: () => shellRoute, path: '/design', component: Design }),
  createRoute({ getParentRoute: () => shellRoute, path: '/proposals', component: ChangeSets }),
  createRoute({ getParentRoute: () => shellRoute, path: '/users', component: Users }),
  createRoute({
    getParentRoute: () => shellRoute,
    path: '/developer',
    component: Developer,
    /**
     * Which of the seven views is open, and which row it is about, in the address.
     *
     * A tab held in component state cannot be linked to, and the Collections screen has
     * a reason to send somebody straight to a resource's fields — to *that* resource's,
     * which is what `name` carries: without it the link answered with all of them and
     * left the reader to find the row. Validated rather than trusted: a `?view=`
     * somebody typed by hand falls back to the first tab instead of rendering nothing,
     * and a `?name=` is only ever a filter, so anything at all is safe in it.
     */
    validateSearch: (search: Record<string, unknown>): { view: DeveloperView; name?: string } => ({
      view: DEVELOPER_VIEWS.includes(search.view as DeveloperView)
        ? (search.view as DeveloperView)
        : 'api',
      ...(typeof search.name === 'string' && search.name !== '' ? { name: search.name } : {}),
    }),
  }),
]

/** The first screen outside the shell — see `shellRoute`. */
const builderRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/pages/$id',
  component: Builder,
})

/**
 * The second, and for the same reason: Settings is a mode with a chrome bar of its own
 * and a sidebar of its own (`design_handoff_studio_redesign` §5), and nesting it under
 * the shell would put two sidebars on one screen.
 *
 * Which group is open is in the address, so a group can be linked to. The groups come
 * from the registry, so the address cannot be checked against a list here — what is
 * checked is that it is a name at all, and the screen falls back to its first group for
 * one the registry does not have rather than rendering nothing.
 */
const settingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/settings',
  component: Settings,
  validateSearch: (search: Record<string, unknown>): { group?: string } =>
    typeof search.group === 'string' && /^[a-z][a-z0-9-]*$/.test(search.group)
      ? { group: search.group }
      : {},
})

/**
 * Where Studio is mounted.
 *
 * A generated project serves Studio at `/studio` and its API at `/api` on the same
 * origin, so the session cookie is first-party in production the way it is in
 * development. Vite fills `BASE_URL` in from the `base` it was built with, so the
 * router and the bundle can never disagree about it.
 */
const basepath = import.meta.env.BASE_URL.replace(/\/+$/, '')

export const router = createRouter({
  routeTree: rootRoute.addChildren([shellRoute.addChildren(routes), builderRoute, settingsRoute]),
  ...(basepath === '' ? {} : { basepath }),
})

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}

export { Outlet }
