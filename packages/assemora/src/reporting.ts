/**
 * One failure, one report (SPEC.md §88).
 *
 * `assemora()` hands a single error tracking port to the command pipeline, to the
 * Query Bus and to the server in front of them, so that an application has one place
 * to put Sentry however a failure was reached. The price of that wiring is paid here:
 * a failure thrown inside a command and answered over HTTP passes two layers that
 * both report, and the tracker is handed the same stack twice — two issues, twice the
 * quota, and twice the work of redacting it.
 *
 * The repeat is dropped rather than merged, and the *first* report is the one that
 * survives. Merging is not available: the first report has already been sent by the
 * time the second is built, and a reporter that held it back to see whether more was
 * coming would delay the response it is reporting on. And the first is the one worth
 * keeping — it is the innermost layer, which knows the command's name, what it acted
 * on and how long the command itself ran, where the layer outside it adds only the
 * route and the status. Neither of those is lost: the request line carries both, under
 * the same request id, and that is what joins them (SPEC.md §87).
 *
 * Nothing is suppressed that nobody else reported. A route that threw on its own, a
 * resolver whose database was down, a response a handler promised and did not return —
 * each of those reaches the port exactly once, because it only ever passed one layer
 * that reports.
 */
import type { AssemoraContext, ErrorTrackingPort } from '@assemora/core'

/**
 * Refuses a report of a failure this request has already reported.
 *
 * Two reports are the same failure when they were made under the same context *and*
 * carry the same stack. The context is compared by identity rather than by request id:
 * it is one object for the life of a request, travelling through AsyncLocalStorage
 * (SPEC.md §12), so a `WeakMap` keyed on it needs no expiry, no cleanup and no bound —
 * what a request remembers is freed with the request. Outside one there is nothing to
 * group by, and `captureError` builds a fresh internal context for each report, so
 * every report of a CLI run or a worker is sent.
 *
 * The stack is what tells two failures of one request apart — a batch of tool calls
 * where two of them failed differently has two incidents to report, and only the
 * second copy of *one* of them is a duplicate.
 */
export const reportedOnce = (errors: ErrorTrackingPort): ErrorTrackingPort => {
  const reported = new WeakMap<AssemoraContext, Set<string>>()

  return {
    capture: async (report) => {
      // The stack identifies the throw. A message alone would collapse two different
      // failures that read alike, and an error without a stack has nothing better.
      const failure = report.error.stack ?? report.error.message
      const already = reported.get(report.context) ?? new Set<string>()

      if (already.has(failure)) return

      // Remembered before it is sent, not after: a reporter that failed has already had
      // its fallback — `captureError` writes the incident to the log itself — and
      // sending the outer copy to a port that just rejected would only fail again.
      already.add(failure)
      reported.set(report.context, already)

      await errors.capture(report)
    },
  }
}
