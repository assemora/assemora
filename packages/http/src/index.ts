/**
 * `@assemora/http` — the HTTP layer.
 *
 * One route declaration validates the request, types the handler, serializes the
 * answer and describes itself to the Schema Registry — from which OpenAPI, the API
 * Explorer and the SDK follow without a second schema anywhere (SPEC.md §112, §121).
 *
 * ```ts
 * route.post('/auth/login', {
 *   body: { email: email(), password: string().min(8) },
 *   response: { token: string() },
 *   handler: async ({ body }) => ({ token: await login(body) }),
 * })
 * ```
 *
 * Fastify is declared here and nowhere else, and never appears in a handler's type.
 */

export {
  type AssetsOptions,
  assetCacheControl,
  assetContentType,
  findAsset,
  resolveAsset,
  type ServedAsset,
} from './assets.js'
export { type BytesResponse, bytes, isBytesResponse } from './bytes.js'
export { type CommandEndpoint, commandEndpoints, commandRoutes } from './commands.js'
export {
  CRUD_OPERATIONS,
  type CrudBuses,
  type CrudOperation,
  type CrudResource,
  crudResources,
  crudRoutes,
  publishedOperations,
} from './crud.js'
export {
  clearRouteRegistry,
  defineRouteFacet,
  registeredRoutes,
} from './module.js'
export { type QueryEndpoint, queryEndpoints, queryRoutes } from './queries.js'
export { type RequestLogOptions, SLOW_REQUEST_MS } from './request-log.js'
export {
  type Cookie,
  isResponded,
  type Responded,
  respond,
  serializeCookie,
} from './respond.js'
export {
  describeRoute,
  type ErrorDescriptor,
  type HttpMethod,
  type Route,
  type RouteDefinition,
  type RouteDescriptor,
  type RouteRequest,
  route,
  routeName,
} from './route.js'
export {
  type ActorResolver,
  createHttpServer,
  type HttpServer,
  type HttpServerOptions,
  type InjectedResponse,
} from './server.js'
export {
  type ApiVersion,
  type ApiVersionOptions,
  type NamedResource,
  type VersionDeclaration,
  type VersionedResourceOptions,
  versionedRoute,
  versionRoutes,
} from './version.js'
