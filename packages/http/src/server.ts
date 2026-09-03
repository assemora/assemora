/**
 * The HTTP adapter (SPEC.md §40).
 *
 * Fastify lives here and nowhere else. A handler never sees it: what reaches a
 * handler is validated input and the application context, and what leaves is the
 * response the route declared (SPEC.md §41, §125.1).
 */

import type { IncomingMessage } from 'node:http'
import { pipeline } from 'node:stream/promises'
import { createBrotliCompress, createGzip } from 'node:zlib'
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
  isIncident,
  type LocaleSettings,
  type Logger,
  logErrors,
  publishGeneratedCrud,
  type QueryBus,
  runInContext,
  type SchemaRegistry,
  ValidationError,
} from '@assemora/core'
import cors from '@fastify/cors'
import rateLimit from '@fastify/rate-limit'

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import Fastify from 'fastify'

import { type AssetsOptions, findAsset, type ServedAsset } from './assets.js'
import { isBytesResponse } from './bytes.js'
import { type CommandRouteOptions, commandEndpoints, commandRoutes } from './commands.js'
import {
  type CrudBuses,
  type CrudLookup,
  type CrudResource,
  crudDispatchRoutes,
  crudResources,
  crudRoutes,
  publishedOperations,
  RESOURCE_PARAM,
} from './crud.js'
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
  /**
   * The largest request body this server accepts, in bytes. 1 MiB by default
   * (SPEC.md §85).
   *
   * A route may raise or lower its own, and one that takes an upload has to: a file
   * reaches `media.upload` as base64, which is four bytes on the wire for every three
   * stored, so a 1 MiB ceiling refuses a 786 KB photograph — and a phone takes photographs
   * several times that. Widening the server instead would hand the same ceiling to every
   * address that only ever receives a form.
   */
  readonly bodyLimit?: number
  /**
   * The languages this deployment serves, and which one a request is in by default
   * (SPEC.md §131).
   *
   * A language is a path segment in front of the prefix — `/api/ru/articles` is
   * `/api/articles` read in Russian — and it is *stripped before routing*, so every
   * route is declared once, at one address, and the Schema Registry, OpenAPI and the
   * SDK describe one path rather than one per language. Three languages would otherwise
   * treble every endpoint in a document whose whole purpose is to be read.
   *
   * A segment that is not a configured language is not a language: `/api/v1/articles`
   * keeps meaning what it meant, because `v1` is not in the list.
   */
  readonly locales?: LocaleSettings
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
  /**
   * Mounts generated CRUD for every resource the registry knows (SPEC.md §43).
   *
   * Called again once more resources have been registered, it mounts what it has not
   * mounted before and leaves the rest alone — which is what a collection read out of
   * the database during boot needs, since the registry gains it after the server was
   * built (SPEC.md §37).
   *
   * A resource registered later still than that — a collection made in Studio while
   * this process serves — cannot have an endpoint of its own, because Fastify takes no
   * route once it is listening. The first call therefore also mounts one parameterised
   * pair of endpoints that dispatches by name, and keeps the Schema Registry's
   * description of every resource's REST paths in step with the resources themselves.
   */
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
  /**
   * Mounts every registered command as an endpoint (SPEC.md §14).
   *
   * `bodyLimit` names the commands whose endpoint needs a ceiling of its own — an
   * upload is the case, because its file arrives as base64 inside the input.
   */
  mountCommands(options?: CommandRouteOptions): HttpServer
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
  /**
   * Answers one path with a redirect to another.
   *
   * Not an endpoint, and deliberately not described in the Schema Registry — the same
   * bargain `mountAssets` makes. `GET /` is a signpost for a person who typed the
   * origin into a browser, not an address a client calls, and describing it would put
   * a redirect into OpenAPI, into the API Explorer and into the generated SDK where a
   * method should be. `settled()` checks that everything *described* is served, never
   * the other way round, so a route with no description cannot break that invariant.
   */
  mountRedirect(from: string, to: string): HttpServer
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

