/**
 * `@assemora/openapi` — the API describing itself.
 *
 * The document is generated from the Schema Registry, so a route that exists is a
 * route that is documented, and no annotation is ever written by hand (SPEC.md §3.7,
 * §44, §125.8).
 */

export {
  buildOpenApiDocument,
  type OpenApiDocument,
  type OpenApiInfo,
  type RegistrySnapshot,
  toOpenApiPath,
} from './document.js'
export { introspectionRoute, type OpenApiRouteOptions, openApiRoute } from './route.js'
