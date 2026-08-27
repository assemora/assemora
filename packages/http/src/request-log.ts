/**
 * The one line a request writes (SPEC.md §88).
 *
 * The logger already attaches the request id, the actor and the source from the
 * ambient context (SPEC.md §87), so what is left is the four things only this layer
 * knows: the method, the route, the status and how long it took.
 *
 * What is deliberately not here is the URL, the query string, the body and the
 * headers. A log line is written to a disk, shipped to whoever collects logs and
 * pasted into tickets, and each of those four carries something that has no business
 * going there — an id in a path, a search term, a password on its way to be compared,
 * a session cookie, a bearer token. The route's own path says everything a reader can
 * act on, and says it in the one form that aggregates (SPEC.md §85).
 */
import type { Logger, LogLevel } from '@assemora/core'

/** How the line is tuned. `requestLog: false` is how an application has none. */
export type RequestLogOptions = {
  /**
   * How long a request may take, in milliseconds, before its line is a warning
   * rather than information.
   *
   * The point of it is that a log nobody reads still surfaces the line worth
   * reading: an application that logs every request at one level has, in practice,
   * logged nothing.
   */
  readonly slowMs?: number
}

/**
 * A second.
 *
 * SPEC.md §89 budgets 100ms for a read and 150ms for a mutation at p95, so nothing
 * inside the performance envelope trips this — and it sits far enough above that
 * envelope that a cold first request, a large upload or a streamed file does not trip
 * it either. A threshold that fires on ordinary traffic is a threshold somebody turns
 * off, and then the slow request nobody was told about is the one that matters.
 */
export const SLOW_REQUEST_MS = 1_000

/** One finished request, as much of it as may be written down. */
export type ServedRequest = {
  readonly method: string
  /**
   * The route's path as it is served — `/api/articles/:id`, never
   * `/api/articles/8f3a…`. A log keyed by URL cannot be aggregated and quietly
   * records ids.
   *
   * Absent when nothing matched: there is no route to name then, and the URL that
   * missed is not a substitute for one.
   */
  readonly path?: string
  readonly status: number
  readonly durationMs: number
  /** A file from `mountAssets`, rather than an endpoint. */
  readonly asset?: boolean
}

/**
 * How loudly the line is written, or `undefined` for not at all.
 *
 * The rungs are the ones every access log already uses, so nobody has to learn a new
 * convention: a failure the server owns is an error, a request the caller was refused
 * is a warning, and everything else is information — raised to a warning when it took
 * too long.
 */
export const requestLogLevel = (served: ServedRequest, slowMs: number): LogLevel | undefined => {
  if (served.status >= 500) return 'error'
  if (served.status >= 400) return 'warn'

  // A single-page application is dozens of files per page load, and timing each one
  // buries the endpoints among them. The duration would not be the server's to answer
  // for anyway: a file's line is mostly the body reaching the client over whatever
  // connection the client has, so a slow one says more about a phone on a train than
  // about this process. A file that was refused or that failed is still logged above,
  // which is the half worth having — that is a traversal attempt or a broken deploy.
  if (served.asset === true) return undefined

  return served.durationMs >= slowMs ? 'warn' : 'info'
}

export const logRequest = (logger: Logger, served: ServedRequest, slowMs: number): void => {
  const level = requestLogLevel(served, slowMs)

  if (level === undefined) return

  logger[level]('Request completed', {
    method: served.method,
    ...(served.path === undefined ? {} : { path: served.path }),
    status: served.status,
    // Rounded to a tenth of a millisecond. Below that nothing is being measured that
    // a person reading a log line can act on, and the remaining digits are noise in
    // every one of them.
    durationMs: Math.round(served.durationMs * 10) / 10,
  })
}
