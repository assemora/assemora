/**
 * The HTTP adapter (SPEC.md §40).
 *
 * Fastify lives here and nowhere else. A handler never sees it: what reaches a
 * handler is validated input and the application context, and what leaves is the
 * response the route declared (SPEC.md §41, §125.1).
 */
import {
  type Actor,
  type AssemoraContext,
  AssemoraError,
  type CommandBus,
  ConfigurationError,
  captureError,
  createContext,
  type ErrorReporting,
  type ErrorTrackingPort,
  type Logger,
  logErrors,
  type QueryBus,
  runInContext,
  type SchemaRegistry,
  ValidationError,
} from '@assemora/core'
import cors from '@fastify/cors'
import rateLimit from '@fastify/rate-limit'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import Fastify from 'fastify'

import { type AssetsOptions, findAsset } from './assets.js'
import { isBytesResponse } from './bytes.js'
import { commandEndpoints, commandRoutes } from './commands.js'
import { crudResources, crudRoutes } from './crud.js'
import { registeredRoutes } from './module.js'
import { queryEndpoints, queryRoutes } from './queries.js'
import {
  logRequest,
  type RequestLogOptions,
  type ServedRequest,
  SLOW_REQUEST_MS,
} from './request-log.js'
import { isResponded, serializeCookie } from './respond.js'
import {
  describeRoute,
  type HttpMethod,
  type Route,
  type RouteDescriptor,
  routeName,
} from './route.js'
import { type ApiVersion, type VersionDeclaration, versionRoutes } from './version.js'

export type ActorResolver = (
  headers: Readonly<Record<string, string>>,
) => Promise<Actor | undefined>

export type HttpServerOptions = {
  readonly registry: SchemaRegistry
  readonly commands: CommandBus
  readonly queries: QueryBus
  readonly logger: Logger
  /**
   * The one structured line every request writes: method, route, status, duration
   * (SPEC.md §88).
   *
   * On by default, because §88 lists request timing among the minimum an application
   * ships with, and a line somebody has to switch on is not there on the night it is
   * wanted. `requestLog: false` is the deliberate way to have none.
   *
   * ```ts
   * createHttpServer({ registry, commands, queries, logger, requestLog: { slowMs: 250 } })
   * ```
   */
  readonly requestLog?: RequestLogOptions | false
  /**
   * Where a failure this layer could not attribute to the caller is reported
   * (SPEC.md §88).
   *
   * Defaults to writing the incident to `logger`, exactly as the buses do. A
   * composition root that registers a real reporter should hand the same instance to
   * `createApplication` and to this, so an incident reaches the same place wherever it
   * was thrown.
   *
   * ```ts
   * const errors = sentry()
   *
   * createApplication({ modules, errors })
   * createHttpServer({ registry, commands, queries, logger, errors })
   * ```
   *
   * A failure thrown inside a command and answered over HTTP then passes two layers
   * that both report it, and this layer reports what it saw: the route and the status.
   * Whether the tracker is told twice is the port's to decide, because the port is the
   * only thing that sees both — `assemora()` wires one that drops the repeat.
   */
  readonly errors?: ErrorTrackingPort
  /** Everything is mounted below this. `/api` by default (SPEC.md §43). */
  readonly prefix?: string
  /**
   * Allowed origins. Listed explicitly and never `*`: CORS is configured, not
   * waved through (SPEC.md §85).
   */
  readonly cors?: { readonly origins: readonly string[]; readonly credentials?: boolean }
  readonly rateLimit?: { readonly max: number; readonly windowMs: number }
  /** Turns credentials into an actor. Registered by `@assemora/auth` in phase 6. */
  readonly resolveActor?: ActorResolver
  /**
   * Double-submit CSRF protection for cookie-authenticated mutations (SPEC.md §85).
   *
   * A request that mutates and arrives with cookies but no `Authorization` header is
   * a browser acting on an ambient credential — the one case another site can
   * provoke. It must then repeat the CSRF cookie in a header, which a cross-site
   * caller cannot read and therefore cannot repeat.
   */
  readonly csrf?: { readonly cookie?: string; readonly header?: string }
  /**
   * Headers every response carries (SPEC.md §85).
   *
   * `frameAncestors` is the one an application has to think about: the builder canvas
   * is an iframe, so the page it renders must let Studio's origin frame it — and
   * nothing else (SPEC.md §59). Everything else defaults to the strict answer.
   */
  readonly security?: {
    readonly frameAncestors?: readonly string[]
    /**
     * Origins a stored file may be rendered from, beside this one (SPEC.md §63, §85).
     *
     * S3-compatible storage is mandatory in v1 and its URLs are a bucket or a CDN, so
     * `img-src 'self'` alone is a policy that blocks every image the media library
     * hands out. These entries widen `img-src` and `media-src`, and nothing else: an
     * origin trusted to hold an upload has not thereby been trusted to run a script
     * here.
     */
    readonly mediaSources?: readonly string[]
    /** Replaces the generated policy outright, for an application with its own. */
    readonly contentSecurityPolicy?: string
  }
}