/**
 * Which encoding to answer a static file in, or none.
 *
 * Brotli first where both are offered: it is smaller on text by a useful margin and
 * every browser that speaks it also speaks gzip, so the preference costs nothing.
 * A file that is already compressed — a font, a photograph — is sent as it is,
 * because compressing it spends processor time to make it slightly larger.
 *
 * The quality values a client may attach are read only far enough to honour a
 * refusal: `gzip;q=0` means "not gzip", and answering with it anyway is the one
 * reading of this header that breaks a client rather than merely disappointing it.
 */
const chosenEncoding = (
  accepted: string | undefined,
  asset: ServedAsset,
): 'br' | 'gzip' | undefined => {
  if (!asset.compressible || accepted === undefined) return undefined

  const offered = new Map<string, number>()

  for (const part of accepted.split(',')) {
    const [name, ...parameters] = part.trim().split(';')

    if (name === undefined || name === '') continue

    const quality = parameters
      .map((parameter) => /^\s*q=([0-9.]+)\s*$/.exec(parameter))
      .find((match) => match !== null)

    offered.set(
      name.toLowerCase(),
      quality === null || quality === undefined ? 1 : Number(quality[1]),
    )
  }

  const wanted = (name: string): boolean => (offered.get(name) ?? offered.get('*') ?? 0) > 0

  if (wanted('br')) return 'br'
  if (wanted('gzip')) return 'gzip'

  return undefined
}

/**
 * The validator for the representation actually being sent.
 *
 * The encoding is part of it, in the spelling Apache has used for twenty years. Two
 * responses carrying one `ETag` are supposed to be byte-identical, and the gzipped
 * file and the file are not — a proxy holding both under one tag will eventually
 * hand the wrong one to somebody.
 */
const taggedFor = (asset: ServedAsset, encoding: string | undefined): string =>
  encoding === undefined ? asset.etag : `${asset.etag.slice(0, -1)}-${encoding}"`

