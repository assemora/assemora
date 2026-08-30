/**
 * OpenAPI 3.1 built from the Schema Registry (SPEC.md §44).
 *
 * Nothing here is written by hand and nothing is annotated at a call site: a route
 * or a resource that describes itself is already documented. That is what makes the
 * document current by construction rather than by discipline (SPEC.md §3.7).
 */
import type { SchemaRegistry } from '@assemora/core'
import type { JsonSchema } from '@assemora/schema'

export type OpenApiInfo = {
  readonly title: string
  readonly version: string
  readonly description?: string
}

export type OpenApiDocument = Readonly<Record<string, unknown>>

type RouteEntry = {
  readonly name: string
  readonly method: string
  readonly path: string
  readonly description?: string
  readonly tags?: readonly string[]
  readonly auth?: boolean
  readonly status?: number
  readonly params?: JsonSchema
  readonly query?: JsonSchema
  readonly body?: JsonSchema
  readonly response?: JsonSchema
  readonly errors?: readonly { code: string; status: number; description?: string }[]
}

type ResourceEntry = {
  readonly name: string
  readonly label?: string
  readonly fields?: readonly {
    name: string
    required?: boolean
    hidden?: boolean
    schema?: JsonSchema
  }[]
}

/** `/articles/:id` → `/articles/{id}`, which is how OpenAPI spells a path parameter. */
export const toOpenApiPath = (path: string): string => path.replace(/:([A-Za-z0-9_]+)/g, '{$1}')

const properties = (schema: JsonSchema | undefined): Record<string, JsonSchema> =>
  (schema?.properties as Record<string, JsonSchema> | undefined) ?? {}

const requiredOf = (schema: JsonSchema | undefined): readonly string[] =>
  (schema?.required as readonly string[] | undefined) ?? []

const parametersOf = (entry: RouteEntry) => {
  const build = (schema: JsonSchema | undefined, location: 'path' | 'query') =>
    Object.entries(properties(schema)).map(([name, property]) => ({
      name,
      in: location,
      required: location === 'path' ? true : requiredOf(schema).includes(name),
      schema: property,
    }))

  return [...build(entry.params, 'path'), ...build(entry.query, 'query')]
}

const ERROR_SCHEMA: JsonSchema = {
  type: 'object',
  properties: {
    error: {
      type: 'object',
      properties: {
        code: { type: 'string' },
        message: { type: 'string' },
        details: {},
        fields: {
          type: 'object',
          additionalProperties: { type: 'array', items: { type: 'string' } },
        },
        requestId: { type: 'string' },
      },
      required: ['code', 'message'],
    },
  },
  required: ['error'],
}

const responsesOf = (entry: RouteEntry) => {
  const responses: Record<string, unknown> = {
    [String(entry.status ?? 200)]: {
      description: 'Success',
      ...(entry.response === undefined
        ? {}
        : { content: { 'application/json': { schema: entry.response } } }),
    },
    '422': {
      description: 'The request did not validate',
      content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
    },
  }

  for (const failure of entry.errors ?? []) {
    responses[String(failure.status)] = {
      description: failure.description ?? failure.code,
      content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
    }
  }

  if (entry.auth === true) {
    responses['401'] = {
      description: 'Authentication is required',
      content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
    }
  }

  return responses
}

/**
 * A resource as a component schema.
 *
 * Hidden fields are left out: a document is published, and SPEC.md §85 keeps secrets
 * out of what is published as firmly as out of what is logged.
 */
const resourceSchema = (resource: ResourceEntry): JsonSchema => {
  const visible = (resource.fields ?? []).filter((field) => field.hidden !== true)

  return {
    type: 'object',
    properties: Object.fromEntries(visible.map((field) => [field.name, field.schema ?? {}])),
    ...(visible.some((field) => field.required === true)
      ? { required: visible.filter((field) => field.required === true).map((field) => field.name) }
      : {}),
  }
}

const isRouteEntry = (entry: unknown): entry is RouteEntry =>
  typeof (entry as RouteEntry)?.method === 'string' &&
  typeof (entry as RouteEntry).path === 'string'

const isResourceEntry = (entry: unknown): entry is ResourceEntry =>
  Array.isArray((entry as ResourceEntry)?.fields)