export type InjectedResponse = {
  readonly statusCode: number
  readonly headers: Readonly<Record<string, unknown>>
  readonly body: string
  /** The response before any text decoding. What a `bytes()` answer has to be read as. */
  readonly rawBody: Uint8Array
  json<T = unknown>(): T
}

export type HttpServer = {
  /** Mounts routes and describes them in the Schema Registry. */
  mount(...routes: Route[]): HttpServer
  /** Mounts every route the application's modules registered. */
  mountRegistered(): HttpServer
  /** Mounts generated CRUD for every resource the registry knows (SPEC.md §43). */
  mountResources(): HttpServer
  /**
   * Publishes everything the callback mounts under `/<name>` (SPEC.md §47).
   *
   * ```ts
   * server.version('v1', (api) => {
   *   api.resource(Articles)
   * })
   * ```
   *
   * answers at `/api/v1/articles`. A version may be opened more than once — it is a
   * namespace, not a declaration — and the same resource may be published in several
   * versions, because each one describes itself under its own path.
   *
   * `define` is called once, synchronously, and its return type is constrained rather
   * than `void`: TypeScript accepts any return where `=> void` is wanted, so an
   * `async` callback used to compile and publish nothing at all.
   */
  version<R extends VersionDeclaration>(name: string, define: (api: ApiVersion) => R): HttpServer
  /** Mounts every registered command as an endpoint (SPEC.md §14). */
  mountCommands(): HttpServer
  /** Mounts every registered query as an endpoint (SPEC.md §15). */
  mountQueries(): HttpServer
  /**
   * Serves a directory of files, outside the API prefix.
   *
   * A single-page application is not an endpoint: it lives at the origin's root
   * rather than below `/api`, and a stylesheet has nothing to say in OpenAPI. So
   * these are not described in the Schema Registry, which is the difference between
   * this and every other mount here.
   */
  mountAssets(options: AssetsOptions): HttpServer
  listen(port: number, host?: string): Promise<string>
  close(): Promise<void>
  /** Sends a request without a socket. What the tests use. */
  inject(request: {
    method: string
    url: string
    payload?: unknown
    headers?: Record<string, string>
  }): Promise<InjectedResponse>
  ready(): Promise<void>
}

const cookieValue = (header: string, name: string): string | undefined => {
  for (const part of header.split(';')) {
    const [key, ...rest] = part.trim().split('=')

    if (key === name) return decodeURIComponent(rest.join('='))
  }

  return undefined
}

const headersOf = (request: FastifyRequest): Record<string, string> => {
  const headers: Record<string, string> = {}

  for (const [name, value] of Object.entries(request.headers)) {
    if (typeof value === 'string') headers[name] = value
  }

  return headers
}

/**
 * One header, read the way `headersOf` reads them all: a header that arrived more than
 * once is an array, and this layer takes no value from one.
 */
const headerOf = (request: FastifyRequest, name: string): string | undefined => {
  const value = request.headers[name]

  return typeof value === 'string' ? value : undefined
}

/**
 * What this layer knows about a request that cannot be asked of the handler.
 *
 * Two things, and both are wanted after the handler has gone.
 *
 * The arrival time, because the line and the error report both say how long the
 * request took, and Fastify keeps that time only when something else already asked it
 * to — a logger, an `onResponse` hook, a handler timeout. Borrowing it made two
 * options that read as independent silently coupled: switching off the request *log*
 * left `reply.elapsedTime` at 0, so every *report* said the request took no time at
 * all. Measured here, the duration means the same thing whatever else is switched on.
 *
 * And the context, because `onResponse` fires once the reply has been flushed, and
 * because the requests that never reach a handler at all — a URL nothing matched, one
 * the rate limit refused, a file — never open a context, so their line would carry
 * none of §87's fields and could not be joined to the response the client saw.
 */
