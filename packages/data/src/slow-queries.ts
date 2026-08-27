/**
 * Slow query logging (SPEC.md §88).
 *
 * The data layer owns the query, so it owns the timing. What it writes down is the
 * *shape* of a query that took too long — which table, which operation, which columns
 * were filtered on, which relations were loaded — and never one value the caller
 * passed in.
 *
 * The logger arrives the way the adapter does, through a registration made once when
 * the application boots (SPEC.md §33). A model declaration takes no logger, a query
 * takes no logger, and nothing in the data layer's public API grew a parameter for
 * something only the composition root can know.
 */
import { ConfigurationError, type Logger } from '@assemora/core'
import type { Condition, QueryAst, RelationLoad } from '@assemora/database'

export type SlowQueryLogOptions = {
  /**
   * A query that takes at least this long is written down. 200ms.
   *
   * SPEC.md §89 budgets a whole REST read at 100ms and a whole mutation at 150ms, so a
   * single statement above 200ms is already outside what the application promised —
   * which is what makes this quiet in a healthy process and loud in a sick one. The
   * threshold *is* the throttle: a line is only ever written for a query that was
   * slow, and when that stops being rare, that is the thing worth knowing.
   *
   * `0` logs every query, which is occasionally what you want while looking at one
   * endpoint and never what you want in production.
   */
  readonly slowerThanMs?: number
}

/** Above the §89 budget for a whole request, so a healthy application writes nothing. */
export const DEFAULT_SLOW_QUERY_MS = 200

let log: { readonly logger: Logger; readonly slowerThanMs: number } | undefined

/**
 * Starts writing down the queries that take too long.
 *
 * ```ts
 * useSlowQueryLog(app.logger)
 * useSlowQueryLog(app.logger, { slowerThanMs: 50 })
 * ```
 *
 * Registering is the switch, and `assemora()` registers it for every application it
 * builds — so a project that says nothing still gets the log, and one built by hand
 * with `createApplication()` opts in with this one line.
 */
export const useSlowQueryLog = (logger: Logger, options: SlowQueryLogOptions = {}): void => {
  const slowerThanMs = options.slowerThanMs ?? DEFAULT_SLOW_QUERY_MS

  // A NaN threshold compares false against everything, so an unread environment
  // variable would switch the log off in silence rather than fail where it was written.
  if (!Number.isFinite(slowerThanMs) || slowerThanMs < 0) {
    throw new ConfigurationError(
      'A slow query threshold is a number of milliseconds that is not negative. Pass 0 to log every query.',
    )
  }

  log = { logger, slowerThanMs }
}

export const clearSlowQueryLog = (): void => {
  log = undefined
}

/**
 * What a condition was, with everything the caller passed taken out of it.
 *
 * A column name is schema. It is already in the OpenAPI document, in the generated SDK
 * and in the MCP tool list, and knowing which columns a slow query filtered on is the
 * whole difference between a line that names the missing index and a line that names
 * only the table.
 *
 * A *value* is the caller's, and this is the one place in the framework where that
 * distinction has teeth: a `where` carries whatever was handed to it — an email
 * address, a session token digest, a password on its way to be compared — and a slow
 * query log is exactly the file that gets attached to a ticket and pasted into a chat.
 * So nothing that was passed in is written here. That includes a JSON path, which
 * names a key inside a document that has no schema for it to belong to.
 */
const shapeOf = (conditions: readonly Condition[]): string[] =>
  conditions.flatMap((condition) => {
    if (condition.kind === 'group') return shapeOf(condition.conditions)
    if (condition.kind === 'json') return [`${condition.field} json ${condition.operator}`]

    return [`${condition.field} ${condition.operator}`]
  })

/**
 * The relation paths the query loaded, as the caller wrote them.
 *
 * Here because SPEC.md §89 asks for N+1 queries to be caught by logs as well as by
 * tests, and the same relation appearing under one model over and over is what that
 * looks like from the outside.
 */
const pathsOf = (loads: readonly RelationLoad[], prefix = ''): string[] =>
  loads.flatMap((load) => {
    const path = `${prefix}${load.relation}`

    return load.nested.length === 0 ? [path] : pathsOf(load.nested, `${path}.`)
  })

/**
 * Notes that a query ran, and writes it down if it was slow.
 *
 * `answer` is what the adapter replied with, and it is absent when the query failed.
 * Only an array is counted: a `count` replies with the number it was asked for, which
 * is an answer rather than a row count, and this line carries no answers.
 */
export const recordQuery = (query: QueryAst, durationMs: number, answer?: unknown): void => {
  if (log === undefined || durationMs < log.slowerThanMs) return

  const filters = shapeOf(query.where)
  const relations = pathsOf(query.with)

  log.logger.warn('A query was slower than the threshold', {
    model: query.model,
    operation: query.operation,
    durationMs,
    ...(Array.isArray(answer) ? { rows: answer.length } : {}),
    ...(filters.length === 0 ? {} : { filters }),
    ...(relations.length === 0 ? {} : { relations }),
  })
}