/** A language this deployment serves (SPEC.md §131). */
type LocaleEntry = { readonly name: string; readonly default?: boolean }

const isLocaleEntry = (entry: unknown): entry is LocaleEntry =>
  typeof (entry as LocaleEntry)?.name === 'string'

/** Everything the registry holds, as plain data. What the CLI will hand in too. */
export type RegistrySnapshot = Readonly<
  Record<string, readonly Readonly<Record<string, unknown>>[]>
>

const snapshotOf = (source: SchemaRegistry | RegistrySnapshot): RegistrySnapshot =>
  typeof (source as SchemaRegistry).describe === 'function'
    ? ((source as SchemaRegistry).describe() as RegistrySnapshot)
    : (source as RegistrySnapshot)

/**
 * Where the API is, as OpenAPI says it: a base, and the paths relative to it.
 *
 * The prefix used to be inside every path — `/api/articles` — which reads the same to a
 * person and cannot express one thing: that the same endpoint is also served one segment
 * further along, under a language (SPEC.md §131). `servers` is what OpenAPI has for a
 * base that varies, and a path that already contains the base cannot be relative to two
 * of them.
 *
 * So a document now carries `/api` as its server and `/articles` as its path, which is
 * how an OpenAPI document is ordinarily written, and a deployment serving several
 * languages carries a second server with the language as a variable. A generated client
 * then reaches `/api/ru/articles` by choosing a server rather than by rewriting a path.
 */
const serversFor = (
  prefix: string,
  locales: readonly LocaleEntry[],
): readonly Readonly<Record<string, unknown>>[] => {
  const names = locales.map((entry) => entry.name)
  const fallback = locales.find((entry) => entry.default)?.name ?? names[0]

  if (names.length < 2 || fallback === undefined) return [{ url: prefix }]

  return [
    { url: prefix, description: `The default language (${fallback})` },
    {
      url: `${prefix}/{locale}`,
      description: 'The same API, read and written in one language',
      variables: { locale: { enum: [...names], default: fallback } },
    },
  ]
}

export const buildOpenApiDocument = (
  source: SchemaRegistry | RegistrySnapshot,
  info: OpenApiInfo,
  options: { readonly prefix?: string } = {},
): OpenApiDocument => {
  const prefix = options.prefix ?? '/api'
  const snapshot = snapshotOf(source)
  const routes = (snapshot.routes ?? []).filter(isRouteEntry)
  const resources = (snapshot.resources ?? []).filter(isResourceEntry)
  const locales = (snapshot.locales ?? []).filter(isLocaleEntry)

  const paths: Record<string, Record<string, unknown>> = {}

  for (const entry of routes) {
    const url = toOpenApiPath(entry.path)
    const operation = {
      operationId: entry.name.replace(/[^A-Za-z0-9]+/g, '_'),
      ...(entry.description === undefined ? {} : { summary: entry.description }),
      ...(entry.tags === undefined || entry.tags.length === 0 ? {} : { tags: [...entry.tags] }),
      ...(parametersOf(entry).length === 0 ? {} : { parameters: parametersOf(entry) }),
      ...(entry.body === undefined
        ? {}
        : {
            requestBody: {
              required: true,
              content: { 'application/json': { schema: entry.body } },
            },
          }),
      responses: responsesOf(entry),
      ...(entry.auth === true ? { security: [{ bearerAuth: [] }] } : {}),
    }

    paths[url] = { ...paths[url], [entry.method]: operation }
  }

  return {
    openapi: '3.1.0',
    servers: serversFor(prefix, locales),
    info: {
      title: info.title,
      version: info.version,
      ...(info.description === undefined ? {} : { description: info.description }),
    },
    paths,
    components: {
      schemas: {
        Error: ERROR_SCHEMA,
        ...Object.fromEntries(
          resources.map((resource) => [
            resource.name.replace(/[^A-Za-z0-9]+/g, '_'),
            resourceSchema(resource),
          ]),
        ),
      },
      securitySchemes: {
        bearerAuth: { type: 'http', scheme: 'bearer' },
      },
    },
    tags: [...new Set(routes.flatMap((entry) => entry.tags ?? []))].map((name) => ({ name })),
  }
}
