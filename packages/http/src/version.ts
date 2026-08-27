/**
 * API versioning (SPEC.md §47).
 *
 * A version is a path segment and nothing else. Mounting inside one rewrites the
 * route's path *before* it is described, so `/articles` declared in `v1` is described,
 * documented and generated as `/v1/articles` — and the Schema Registry, OpenAPI, the
 * API Explorer and the SDK need no notion of a version at all: they already compose
 * `prefix + path`, and the path now says which version it belongs to.
 *
 * That is also what lets two versions of one resource coexist: `routeName` becomes
 * `get /v1/articles`, so the registry holds them as two entries rather than refusing
 * the second as a duplicate.
 *
 * A version *adds* addresses; it never takes one away. A route a module declared with
 * `.routes()` was described at its bare path the moment the application was created
 * (SPEC.md §13), and no description can be withdrawn afterwards — so publishing it in
 * a version leaves the bare address documented, and the server has to keep serving it.
 * `HttpServer.ready()` is what proves that, and the way to have a version-only address
 * is to declare the route inside the version instead of on the module.
 */
import { ConfigurationError } from '@assemora/core'

import {
  type CrudBuses,
  type CrudOperation,
  type CrudResource,
  crudRoutes,
  publishedOperations,
} from './crud.js'
import { type Route, routeName } from './route.js'

/**
 * What `api.resource(Articles)` asks of a resource: its name.
 *
 * Structural on purpose. This package may not depend on `@assemora/resources`
 * (SPEC.md §8) and does not need to — a resource has already described itself into the
 * Schema Registry, and its name is the whole address of that description.
 */
export type NamedResource = {
  readonly name: string
}

/**
 * Which of the five generated endpoints a version publishes (SPEC.md §43, §47).
 *
 * The point of a version is usually that *one* endpoint changed. Without this, saying
 * so meant abandoning `api.resource()` and hand-writing all five, because the generated
 * listing had already claimed the path the new one wanted.
 */
export type VersionedResourceOptions = {
  /** Publish only these. */
  readonly only?: readonly CrudOperation[]
  /** Publish everything the resource allows except these — the usual half. */
  readonly except?: readonly CrudOperation[]
}

/**
 * What can be done inside a version, which is what the server does outside one.
 *
 * Deliberately narrow. Commands, queries and assets are absent because none of them is
 * a versioned thing: a command belongs to the application rather than to a shape of its
 * REST surface (SPEC.md §14), and a stylesheet is not an endpoint. So is a nested
 * `version` — `/v2/v1/articles` is not a path anybody means.
 */
export type ApiVersion = {
  /** Mounts routes under this version: `/articles` becomes `/v1/articles`. */
  mount(...routes: Route[]): ApiVersion
  /**
   * Mounts generated CRUD for a resource the registry already describes (SPEC.md §43).
   *
   * ```ts
   * api.resource(Articles, { except: ['list'] }).mount(listArticlesV2)
   * ```
   */
  resource(resource: NamedResource, options?: VersionedResourceOptions): ApiVersion
  /**
   * Also publishes, under this version, every route the modules registered.
   *
   * Beside their bare addresses, not instead of them: `module('blog').routes(search)`
   * describes `/search` when the application is created, and a description cannot be
   * withdrawn. This is "v1 answers everything too", and a route that should live only
   * under a version is declared inside the version with `api.mount()`.
   */
  mountRegistered(): ApiVersion
}

/**
 * What a version's declaration may answer with: nothing, or the chain it built.
 *
 * Not `void`. TypeScript's void-return rule accepts a function returning anything where
 * `=> void` is expected, so an `async` callback compiled cleanly and then published
 * nothing: everything after its first `await` ran once the routes had already been
 * collected. A type parameter constrained to this union is what makes that a compile
 * error instead of an empty API with a green start-up.
 */
// biome-ignore lint/suspicious/noConfusingVoidType: a statement body's return type is `void`, and `undefined` would not accept it — this union is what separates "returned nothing" from "returned a promise"
export type VersionDeclaration = void | ApiVersion

export type ApiVersionOptions = {
  readonly name: string
  /** Every resource the registry describes — what `resource()` looks a name up in. */
  readonly resources: readonly CrudResource[]
  readonly buses: CrudBuses
  /** Every route the modules registered — what `mountRegistered()` publishes. */
  readonly registered?: readonly Route[]
}

/**
 * One path segment, opening with a letter or a digit and carrying no `..`.
 *
 * A version name is not decoration: it lands in a URL, in an OpenAPI `operationId` and
 * in a generated SDK method name. `v1`, `beta` and `2024-01-01` are names; `..`, `v1..`,
 * `v1/beta`, `/v1` and the empty string are refused here rather than escaped into a
 * path nobody wrote. A dot separates, so it may not repeat and may not end the name.
 */
const VERSION = /^[A-Za-z0-9]([A-Za-z0-9_-]|\.(?![.]|$))*$/

/**
 * The same route, published under a version.
 *
 * A copy rather than a mutation, so one route object can be published in several
 * versions — which is the ordinary case for a handler two versions still share.
 */
export const versionedRoute = (definition: Route, version: string): Route => {
  if (definition.version !== undefined) {
    throw new ConfigurationError(
      `${definition.method} ${definition.path} is already published as version ${definition.version}, so it cannot also be published as ${version}`,
    )
  }

  return { ...definition, path: `/${version}${definition.path}`, version }
}

