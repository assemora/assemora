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
import { Login } from '../screens/login.tsx'
import { MediaLibrary } from '../screens/media.tsx'
import { Pages } from '../screens/pages.tsx'
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
     * Which of the seven views is open, in the address.
     *
     * A tab held in component state cannot be linked to, and the Collections screen has
     * a reason to send somebody straight to a resource's fields. Validated rather than
     * trusted: a `?view=` somebody typed by hand falls back to the first tab instead of
     * rendering nothing.
     */
    validateSearch: (search: Record<string, unknown>): { view: DeveloperView } => ({
      view: DEVELOPER_VIEWS.includes(search.view as DeveloperView)
        ? (search.view as DeveloperView)
        : 'api',
    }),
  }),
]

/** The one screen outside the shell — see `shellRoute`. */
const builderRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/pages/$id',
  component: Builder,
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
  routeTree: rootRoute.addChildren([shellRoute.addChildren(routes), builderRoute]),
  ...(basepath === '' ? {} : { basepath }),
})

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}

export { Outlet }