/** Whether the client already holds this exact representation. */
const isUnchanged = (request: FastifyRequest, etag: string, modifiedAt: Date): boolean => {
  const noneMatch = headerOf(request, 'if-none-match')

  // Checked first and alone: a validator is stronger than a date, so a client that
  // sent both is answered on the tag and the date is not consulted at all.
  if (noneMatch !== undefined) {
    return noneMatch
      .split(',')
      .map((candidate) => candidate.trim())
      .some((candidate) => candidate === '*' || candidate === etag || candidate === `W/${etag}`)
  }

  const since = headerOf(request, 'if-modified-since')

  if (since === undefined) return false

  const asked = Date.parse(since)

  if (Number.isNaN(asked)) return false

  // An HTTP date has one-second resolution and a filesystem has more, so the file's
  // time is rounded down to compare. Without that, a file written at 12:00:00.500 is
  // newer than the 12:00:00 the client was told, forever.
  return Math.floor(modifiedAt.getTime() / 1000) * 1000 <= asked
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

/**
 * 1 MiB, which is Fastify's own default, stated here rather than inherited.
 *
 * Stated because it is a ceiling somebody has to raise deliberately: a body limit is
 * read off the framework the day an upload is refused, and a number that lives in a
 * dependency's defaults is one nothing in this repository can be pointed at.
 */
export const DEFAULT_BODY_LIMIT = 1024 * 1024

export const createHttpServer = (options: HttpServerOptions): HttpServer => {
  const prefix = options.prefix ?? '/api'
  const bodyLimit = options.bodyLimit ?? DEFAULT_BODY_LIMIT
  /**
   * The language a request arrived in, by the URL it arrived at.
   *
   * A `WeakMap` keyed by the raw request, because this is decided in `rewriteUrl` — the
   * one hook that runs *before* routing, which is what it has to do: a language read
   * after routing could only ever be a header, and the whole point is that a page in
   * Russian has an address of its own. Freed with the request, like the state below.
   */
  const spoken = new WeakMap<object, string>()

  const app: FastifyInstance = Fastify({
    logger: false,
    bodyLimit,
    ...(options.locales === undefined
      ? {}
      : {
          /**
           * Takes `/api/ru/articles` down to `/api/articles` and remembers the `ru`.
           *
           * Before routing, so nothing below this line has to know a language exists:
           * one route, one description, one generated client. A first segment that is
           * not a configured language is left alone — `/api/v1/articles` is a version
           * and always was.
           */
          rewriteUrl: (request: IncomingMessage) => {
            const url = request.url ?? '/'

            if (!url.startsWith(`${prefix}/`)) return url

            const rest = url.slice(prefix.length)
            const [, first = ''] = rest.split('/', 2)
            const code = first.split('?')[0] ?? ''

            if (!options.locales?.locales.includes(code)) return url

            spoken.set(request, code)

            const without = rest.slice(code.length + 1)

            return `${prefix}${without === '' ? '/' : without}`
          },
        }),
  })

  // This server publishes no generated REST paths until it is told to mount them, and
  // saying so is the point: an application built with `api: { crud: false }` never calls
  // `mountResources()`, and `collections.create` has to be able to tell that application
  // apart from one that serves five addresses per collection (SPEC.md §43).
  publishGeneratedCrud()

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
   * The requests whose failure was the endpoint answering rather than anything going
   * wrong, so `onResponse` writes the line at the rung a refusal takes.
   *
   * A set beside the state map rather than a field in it, because the state is
   * established on arrival and this is only known once a handler has thrown — and
   * because a request that never fails should not carry a `false`. Keyed by the
   * request, so it is freed with it like everything else here.
   */
  const answeredWithFailure = new WeakSet<FastifyRequest>()

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
        // The language the address named, or the deployment's own. A request that named
        // none is in the default language rather than in no language: a read that fell
        // through to "every translation" because a segment was missing would answer one
        // page three times.
        ...(options.locales === undefined
          ? {}
          : {
              locale: spoken.get(request.raw) ?? options.locales.defaultLocale,
              locales: options.locales,
            }),
      }),
    }

    state.set(request, arrived)

    return arrived
  }

  /** Addresses that answer with files rather than endpoints, so the line can tell. */
  const assetPaths = new Set<string>()

  /** Addresses that answer with a redirect, so a second claim on one is refused here. */
  const redirectPaths = new Set<string>()

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
      const matched = request.routeOptions.url
      const path = matched === undefined ? undefined : servedPath(request, matched)

      const { startedAt, context } = stateOf(request)

      const served: ServedRequest = {
        method: request.method,
        ...(path === undefined ? {} : { path }),
        status: reply.statusCode,
        durationMs: performance.now() - startedAt,
        // Against what matched rather than against the reported path: an asset route is
        // never one of the dispatching pair, so the two are the same string here, and
        // asking the same question of both is how they come to disagree.
        ...(matched !== undefined && assetPaths.has(matched) ? { asset: true } : {}),
        ...(answeredWithFailure.has(request) ? { expected: true } : {}),
      }

      // Stepped back into rather than assumed: this hook fires once the reply has been
      // flushed, and for a request no handler ever saw there was never a scope to be
      // inside of. The line carries §87's fields either way.
      runInContext(context, () => logRequest(options.logger, served, slowMs))
    })
  })()

  /**
   * A body refused before any handler saw it (SPEC.md §46, §85).
   *
   * A route's own `catch` answers everything thrown inside it, and this is thrown
   * outside: the parser enforces the limit, so no handler ever runs. Left untranslated,
   * the one refusal whose fix is a number in the application's own configuration is
   * also the only one that arrives in a shape no generated client reads — and it would
   * say `Request body is too large` without saying what the limit was.
   */
  app.setErrorHandler((error, request, reply) => {
    // Everything else keeps the answer it already had: this handler exists for the
    // failures that happen before a route's own, not to become a second one.
    if ((error as { code?: string }).code !== 'FST_ERR_CTP_BODY_TOO_LARGE') {
      return reply.send(error)
    }

    const accepted = request.routeOptions.bodyLimit ?? bodyLimit
    const failure = failureOf(
      new AssemoraError(
        'PAYLOAD_TOO_LARGE',
        `This request is larger than the ${accepted} bytes this endpoint accepts. A file travels as base64, which is a third larger than the file itself, so size the limit against what arrives: raise bodyLimit on the route that takes the upload, or on the server for all of them.`,
        { status: 413 },
      ),
      stateOf(request).context.requestId,
    )

    return reply.status(failure.status).send(failure.payload)
  })

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
        ...(arrived.locale === undefined ? {} : { locale: arrived.locale }),
        ...(arrived.locales === undefined ? {} : { locales: arrived.locales }),
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

          // Asked of the error model rather than decided again here: `captureError`
          // below and the access log written by `onResponse` are the two readers of one
          // question, and the second used to answer it on its own from the status.
          if (!isIncident(error)) answeredWithFailure.add(request)

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
            // `GET /api/articles/8f3a…` is a new issue on every request. The dispatching
            // pair is named by the resource it dispatched to, for the reason `servedPath`
            // gives: one collection must not be two issues either.
            name: `${definition.method.toUpperCase()} ${servedPath(request, url)}`,
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

  const buses: CrudBuses = { commands: options.commands, queries: options.queries }

  /** Resources this server has given endpoints of their own. */
  const resourceEndpoints = new Set<string>()

  /** Whether the parameterised CRUD pair is mounted, and therefore whether it answers. */
  let dispatching = false

  /** The addresses that pair answers on, so the line can say which resource it was. */
  const dispatchPaths = new Set<string>()

  /**
   * Every resource the registry currently describes, by name.
   *
   * Kept by the reconciliation below rather than read per request: a generated endpoint
   * asks this on every call, and `registry.describe()` copies every section into fresh
   * arrays. One `Map` lookup is what a resource that has changed since the route was
   * generated costs (see `CrudRouteOptions.current`).
   */
  let liveResources: ReadonlyMap<string, CrudResource> = new Map()

  const currentResource: CrudLookup = (name) => liveResources.get(name)

  /**
   * The path a request is reported under (SPEC.md §87, §88).
   *
   * Fastify's own name for whatever matched, except for the pair that dispatches by
   * name: there, the address the caller asked for is the resource's own, and the route
   * pattern says only that it was a resource. Left as the pattern, one collection
   * reported under `/api/:resource` while this process ran and under `/api/notes` after
   * the next restart — so per-endpoint latency depended on whether anybody had deployed
   * since the collection was made, which is the one thing a latency signal must not
   * depend on.
   *
   * Only for a name the registry actually describes. A path is a log key and an incident
   * group, and substituting whatever arrived would let a scanner walking `/api/<word>`
   * mint an unbounded number of both. Those keep the pattern, which is where the refusals
   * belong anyway.
   */
  const servedPath = (request: FastifyRequest, url: string): string => {
    if (!dispatchPaths.has(url)) return url

    const named = (request.params as { [RESOURCE_PARAM]?: unknown })[RESOURCE_PARAM]

    return typeof named === 'string' && liveResources.has(named)
      ? url.replace(`/:${RESOURCE_PARAM}`, `/${named}`)
      : url
  }

  /** What one resource's addresses were at the last reconciliation, and what described them. */
  type DescribedResource = { readonly addresses: string; readonly routes: readonly string[] }

  /** That, for every resource the last reconciliation described anything for. */
  let describedForResources: ReadonlyMap<string, DescribedResource> = new Map()

  /** What that reconciliation was computed from, so an unchanged registry costs a compare. */
  let reconciledFrom: string | undefined

  /**
   * Everything about one resource that decides which addresses exist: its name and the
   * endpoints its own `api` flags publish. A field added to a collection changes neither,
   * and correctly costs nothing here.
   */
  const addressShapeOf = (resource: CrudResource): string =>
    `${resource.name}${publishedOperations(resource).join('')}`

  const shapeOf = (resources: readonly CrudResource[]): string =>
    resources.map(addressShapeOf).join(' ')

  /** Every generated endpoint of every resource the registry currently describes. */
  const generatedForResources = (): Map<string, Route> =>
    new Map(
      crudRoutes(crudResources(options.registry), buses).map((definition) => [
        routeName(definition.method, definition.path),
        definition,
      ]),
    )

  /**
   * Brings the routes section level with the resources section (SPEC.md §37, §42).
   *
   * A resource's REST paths are generated from the resource, so the description of those
   * paths is not an independent declaration — it is a consequence, and it has to arrive
   * and leave with the resource it belongs to. Until collections existed nothing could
   * change after start-up and describing at mount time was the same thing; a collection
   * made while the process runs is registered by a command, and the document that says
   * what this application serves has to say so without waiting for a restart.
   *
   * When the registry changes, because that is when the answer changes. It used to run
   * from an `onRequest` hook, which was a full `describe()` on every request — including
   * every `/api/health` and every 404 — to find out that nothing had happened, and which
   * left the description a request stale for anybody who read the registry without
   * sending one: `assemora routes`, a generated SDK written straight after
   * `collections.create`, the API Explorer's own snapshot.
   *
   * Only when the parameterised pair is mounted. Without it a path described here would
   * be a path nothing answers on — the exact lie `verifyEverythingDescribedIsServed`
   * exists to prevent.
   */
  const reconcileResourceRoutes = (): void => {
    if (!dispatching) return

    const resources = crudResources(options.registry)

    // Rebuilt whatever the shape says, because a resource can change without changing
    // which addresses exist — a relabelled collection is the same five endpoints — and
    // an endpoint that answers out of a stale description is the drift this exists to
    // prevent. It is one map over the array that was allocated a line above.
    liveResources = new Map(resources.map((resource) => [resource.name, resource]))

    const shape = shapeOf(resources)

    if (shape === reconciledFrom) return

    reconciledFrom = shape

    const described = new Map(describedForResources)

    for (const resource of resources) {
      const addresses = addressShapeOf(resource)
      const before = described.get(resource.name)

      /**
       * Every resource is compared; only the one that moved is generated.
       *
       * This runs once per registration now rather than once per request, and
       * regenerating every endpoint of every resource each time is quadratic in the
       * number of them: measured, a thousand stored collections loaded at boot spent 1.5
       * seconds building five million routes — schemas and all — to describe five at a
       * time. Skipping one costs the string above.
       */
      if (before?.addresses === addresses) continue

      const generated = crudRoutes([resource], buses).map((definition) => ({
        name: routeName(definition.method, definition.path),
        definition,
      }))
      const wanted = new Set(generated.map((route) => route.name))

      for (const { name, definition } of generated) {
        if (options.registry.find('routes', name) === undefined) {
          options.registry.register('routes', describeRoute(definition))
        }
      }

      // An operation a collection stopped publishing leaves the document at the moment
      // it leaves service (SPEC.md §43).
      for (const name of before?.routes ?? []) {
        if (!wanted.has(name)) options.registry.withdraw('routes', name)
      }

      described.set(resource.name, { addresses, routes: [...wanted] })
    }

    // Deleting a collection takes its paths out of the document as well. Only what this
    // reconciliation put there, or mounted for a resource, is ever withdrawn: a route a
    // module declared is that module's to describe and to take back.
    for (const [name, before] of describedForResources) {
      if (liveResources.has(name)) continue

      for (const route of before.routes) options.registry.withdraw('routes', route)

      described.delete(name)
    }

    describedForResources = described
  }

  /**
   * The resources section is what the routes above are derived from, so it is the one
   * this listens to.
   *
   * Not `routes`: this reconciliation *writes* that section, and a listener that reacts
   * to its own writes is a loop. Nothing else it reads can change.
   *
   * A resource can arrive at any moment a command can run — `collections.create`
   * registers one from inside a handler, once the row is durable (SPEC.md §37) — and
   * that is a moment this layer has no other way to notice.
   */
  const stopWatching = options.registry.onChange((change) => {
    if (change.section === 'resources') reconcileResourceRoutes()
  })

  /**
   * What the Schema Registry describes but this server does not serve (SPEC.md §98, §121).
   *
   * The document is meant to be current *by construction*: every path in
   * `/api/openapi.json`, every row in the API Explorer and every method in the
   * generated SDK is a route somebody can call. A route described and then not mounted
   * — a module's `.routes()` with no `mountRegistered()`, or one whose only address is
   * now a version's — inverts that, and it does so silently.
   *
   * One route may stand for many descriptions. The parameterised CRUD pair answers at
   * every resource's own paths, so a resource described and not separately mounted is
   * served — but only if the description is exactly the one those endpoints would
   * generate. A hand-written route that happens to share the address is not covered,
   * because what would answer there is the generated listing rather than its handler.
   */
  const undocumentedGap = (): readonly string[] => {
    const generated = dispatching ? generatedForResources() : undefined

    return options.registry
      .section('routes')
      .filter((descriptor) => {
        if (mounted.has(`${descriptor.method} ${prefix}${descriptor.path}`)) return false

        const stands = generated?.get(descriptor.name)

        return stands === undefined || !describesTheSame(descriptor, stands)
      })
      .map((descriptor) => descriptor.name)
  }

  const verifyEverythingDescribedIsServed = (): void => {
    const missing = undocumentedGap()

    if (missing.length === 0) return

    throw new ConfigurationError(
      `The Schema Registry describes ${missing.length === 1 ? 'a route' : 'routes'} this server does not serve, so /api/openapi.json, the API Explorer and the generated SDK would publish ${missing.length === 1 ? 'an address' : 'addresses'} that answer 404 (SPEC.md §98, §121): ${missing.join(', ')}. A module describes its routes with .routes() the moment the application is created — mount them with server.mountRegistered(), publish them under a version as well with api.mountRegistered(), or take them off the module and declare them where they are served.`,
    )
  }

  /**
   * Everything mounted, and everything described actually mounted.
   *
   * It reconciles once more before it checks, even though the registry announces its own
   * changes: `mountResources()` may not be the last mount, and the check has to be made
   * against the descriptions this server would answer for *now*.
   */
  const settled = async (): Promise<void> => {
    await ready
    reconcileResourceRoutes()
    verifyEverythingDescribedIsServed()
  }

  /**
   * Serves one route, and — unless it is the mechanism rather than the endpoint —
   * describes it.
   *
   * `describe: false` is for a route that answers on behalf of addresses described
   * elsewhere. There is one: the parameterised CRUD pair. `/api/{resource}` is not an
   * address any caller means, and documenting it would put one endpoint that says
   * nothing in OpenAPI, the API Explorer and the SDK in place of the five per resource
   * that say everything (SPEC.md §43, §121).
   */
  const add = (definition: Route, describe: boolean): void => {
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

    if (describe) {
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
    }

    ready = ready.then(() => {
      app.route({
        method: definition.method.toUpperCase() as 'GET',
        url,
        ...(definition.bodyLimit === undefined ? {} : { bodyLimit: definition.bodyLimit }),
        handler: handle(definition, url),
      })
    })
  }

  const server: HttpServer = {
    mount(...routes) {
      for (const definition of routes) add(definition, true)

      return server
    },

    mountRegistered() {
      return server.mount(...registeredRoutes())
    },

    mountResources() {
      const arrived = crudResources(options.registry).filter(
        (resource) => !resourceEndpoints.has(resource.name),
      )

      // Before the dispatching pair is armed, so a resource claiming an address this
      // application already serves is refused by name — `mount` says which two routes
      // collided, where the parameterised pair would simply never be reached and the
      // resource would be quietly unreachable at its own path.
      //
      // `current` is what keeps these endpoints from outliving the resource that
      // generated them: a collection mounted at boot and deleted, or narrowed, an hour
      // later would otherwise go on answering here (SPEC.md §37, §43).
      server.mount(...crudRoutes(arrived, buses, { current: currentResource }))

      for (const resource of arrived) resourceEndpoints.add(resource.name)

      if (!dispatching) {
        for (const definition of crudDispatchRoutes(currentResource, buses)) {
          add(definition, false)
          dispatchPaths.add(`${prefix}${definition.path}`)
        }

        dispatching = true

        // Said out loud, because a package that may not depend on this one has to know
        // it. `collections.create` answers an agent with the addresses of the collection
        // it just made, and the flags that decide which five they are say nothing about
        // whether this application serves any of them (SPEC.md §43).
        publishGeneratedCrud(prefix)
      }

      reconcileResourceRoutes()

      return server
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

    mountCommands(commandOptions) {
      return server.mount(
        ...commandRoutes(commandEndpoints(options.registry), options.commands, commandOptions),
      )
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

        // Chosen before the validator is built, because the two are one answer: a
        // cache keyed on an `ETag` that did not name the encoding would hand gzipped
        // bytes to a client that asked for none.
        const encoding = chosenEncoding(headerOf(request, 'accept-encoding'), found)
        const etag = taggedFor(found, encoding)

        reply
          .header('content-type', found.contentType)
          .header('cache-control', found.cacheControl)
          .header('etag', etag)
          .header('last-modified', found.modifiedAt.toUTCString())

        // Said whenever the answer *could* have been encoded, not only when it was.
        // A shared cache that stored the identity response without this would serve
        // it to everybody, including the clients that could have had the small one.
        if (found.compressible) reply.header('vary', 'accept-encoding')

        if (isUnchanged(request, etag, found.modifiedAt)) {
          // No body, and no `content-length`: the header describes the body that is
          // not being sent, and a client that reads it as the file's length is what
          // a truncated asset looks like.
          return await reply.status(304).send()
        }

        if (encoding === undefined) {
          return await reply.status(200).header('content-length', found.size).send(found.stream())
        }

        // Length is unknown until the bytes are compressed, and buffering the whole
        // file to learn it is the opposite of what this saves. Fastify sends it
        // chunked, which is what every static server does with a compressed body.
        const compressor = encoding === 'br' ? createBrotliCompress() : createGzip()

        void pipeline(found.stream(), compressor).catch(() => {
          // The response is already streaming, so there is no status left to change.
          // Destroying it is what tells the client the body is incomplete rather than
          // letting it read a truncated file as the whole one.
          compressor.destroy()
        })

        return await reply.status(200).header('content-encoding', encoding).send(compressor)
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

    mountRedirect(from, to) {
      // Refused here, where both claims can be named. Fastify would refuse the
      // duplicate too, at `ready()`, with a message naming the path and neither of
      // the two mounts that wanted it — which is the failure this method exists to
      // avoid rather than to reproduce.
      if (redirectPaths.has(from) || assetPaths.has(from)) {
        throw new ConfigurationError(
          `Something already answers "${from}", so it cannot also redirect to "${to}".`,
        )
      }

      redirectPaths.add(from)

      // Queued behind the plugins like every other route: Fastify refuses one added
      // after the instance is ready, and this is mounted while the application boots.
      ready = ready.then(() => {
        app.route({
          method: 'GET',
          url: from,
          // 302 rather than 301. This is true while this deployment serves that path,
          // and a permanent redirect a browser has cached outlives the deployment.
          handler: async (_request: FastifyRequest, reply: FastifyReply) =>
            await reply.redirect(to, 302),
        })
      })

      return server
    },

    async listen(port, host = '127.0.0.1') {
      await settled()
      return app.listen({ port, host })
    },

    async close() {
      // A closed server has no descriptions to keep level with anything, and the registry
      // it was watching may well outlive it.
      stopWatching()
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