type ServedRequestState = {
  readonly startedAt: number
  /** Provisional until the actor is known; `handle` replaces it once it is. */
  readonly context: AssemoraContext
}

/** What the resolver answered, or what it threw trying. */
type Credentials = { readonly actor: Actor | undefined } | { readonly failed: unknown }

/**
 * Turns credentials into an actor without letting a failure escape the request.
 *
 * Resolving is I/O — a session row, a token digest, a database that may be down — so
 * it can throw, and it runs before the request's own context is complete, because that
 * context carries the actor this produces. A rejection here used to leave the route
 * handler entirely and land in Fastify's own error handler, which puts the reason on
 * the wire and reports it to nobody. The failure is carried into the guarded region
 * instead, where every other failure of this request is already answered
 * (SPEC.md §85, §88).
 */
const resolveCredentials = async (
  resolve: ActorResolver | undefined,
  headers: Readonly<Record<string, string>>,
): Promise<Credentials> => {
  try {
    return { actor: await resolve?.(headers) }
  } catch (failed) {
    return { failed }
  }
}

const failureOf = (error: unknown, requestId: string) => {
  if (error instanceof AssemoraError) {
    return { status: error.status, payload: error.toPayload(requestId) }
  }

  // Nothing of an unexpected failure reaches the client: its message could carry
  // anything at all (SPEC.md §85).
  return {
    status: 500,
    payload: {
      error: { code: 'INTERNAL_ERROR', message: 'The request could not be completed', requestId },
    },
  }
}

/**
 * The policy an API sends (SPEC.md §85).
 *
 * An API answers with JSON, so the interesting directives are the ones about who may
 * embed it and what a browser may do with a response it did not expect. `default-src
 * 'none'` is right for JSON and is widened only for what actually renders — the
 * application's own frontend, which the builder canvas frames.
 */
const policyFor = (security: HttpServerOptions['security']): string => {
  if (security?.contentSecurityPolicy !== undefined) return security.contentSecurityPolicy

  const ancestors =
    security?.frameAncestors === undefined || security.frameAncestors.length === 0
      ? "'none'"
      : security.frameAncestors.join(' ')

  // Where the stored files are. Named in the two directives that render them and in
  // no other, so an application that serves its media from a bucket keeps the same
  // policy everywhere else (SPEC.md §63).
  const media = security?.mediaSources ?? []
  const from = media.length === 0 ? '' : ` ${media.join(' ')}`

  return [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    `img-src 'self' data: blob:${from}`,
    // Only when there is something to say: with no entries `default-src 'self'` is
    // already the answer, and repeating it would be a directive that says nothing.
    ...(media.length === 0 ? [] : [`media-src 'self'${from}`]),
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    `frame-ancestors ${ancestors}`,
  ].join('; ')
}

