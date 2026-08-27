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
import { Dashboard } from '../screens/dashboard.tsx'
import { Design } from '../screens/design.tsx'
import { Developer } from '../screens/developer.tsx'
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

  return viewer === undefined ? <Login /> : <Shell />
}

const rootRoute = createRootRoute({ component: Gate })

const routes = [
  createRoute({ getParentRoute: () => rootRoute, path: '/', component: Dashboard }),
  createRoute({
    getParentRoute: () => rootRoute,
    path: '/content/$resource',
    component: Collection,
  }),
  createRoute({
    getParentRoute: () => rootRoute,
    path: '/content/$resource/new',
    component: () => <EntryForm mode="create" />,
  }),
  createRoute({
    getParentRoute: () => rootRoute,
    path: '/content/$resource/$id',
    component: () => <EntryForm mode="edit" />,
  }),
  createRoute({ getParentRoute: () => rootRoute, path: '/pages', component: Pages }),
  createRoute({ getParentRoute: () => rootRoute, path: '/pages/$id', component: Builder }),
  createRoute({ getParentRoute: () => rootRoute, path: '/pages/$id/history', component: History }),
  createRoute({ getParentRoute: () => rootRoute, path: '/media', component: MediaLibrary }),
  createRoute({ getParentRoute: () => rootRoute, path: '/design', component: Design }),
  createRoute({ getParentRoute: () => rootRoute, path: '/proposals', component: ChangeSets }),
  createRoute({ getParentRoute: () => rootRoute, path: '/users', component: Users }),
  createRoute({ getParentRoute: () => rootRoute, path: '/developer', component: Developer }),
]

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
  routeTree: rootRoute.addChildren(routes),
  ...(basepath === '' ? {} : { basepath }),
})

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}

export { Outlet }