const isThenable = (value: unknown): value is PromiseLike<unknown> =>
  typeof (value as PromiseLike<unknown> | undefined)?.then === 'function'

/** `['list', 'get']` → `list, get`, for a message a developer can act on. */
const list = (values: readonly string[]): string => values.join(', ')

/**
 * Runs a version's declaration and answers with its routes, paths already rewritten.
 *
 * Collecting instead of mounting keeps this pure, and keeps the server's `mount` the
 * one place a route is described and served. A versioned endpoint therefore takes no
 * second code path anywhere — the only difference between it and any other route is
 * the string it calls its path.
 */
export const versionRoutes = <R extends VersionDeclaration>(
  options: ApiVersionOptions,
  define: (api: ApiVersion) => R,
): readonly Route[] => {
  if (!VERSION.test(options.name)) {
    throw new ConfigurationError(
      `"${options.name}" is not an API version: a version is one path segment, opening with a letter or a digit, and never containing ".."`,
    )
  }

  const collected: Route[] = []
  /** Address → what published it, so a collision can name both sides. */
  const claimed = new Map<string, string>()

  /**
   * Declaring is a synchronous act, and it ends when the callback returns.
   *
   * An `api` captured out of the callback and used later — from a timer, from a
   * `.then()` — would push into an array that has already been mounted, and the routes
   * would simply never exist. Closing the version turns that into a message.
   */
  let open = true

  const publish = (definition: Route, origin: string): void => {
    const versioned = versionedRoute(definition, options.name)
    const address = routeName(versioned.method, versioned.path)
    const first = claimed.get(address)

    if (first !== undefined) {
      throw new ConfigurationError(
        `Version ${options.name} publishes "${address}" twice — first from ${first}, then from ${origin}. One address is one declaration: leave the generated endpoint out with api.resource(name, { except: [...] }) when a route of your own replaces it, or give the second route a path of its own.`,
      )
    }

    claimed.set(address, origin)
    collected.push(versioned)
  }

  const requireOpen = (call: string): void => {
    if (open) return

    throw new ConfigurationError(
      `${call} was called after version ${options.name} was declared, so its routes would never be mounted. Everything a version publishes has to be published while its callback runs — synchronously, and without holding on to the "api" it was given.`,
    )
  }

  const api: ApiVersion = {
    mount(...routes) {
      requireOpen('api.mount()')

      for (const definition of routes) publish(definition, 'api.mount()')

      return api
    },

    mountRegistered() {
      requireOpen('api.mountRegistered()')

      for (const definition of options.registered ?? []) {
        publish(definition, 'api.mountRegistered()')
      }

      return api
    },

    resource(wanted, resourceOptions) {
      requireOpen('api.resource()')

      const described = options.resources.find((entry) => entry.name === wanted.name)

      // Naming a resource nothing describes is a mistake at start-up, and a version
      // that quietly published nothing for it would be found by a caller instead.
      if (described === undefined) {
        throw new ConfigurationError(
          `No resource named "${wanted.name}" is registered, so version ${options.name} has nothing to publish for it`,
        )
      }

      if (resourceOptions?.only !== undefined && resourceOptions.except !== undefined) {
        throw new ConfigurationError(
          `api.resource("${wanted.name}") in version ${options.name} was given both "only" and "except". They are two ways to say the same thing; pick one.`,
        )
      }

      const allowed = publishedOperations(described)

      // The four `api` flags a resource declares are the ceiling; `only` and `except`
      // narrow it and never widen it — a version cannot publish an endpoint the
      // resource itself switched off (SPEC.md §43).
      const operations =
        resourceOptions?.only !== undefined
          ? allowed.filter((operation) => resourceOptions.only?.includes(operation) === true)
          : resourceOptions?.except !== undefined
            ? allowed.filter((operation) => resourceOptions.except?.includes(operation) !== true)
            : allowed

      if (operations.length === 0) {
        // The same mistake the "no such resource" guard exists to catch: an accepted
        // call that publishes nothing is found by a caller getting a 404, not here.
        throw new ConfigurationError(
          allowed.length === 0
            ? `Resource "${wanted.name}" publishes no REST endpoints of its own — its api option switches all four off (SPEC.md §43) — so version ${options.name} has nothing to publish for it. Turn one back on, or drop the api.resource("${wanted.name}") call.`
            : `api.resource("${wanted.name}") in version ${options.name} publishes nothing: the resource offers ${list(allowed)}, and this call keeps none of them. Name at least one of ${list(allowed)}.`,
        )
      }

      for (const definition of crudRoutes([described], options.buses, operations)) {
        publish(definition, `api.resource("${wanted.name}")`)
      }

      return api
    },
  }

  const returned = define(api)

  // Closed before the callback's own continuation can run, so an `await` inside it
  // meets a version that is finished rather than an array nobody will read again.
  open = false

  if (isThenable(returned)) {
    // That continuation is still queued and will throw `requireOpen`'s message into a
    // promise nobody awaits. We are already throwing the explanation, so its rejection
    // is ours to swallow rather than the process's to report.
    void Promise.resolve(returned).catch(() => {})

    throw new ConfigurationError(
      `The callback for version ${options.name} is asynchronous. A version is declared synchronously: everything after its first await would run once the routes had already been collected, and would publish nothing at all.`,
    )
  }

  return collected
}