export const createHttpServer = (options: HttpServerOptions): HttpServer => {
  const prefix = options.prefix ?? '/api'
  const app: FastifyInstance = Fastify({ logger: false })

  const reporting: ErrorReporting = {
    errors: options.errors ?? logErrors(options.logger),
    logger: options.logger,
  }

  const slowMs =
    (options.requestLog === false ? undefined : options.requestLog?.slowMs) ?? SLOW_REQUEST_MS

  /**
   * What each request in flight arrived with (see `ServedRequestState`).
   *
   * A `WeakMap` rather than a property on the request, because Fastify's request
   * object is a typed thing this layer does not get to extend — and because a key that
   * is the request itself is freed with it, whatever the request did on its way out.
   */
  const state = new WeakMap<FastifyRequest, ServedRequestState>()

  /**
   * The request's state, established on arrival and read by everything after it.
   *
   * The request id is the caller's when it sent one, so a client that correlates its
   * own calls keeps its thread through this application's logs, and a minted one
   * otherwise: a line nothing can be joined to is half a line (SPEC.md §87).
   */
  const stateOf = (request: FastifyRequest): ServedRequestState => {
    const already = state.get(request)

    if (already !== undefined) return already

    const requestId = headerOf(request, 'x-request-id')
    const userAgent = headerOf(request, 'user-agent')
    const arrived: ServedRequestState = {
      startedAt: performance.now(),
      context: createContext({
        source: 'rest',
        ...(requestId === undefined ? {} : { requestId }),
        ...(userAgent === undefined ? {} : { userAgent }),
      }),
    }

    state.set(request, arrived)

    return arrived
  }

  /** Addresses that answer with files rather than endpoints, so the line can tell. */
  const assetPaths = new Set<string>()

  const securityHeaders: Readonly<Record<string, string>> = {
    'content-security-policy': policyFor(options.security),
    // A response typed as JSON must not be guessed into being a script.
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
    'cross-origin-opener-policy': 'same-origin',
  }

  /**
   * Everything that has to happen before a request is served, in order.
   *
   * Plugins first, then routes — and that order is load-bearing rather than tidy.
   * `@fastify/rate-limit` attaches itself to a route through an `onRoute` hook, so a
   * route defined before the plugin finishes registering is never counted. Mounting
   * straight on to Fastify silently produced an application with no ceiling at all
   * (SPEC.md §85), which is why `mount` appends to this chain instead.
   */
  let ready = (async () => {
    /**
     * The first thing that happens to a request, and before the plugins deliberately.
     *
     * Hooks run in the order they were added, and `@fastify/rate-limit` refuses from an
     * `onRequest` hook of its own. Stamping after it would leave exactly the requests it
     * turned away with no arrival time and no context — and a client being throttled is
     * one of the few times somebody reads these lines one by one (SPEC.md §85, §87).
     */
    app.addHook('onRequest', async (request) => {
      stateOf(request)
    })

    if (options.cors !== undefined) {
      await app.register(cors, {
        origin: [...options.cors.origins],
        credentials: options.cors.credentials ?? false,
      })
    }

    if (options.rateLimit !== undefined) {
      await app.register(rateLimit, {
        max: options.rateLimit.max,
        timeWindow: options.rateLimit.windowMs,
      })
    }

    app.addHook('onSend', async (_request, reply) => {
      for (const [name, value] of Object.entries(securityHeaders)) reply.header(name, value)
    })

    if (options.requestLog === false) return

    /**
     * One line per request, and exactly one (SPEC.md §88).
     *
     * It hangs off the response rather than off the handler because that is the only
     * place that is once per request and knows how it ended: a route that threw, a
     * route that answered, a rate limit that refused before the handler ran, a URL
     * that matched nothing, and a file — all of them arrive here, with the status
     * that was actually sent and the duration measured from the moment the request
     * arrived to the moment its reply was flushed.
     */
    app.addHook('onResponse', async (request, reply) => {
      // Fastify's own name for whatever matched, so the line cannot drift from what is
      // served and is a pattern rather than a URL. `undefined` when nothing matched.
      const path = request.routeOptions.url

      const { startedAt, context } = stateOf(request)

      const served: ServedRequest = {
        method: request.method,
        ...(path === undefined ? {} : { path }),
        status: reply.statusCode,
        durationMs: performance.now() - startedAt,
        ...(path !== undefined && assetPaths.has(path) ? { asset: true } : {}),
      }

      // Stepped back into rather than assumed: this hook fires once the reply has been
      // flushed, and for a request no handler ever saw there was never a scope to be
      // inside of. The line carries §87's fields either way.
      runInContext(context, () => logRequest(options.logger, served, slowMs))
    })
  })()

  const csrfCookie = options.csrf?.cookie ?? 'assemora_csrf'
  const csrfHeader = options.csrf?.header ?? 'x-csrf-token'

  /**
   * Only a cookie-carrying mutation is exposed; a bearer token is never ambient.
   *
   * The exemption asks whether a bearer credential was *presented*, not whether the
   * header is there at all. An actor resolver reads a bearer token and falls through
   * to the session cookie for anything else, so `Authorization: Basic …` beside a
   * session cookie is a request authenticated by the ambient credential — exactly the
   * one another site can provoke. Two predicates that disagree about what
   * "authenticated by a header" means is how such a request gets in with no CSRF
   * token at all (SPEC.md §85).
   */
  const bearerPresented = (authorization: string | undefined): boolean => {
    if (authorization === undefined) return false

    const [scheme, ...rest] = authorization.split(' ')

    return scheme?.toLowerCase() === 'bearer' && rest.join(' ').trim() !== ''
  }

  const csrfFails = (
    method: HttpMethod,
    headers: Readonly<Record<string, string>>,
    actor: Actor | undefined,
  ): boolean => {
    if (options.csrf === undefined) return false
    if (method === 'get') return false

    /**
     * Nobody is signed in, so there is no ambient authority for another site to
     * borrow — and a cookie the server no longer honours is not a credential.
     *
     * Asking about the *cookie header* instead is what locked people out of the login
     * page: a session cookie outlives the session it names, so any browser that had
     * signed in before a restart carried one, had no matching CSRF cookie, and was
     * refused before the password was ever read. The message it got said the
     * credentials were wrong, and they were not.
     *
     * Logging in is the case this distinguishes: it does not *use* the ambient
     * credential, it establishes one. Forcing a victim's browser to sign in as
     * somebody else is a different and much weaker attack than performing their
     * mutations as them, and it is not what a double-submit token is for.
     */
    if (actor === undefined) return false
    if (headers.cookie === undefined || bearerPresented(headers.authorization)) return false

    const sent = headers[csrfHeader]
    const expected = cookieValue(headers.cookie, csrfCookie)

    return sent === undefined || expected === undefined || sent !== expected
  }

  const handle =
    (definition: Route, url: string) => async (request: FastifyRequest, reply: FastifyReply) => {
      const headers = headersOf(request)
      const { startedAt, context: arrived } = stateOf(request)

      /**
       * The context of the request before it is known who is making it.
       *
       * It carries the request id the line and the response already use, and the route's
       * own source. The user agent is read off the request rather than out of a body, so
       * a command that records it records what arrived instead of what the caller asked
       * to be remembered (SPEC.md §85).
       */
      const anonymously = createContext({
        source: definition.source ?? 'rest',
        requestId: arrived.requestId,
        ...(arrived.userAgent === undefined ? {} : { userAgent: arrived.userAgent }),
      })

      // Inside a context, because resolving credentials is database work — a session
      // row, a token digest — and a slow query or a failure there is the "the session
      // lookup is against a database that is down" case. Logged outside the request it
      // came from, it names neither the request nor the client (SPEC.md §87).
      const credentials = await runInContext(anonymously, () =>
        resolveCredentials(options.resolveActor, headers),
      )
      const actor = 'actor' in credentials ? credentials.actor : undefined
      const context = actor === undefined ? anonymously : createContext({ ...anonymously, actor })
      const requestId = context.requestId

      // The line is written after the handler has gone, and by then this is the context
      // the request actually ran in.
      state.set(request, { startedAt, context })

      return runInContext(context, async () => {
        try {
          if (csrfFails(definition.method, headers, actor)) {
            throw new AssemoraError('CSRF_FAILED', 'This request is missing its CSRF token', {
              status: 403,
            })
          }

          // Before the check below and not after it: a resolver that threw did not
          // answer "nobody", and calling that an unauthenticated request would tell
          // the caller to log in about a fault of this deployment's own.
          if ('failed' in credentials) throw credentials.failed

          if (definition.auth && actor === undefined) {
            throw new AssemoraError('UNAUTHORIZED', 'This endpoint requires authentication', {
              status: 401,
            })
          }

          const parse = (schema: (typeof definition)['params'], value: unknown, part: string) => {
            if (schema === undefined) return {}

            const result = schema.parse(value ?? {})

            if (!result.ok) {
              throw new ValidationError(
                result.issues.map((issue) => ({ ...issue, path: [part, ...issue.path] })),
              )
            }

            return result.value
          }

          const returned = await definition.handler({
            params: parse(definition.params, request.params, 'params') as never,
            query: parse(definition.query, request.query, 'query') as never,
            body: parse(definition.body, request.body, 'body') as never,
            headers,
            actor,
            context,
            request,
          })

          const answer = isResponded(returned) ? returned.body : returned
          const status = (isResponded(returned) ? returned.status : undefined) ?? definition.status

          if (isResponded(returned)) {
            reply.headers({ ...returned.headers })

            if (returned.cookies.length > 0) {
              reply.header('set-cookie', returned.cookies.map(serializeCookie))
            }
          }

          if (isBytesResponse(answer)) {
            // Bytes leave as bytes. A response schema would have nothing to say about
            // them, so it is not consulted (SPEC.md §41).
            return await reply
              .status(status)
              .headers({ ...answer.headers })
              .type(answer.contentType)
              .send(Buffer.from(answer.body))
          }

          if (definition.response === undefined) {
            return await reply.status(status).send(answer ?? null)
          }

          const serialized = definition.response.parse(answer)

          if (!serialized.ok) {
            // The handler answered with something the route promised not to return.
            // Better a loud failure than a response nobody documented.
            throw new AssemoraError(
              'RESPONSE_MISMATCH',
              `The handler of ${definition.method} ${definition.path} returned a value its response schema rejects`,
              { status: 500, details: { issues: serialized.issues } },
            )
          }

          return await reply.status(status).send(serialized.value)
        } catch (error) {
          const failure = failureOf(error, requestId)

          // The incident, not the request line: that one is written for every request
          // by the `onResponse` hook, whatever the outcome, and a second line about
          // the same event would only be a second opinion about it.
          //
          // Which failures are incidents is not decided here. A 422, a 403, a 404 and
          // a 409 are all this layer doing its job and telling the caller so, and
          // `captureError` draws that line once for the command pipeline, the Query
          // Bus and this alike (SPEC.md §88).
          await captureError(reporting, error, {
            kind: 'request',
            // The route, never the URL — an incident tracker groups by this, and
            // `GET /api/articles/8f3a…` is a new issue on every request.
            name: `${definition.method.toUpperCase()} ${url}`,
            // Measured here, not read off the reply: Fastify keeps no time for a server
            // whose request log is switched off, and a report is not the place to find
            // that out (SPEC.md §87).
            durationMs: performance.now() - startedAt,
          })

          return await reply.status(failure.status).send(failure.payload)
        }
      })
    }

  /** Every address this server serves, so a second claim on one can name the first. */
  const mounted = new Map<string, Route>()

  /** How a route names itself in a message: by the version it belongs to, if any. */
  const publishedBy = (definition: Route): string =>
    definition.version === undefined ? 'this application' : `version ${definition.version}`

  /**
   * Whether a description already in the registry is *this* route's description.
   *
   * Both sides are built by `describeRoute`, so the comparison is between two values of
   * the same shape and key order. The module name is carried across rather than ignored:
   * describing on a module and mounting on a server is the ordinary case, and only the
   * owner differs between them.
   */
  const describesTheSame = (descriptor: RouteDescriptor, definition: Route): boolean =>
    JSON.stringify(descriptor) === JSON.stringify(describeRoute(definition, descriptor.module))

  /**
   * What the Schema Registry describes but this server does not serve (SPEC.md §98, §121).
   *
   * The document is meant to be current *by construction*: every path in
   * `/api/openapi.json`, every row in the API Explorer and every method in the
   * generated SDK is a route somebody can call. A route described and then not mounted
   * — a module's `.routes()` with no `mountRegistered()`, or one whose only address is
   * now a version's — inverts that, and it does so silently.
   */
  const undocumentedGap = (): readonly string[] =>
    options.registry
      .section('routes')
      .filter((descriptor) => !mounted.has(`${descriptor.method} ${prefix}${descriptor.path}`))
      .map((descriptor) => descriptor.name)

  const verifyEverythingDescribedIsServed = (): void => {
    const missing = undocumentedGap()

    if (missing.length === 0) return

    throw new ConfigurationError(
      `The Schema Registry describes ${missing.length === 1 ? 'a route' : 'routes'} this server does not serve, so /api/openapi.json, the API Explorer and the generated SDK would publish ${missing.length === 1 ? 'an address' : 'addresses'} that answer 404 (SPEC.md §98, §121): ${missing.join(', ')}. A module describes its routes with .routes() the moment the application is created — mount them with server.mountRegistered(), publish them under a version as well with api.mountRegistered(), or take them off the module and declare them where they are served.`,
    )
  }

  /** Everything mounted, and everything described actually mounted. */
  const settled = async (): Promise<void> => {
    await ready
    verifyEverythingDescribedIsServed()
  }

  const server: HttpServer = {
    mount(...routes) {
      for (const definition of routes) {
        // Describing is synchronous, so the registry is complete the moment `mount`
        // returns; only the Fastify side waits for the plugins.
        const url = `${prefix}${definition.path}`
        const address = `${definition.method} ${url}`
        const already = mounted.get(address)

        if (already !== undefined) {
          // Fastify would refuse this at `ready()` with a string naming neither the
          // version nor the call that generated the route, and by then the registry
          // would already be holding whichever description arrived first.
          throw new ConfigurationError(
            `"${definition.method.toUpperCase()} ${url}" is already served by ${publishedBy(already)}, so ${publishedBy(definition)} cannot publish it too. One address is one declaration: leave the generated endpoint out with api.resource(name, { except: [...] }) when a route of your own replaces it, or give the second route a path of its own.`,
          )
        }

        mounted.set(address, definition)

        // A module may already have described this route. Describing is a separate
        // act from mounting, and doing both must not be an error (SPEC.md §42).
        const name = routeName(definition.method, definition.path)
        const described = options.registry.find('routes', name)

        if (described === undefined) {
          options.registry.register('routes', describeRoute(definition))
        } else if (!describesTheSame(described, definition)) {
          // The registry cannot hold two entries under one name and keeps the first, so
          // without this the document would describe one declaration and the server
          // would answer with another — a lie no generated client could see through.
          throw new ConfigurationError(
            `"${name}" is already described in the Schema Registry by a different declaration${described.module === undefined ? '' : `, registered by module "${described.module}"`}. The document would describe that one and this server would answer with this one. Two routes cannot share an address: give one of them a path of its own.`,
          )
        }

        ready = ready.then(() => {
          app.route({
            method: definition.method.toUpperCase() as 'GET',
            url,
            handler: handle(definition, url),
          })
        })
      }

      return server
    },

    mountRegistered() {
      return server.mount(...registeredRoutes())
    },

    mountResources() {
      return server.mount(
        ...crudRoutes(crudResources(options.registry), {
          commands: options.commands,
          queries: options.queries,
        }),
      )
    },

    version(name, define) {
      // Read now rather than held: the registry is complete before a server is built,
      // and taking a snapshot here keeps this the same act `mountResources()` performs.
      return server.mount(
        ...versionRoutes(
          {
            name,
            resources: crudResources(options.registry),
            buses: { commands: options.commands, queries: options.queries },
            registered: registeredRoutes(),
          },
          define,
        ),
      )
    },

    mountCommands() {
      return server.mount(...commandRoutes(commandEndpoints(options.registry), options.commands))
    },

    mountQueries() {
      return server.mount(...queryRoutes(queryEndpoints(options.registry), options.queries))
    },

    mountAssets(assets) {
      const base = assets.path.replace(/\/+$/, '')

      const serve = async (request: FastifyRequest, reply: FastifyReply) => {
        const requested = (request.params as { '*'?: string })['*'] ?? ''
        const found = await findAsset(assets, requested)

        if (found === undefined) {
          return await reply.status(404).send({
            error: { code: 'NOT_FOUND', message: 'No such file' },
          })
        }

        return await reply
          .status(200)
          .header('content-type', found.contentType)
          .header('cache-control', found.cacheControl)
          .header('content-length', found.size)
          .send(found.stream())
      }

      // `/studio` and `/studio/` are the same document, and a browser sends both.
      const entry = base === '' ? '/' : base
      const below = `${base}/*`

      // Named now rather than when a file is served, so the line for a request that
      // never reached `serve` — a refusal, a 404 — still knows it was about a file.
      assetPaths.add(entry).add(below)

      ready = ready.then(() => {
        app.route({ method: 'GET', url: entry, handler: serve })
        app.route({ method: 'GET', url: below, handler: serve })
      })

      return server
    },

    async listen(port, host = '127.0.0.1') {
      await settled()
      return app.listen({ port, host })
    },

    async close() {
      await app.close()
    },

    async inject(request) {
      await settled()

      // Fastify's `inject` is overloaded for callback style, so the awaited shape has
      // to be named here. It is the one place this adapter admits to being Fastify.
      const response = (await app.inject({
        method: request.method,
        url: request.url,
        ...(request.payload === undefined ? {} : { payload: request.payload }),
        ...(request.headers === undefined ? {} : { headers: request.headers }),
      } as never)) as unknown as {
        statusCode: number
        headers: Record<string, unknown>
        body: string
        rawPayload: Uint8Array
        json: <T>() => T
      }

      return {
        statusCode: response.statusCode,
        headers: response.headers,
        body: response.body,
        rawBody: new Uint8Array(response.rawPayload),
        json: <T>() => response.json<T>(),
      }
    },

    async ready() {
      await settled()
      await app.ready()
    },
  }

  return server
}
