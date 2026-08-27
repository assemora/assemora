/**
 * The HTTP adapter (SPEC.md §40).
 *
 * Fastify lives here and nowhere else. A handler never sees it: what reaches a
 * handler is validated input and the application context, and what leaves is the
 * response the route declared (SPEC.md §41, §125.1).
 */
import {
  type Actor,
  AssemoraError,
  type CommandBus,
  createContext,
  type Logger,
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
import { isResponded, serializeCookie } from './respond.js'
import { describeRoute, type HttpMethod, type Route, routeName } from './route.js'

export type ActorResolver = (
  headers: Readonly<Record<string, string>>,
) => Promise<Actor | undefined>

export type HttpServerOptions = {
  readonly registry: SchemaRegistry
  readonly commands: CommandBus
  readonly queries: QueryBus
  readonly logger: Logger
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

  const csrfFails = (method: HttpMethod, headers: Readonly<Record<string, string>>): boolean => {
    if (options.csrf === undefined) return false
    if (method === 'get') return false
    if (headers.cookie === undefined || bearerPresented(headers.authorization)) return false

    const sent = headers[csrfHeader]
    const expected = cookieValue(headers.cookie, csrfCookie)

    return sent === undefined || expected === undefined || sent !== expected
  }

  const handle = (definition: Route) => async (request: FastifyRequest, reply: FastifyReply) => {
    const headers = headersOf(request)
    const requestId = headers['x-request-id'] ?? crypto.randomUUID()
    const actor = await options.resolveActor?.(headers)

    const context = createContext({
      source: definition.source ?? 'rest',
      requestId,
      ...(actor === undefined ? {} : { actor }),
      // Read off the request rather than out of a body, so a command that records it
      // records what arrived instead of what the caller asked to be remembered
      // (SPEC.md §85).
      ...(headers['user-agent'] === undefined ? {} : { userAgent: headers['user-agent'] }),
    })

    return runInContext(context, async () => {
      try {
        if (csrfFails(definition.method, headers)) {
          throw new AssemoraError('CSRF_FAILED', 'This request is missing its CSRF token', {
            status: 403,
          })
        }

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

        options.logger.error('Request failed', {
          method: definition.method,
          path: definition.path,
          status: failure.status,
        })

        return await reply.status(failure.status).send(failure.payload)
      }
    })
  }

  const server: HttpServer = {
    mount(...routes) {
      for (const definition of routes) {
        // A module may already have described this route. Describing is a separate
        // act from mounting, and doing both must not be an error (SPEC.md §42).
        if (
          options.registry.find('routes', routeName(definition.method, definition.path)) ===
          undefined
        ) {
          options.registry.register('routes', describeRoute(definition))
        }

        // Describing is synchronous, so the registry is complete the moment `mount`
        // returns; only the Fastify side waits for the plugins.
        const url = `${prefix}${definition.path}`

        ready = ready.then(() => {
          app.route({
            method: definition.method.toUpperCase() as 'GET',
            url,
            handler: handle(definition),
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

      ready = ready.then(() => {
        // `/studio` and `/studio/` are the same document, and a browser sends both.
        app.route({ method: 'GET', url: base === '' ? '/' : base, handler: serve })
        app.route({ method: 'GET', url: `${base}/*`, handler: serve })
      })

      return server
    },

    async listen(port, host = '127.0.0.1') {
      await ready
      return app.listen({ port, host })
    },

    async close() {
      await app.close()
    },

    async inject(request) {
      await ready

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
      await ready
      await app.ready()
    },
  }

  return server
}
