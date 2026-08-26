/**
 * Route DSL (SPEC.md §41).
 *
 * One declaration is the runtime and the documentation at once: it validates the
 * request, types the handler, serializes the response, and describes itself to the
 * Schema Registry, from which OpenAPI, the API Explorer and the SDK are generated
 * (SPEC.md §3.7, §42, §121).
 */
import type { Actor, AssemoraContext } from '@assemora/core'
import { type InferShape, type JsonSchema, object, type Schema, type Shape } from '@assemora/schema'

export type HttpMethod = 'get' | 'post' | 'put' | 'patch' | 'delete'

/** An application error a route can answer with (SPEC.md §46). */
export type ErrorDescriptor = {
  readonly code: string
  readonly status: number
  readonly description?: string
}

export type RouteRequest<P extends Shape, Q extends Shape, B extends Shape> = {
  readonly params: InferShape<P>
  readonly query: InferShape<Q>
  readonly body: InferShape<B>
  readonly headers: Readonly<Record<string, string>>
  readonly actor: Actor | undefined
  readonly context: AssemoraContext
  /**
   * The adapter's own request object. An advanced escape hatch and deliberately
   * `unknown`: Fastify must not become part of a handler's type (SPEC.md §40, §41).
   */
  readonly request: unknown
}

export type RouteDefinition<P extends Shape, Q extends Shape, B extends Shape, R> = {
  readonly params?: P
  readonly query?: Q
  readonly body?: B
  /** The shape of a successful answer. Used to serialize it and to document it. */
  readonly response?: Shape | Schema<unknown>
  readonly auth?: boolean
  /**
   * What the audit log should call this door (SPEC.md §67).
   *
   * `rest` unless a route says otherwise. The MCP endpoint says `mcp`, because "an
   * agent did this through MCP" and "somebody did this over REST" are the two
   * things that column exists to tell apart.
   */
  readonly source?: AssemoraContext['source']
  readonly status?: number
  readonly description?: string
  readonly tags?: readonly string[]
  readonly errors?: readonly ErrorDescriptor[]
  handler(request: RouteRequest<P, Q, B>): Promise<R> | R
}

export type Route = {
  readonly node: 'route'
  readonly method: HttpMethod
  readonly path: string
  readonly params: Schema<unknown> | undefined
  readonly query: Schema<unknown> | undefined
  readonly body: Schema<unknown> | undefined
  readonly response: Schema<unknown> | undefined
  readonly auth: boolean
  readonly source: AssemoraContext['source'] | undefined
  readonly status: number
  readonly description: string | undefined
  readonly tags: readonly string[]
  readonly errors: readonly ErrorDescriptor[]
  handler(request: RouteRequest<Shape, Shape, Shape>): Promise<unknown> | unknown
}

/** How a route describes itself in the Schema Registry (SPEC.md §42). */
export type RouteDescriptor = {
  readonly name: string
  readonly method: HttpMethod
  readonly path: string
  readonly description?: string
  readonly tags: readonly string[]
  readonly auth: boolean
  readonly status: number
  readonly params?: JsonSchema
  readonly query?: JsonSchema
  readonly body?: JsonSchema
  readonly response?: JsonSchema
  readonly errors: readonly ErrorDescriptor[]
  readonly module?: string
}

declare module '@assemora/core' {
  interface RegistrySections {
    routes: RouteDescriptor
  }
}

const isSchema = (value: Shape | Schema<unknown>): value is Schema<unknown> =>
  typeof (value as Schema<unknown>).parse === 'function'

const asSchema = (value: Shape | Schema<unknown> | undefined): Schema<unknown> | undefined =>
  value === undefined ? undefined : isSchema(value) ? value : object(value)

const define = <P extends Shape, Q extends Shape, B extends Shape, R>(
  method: HttpMethod,
  path: string,
  definition: RouteDefinition<P, Q, B, R>,
): Route => ({
  node: 'route',
  method,
  path,
  params: asSchema(definition.params),
  query: asSchema(definition.query),
  body: asSchema(definition.body),
  response: asSchema(definition.response),
  auth: definition.auth ?? false,
  source: definition.source,
  status: definition.status ?? (method === 'post' ? 201 : 200),
  description: definition.description,
  tags: definition.tags ?? [],
  errors: definition.errors ?? [],
  handler: definition.handler as Route['handler'],
})

/**
 * ```ts
 * route.post('/auth/login', {
 *   body: { email: email(), password: string().min(8) },
 *   response: { token: string() },
 *   handler: async ({ body }) => ({ token: await login(body) }),
 * })
 * ```
 */
export const route = {
  get: <P extends Shape, Q extends Shape, R>(
    path: string,
    definition: RouteDefinition<P, Q, Shape, R>,
  ): Route => define('get', path, definition),

  post: <P extends Shape, Q extends Shape, B extends Shape, R>(
    path: string,
    definition: RouteDefinition<P, Q, B, R>,
  ): Route => define('post', path, definition),

  put: <P extends Shape, Q extends Shape, B extends Shape, R>(
    path: string,
    definition: RouteDefinition<P, Q, B, R>,
  ): Route => define('put', path, definition),

  patch: <P extends Shape, Q extends Shape, B extends Shape, R>(
    path: string,
    definition: RouteDefinition<P, Q, B, R>,
  ): Route => define('patch', path, definition),

  delete: <P extends Shape, Q extends Shape, R>(
    path: string,
    definition: RouteDefinition<P, Q, Shape, R>,
  ): Route => define('delete', path, definition),
}

/** `POST /auth/login` → `post /auth/login`, the name the registry keys on. */
export const routeName = (method: HttpMethod, path: string): string => `${method} ${path}`

export const describeRoute = (definition: Route, module?: string): RouteDescriptor => ({
  name: routeName(definition.method, definition.path),
  method: definition.method,
  path: definition.path,
  ...(definition.description === undefined ? {} : { description: definition.description }),
  tags: definition.tags,
  auth: definition.auth,
  status: definition.status,
  ...(definition.params === undefined ? {} : { params: definition.params.toJsonSchema() }),
  ...(definition.query === undefined ? {} : { query: definition.query.toJsonSchema() }),
  ...(definition.body === undefined ? {} : { body: definition.body.toJsonSchema() }),
  ...(definition.response === undefined ? {} : { response: definition.response.toJsonSchema() }),
  errors: definition.errors,
  ...(module === undefined ? {} : { module }),
})
