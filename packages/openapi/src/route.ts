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

/**
 * `GET /api/_introspection` — everything the API Explorer of SPEC.md §45 shows:
 * routes, resources, commands and queries, exactly as they are registered.
 */
export const introspectionRoute = (registry: SchemaRegistry): Route =>
  route.get('/_introspection', {
    description: 'What this application registered: routes, resources, commands, queries',
    tags: ['developer'],
    response: json<Readonly<Record<string, readonly unknown[]>>>(),
    handler: () => registry.describe(),
  })
