/**
 * The endpoints that publish the API's own description (SPEC.md §44, §45).
 */
import type { SchemaRegistry } from '@assemora/core'
import { type Route, route } from '@assemora/http'
import { json } from '@assemora/schema'

import { buildOpenApiDocument, type OpenApiDocument, type OpenApiInfo } from './document.js'

export type OpenApiRouteOptions = {
  readonly registry: SchemaRegistry
  readonly info: OpenApiInfo
  readonly prefix?: string
}

/** `GET /api/openapi.json` — the document of SPEC.md §44. */
export const openApiRoute = (options: OpenApiRouteOptions): Route =>
  route.get('/openapi.json', {
    description: 'The OpenAPI 3.1 description of this API',
    tags: ['developer'],
    response: json<OpenApiDocument>(),
    handler: () =>
      buildOpenApiDocument(options.registry, options.info, {
        ...(options.prefix === undefined ? {} : { prefix: options.prefix }),
      }),
  })

export type IntrospectionRouteOptions = {
  /**
   * Publishes the registry to anybody who asks. Off.
   *
   * It exists for the application that genuinely wants an open description of itself
   * — a public sandbox, a documentation site — and it has to be written down, because
   * the snapshot is the whole internal shape of the application and not just the part
   * a caller may use.
   */
  readonly public?: boolean
}

/**
 * `GET /api/_introspection` — everything the API Explorer of SPEC.md §45 shows:
 * routes, resources, commands and queries, exactly as they are registered.
 *
 * Authenticated, unlike `/openapi.json` beside it, and the difference is what the two
 * answer with. OpenAPI describes the API a caller may use, with hidden fields already
 * gone; this is the registry itself — every model, every column of the auth schema,
 * every command and query, including the ones the caller could never reach. Every
 * other read on this surface denies by default, the API Explorer that consumes this
 * sits behind Studio's login, and a description of the internal shape of an
 * application is not something to hand to somebody it cannot name (SPEC.md §85).
 */
export const introspectionRoute = (
  registry: SchemaRegistry,
  options: IntrospectionRouteOptions = {},
): Route =>
  route.get('/_introspection', {
    description: 'What this application registered: routes, resources, commands, queries',
    tags: ['developer'],
    auth: !(options.public ?? false),
    response: json<Readonly<Record<string, readonly unknown[]>>>(),
    errors: [
      { code: 'UNAUTHORIZED', status: 401, description: 'This description requires a credential' },
    ],
    handler: () => registry.describe(),
  })
