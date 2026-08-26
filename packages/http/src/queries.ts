/**
 * Queries over HTTP (SPEC.md §15, §43).
 *
 * The read half of `mountCommands`. Reads travel the Query Bus and writes the
 * Command Bus (ADR-0014), and until now only the Command Bus had an endpoint for
 * every registered name — so a page's history, declared and authorized like anything
 * else, was unreachable from a browser.
 *
 * These are `GET`, because a read has no side effects and must not need a CSRF token
 * to be allowed. Like the command endpoints they are safe by construction rather than
 * by care: the Query Bus validates and authorizes before a handler runs, and
 * authorization denies by default (SPEC.md §12, §51).
 */
import type { QueryBus, SchemaRegistry } from '@assemora/core'
import type { JsonSchema } from '@assemora/schema'

import type { Route } from './route.js'

/** The part of a query description these endpoints need. */
export type QueryEndpoint = {
  readonly name: string
  readonly description?: string
  readonly input: JsonSchema
  readonly module?: string
}

/**
 * A query string carries text, and the query's own schema says what that text meant.
 *
 * The same declaration that validates the input therefore also decides how to read
 * it — nothing here guesses, and a value that will not convert is passed through
 * untouched so the bus reports the mismatch rather than this (SPEC.md §3.4).
 */
const coerce = (raw: string, declared: unknown): unknown => {
  const type = (declared as { type?: unknown } | undefined)?.type

  if (type === 'number' || type === 'integer') {
    const asNumber = Number(raw)

    return raw === '' || Number.isNaN(asNumber) ? raw : asNumber
  }

  if (type === 'boolean') {
    if (raw === 'true') return true
    if (raw === 'false') return false

    return raw
  }

  if (type === 'string') return raw

  if (type === 'object' || type === 'array') {
    try {
      return JSON.parse(raw)
    } catch {
      return raw
    }
  }

  // A schema that declared no type accepts anything — `json()` and `unknown()` are
  // the two — so text that *is* JSON is read as JSON, and text that is not stays
  // text. A field that must remain a string says `string()`, and is left alone above.
  try {
    return JSON.parse(raw)
  } catch {
    return raw
  }
}

const inputOf = (endpoint: QueryEndpoint, query: Readonly<Record<string, unknown>>) => {
  const properties = (endpoint.input as { properties?: Record<string, unknown> }).properties ?? {}
  const input: Record<string, unknown> = {}

  for (const [key, value] of Object.entries(query)) {
    if (typeof value === 'string') input[key] = coerce(value, properties[key])
  }

  return input
}

const isQueryEndpoint = (entry: unknown): entry is QueryEndpoint => {
  const candidate = entry as QueryEndpoint

  return typeof candidate?.name === 'string' && typeof candidate.input === 'object'
}

/** Reads the query descriptions out of the registry, whoever put them there. */
export const queryEndpoints = (registry: SchemaRegistry): QueryEndpoint[] =>
  (registry.describe().queries ?? []).filter(isQueryEndpoint)

export const queryRoutes = (endpoints: readonly QueryEndpoint[], queries: QueryBus): Route[] =>
  endpoints.map((endpoint) => ({
    node: 'route',
    method: 'get',
    path: `/queries/${endpoint.name}`,
    params: undefined,
    // Described, not judged: repeating the query's own validation here would be a
    // second implementation of it, and two validators drift (SPEC.md §14).
    query: undefined,
    body: undefined,
    // A query answers with whatever it answers with, and nothing describes that shape
    // yet. Promising a schema here would be inventing one (SPEC.md §42).
    response: undefined,
    auth: false,
    source: undefined,
    status: 200,
    description: endpoint.description,
    tags: [endpoint.module ?? 'queries'],
    errors: [
      { code: 'VALIDATION_ERROR', status: 422, description: 'The input does not fit' },
      { code: 'FORBIDDEN', status: 403, description: 'The actor may not run this query' },
    ],
    handler: async ({ request }) =>
      await queries.execute(
        endpoint.name,
        inputOf(endpoint, (request as { query?: Record<string, unknown> }).query ?? {}),
      ),
  }))
