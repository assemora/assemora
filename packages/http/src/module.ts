/**
 * The `.routes()` facet of `module()` (SPEC.md §13, ADR-0009).
 *
 * Registering a route describes it in the Schema Registry, which is what OpenAPI,
 * the API Explorer and the SDK are generated from. Mounting it on a server is a
 * separate act, because a route is documentation whether or not anything is
 * listening (SPEC.md §3.7, §98).
 */
import { defineModuleFacet } from '@assemora/core'

import { describeRoute, type Route } from './route.js'

declare module '@assemora/core' {
  interface ModuleBuilder {
    routes(...routes: Route[]): ModuleBuilder
  }
}

const collected = new Map<string, Route[]>()

/** Every route a module registered, for a server to mount. */
export const registeredRoutes = (): readonly Route[] => [...collected.values()].flat()

export const clearRouteRegistry = (): void => {
  collected.clear()
}

let defined = false

export const defineRouteFacet = (): void => {
  if (defined) return

  defineModuleFacet('routes', (internals, args) => {
    internals.addRegistration((context) => {
      const routes = args.filter((candidate): candidate is Route => {
        return (candidate as Route | undefined)?.node === 'route'
      })

      collected.set(internals.name, [...(collected.get(internals.name) ?? []), ...routes])

      for (const definition of routes) {
        context.registry.register('routes', describeRoute(definition, internals.name))
      }
    })
  })

  defined = true
}

defineRouteFacet()
