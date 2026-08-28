/**
 * Liveness and readiness (SPEC.md §88).
 *
 * Two different questions, and a deployment that cannot tell them apart restarts a
 * process that was only still starting. `/health` says this process is answering;
 * `/ready` says it has finished booting and its modules are running, and answers 503
 * until it has, which is what stops a load balancer sending traffic at an application
 * whose modules have not registered yet.
 *
 * They are mounted under the API prefix like every other endpoint, so they are
 * described in OpenAPI and in the API Explorer with everything else. `/ready` does
 * not probe the database: the adapter contract has no portable ping, and a readiness
 * check that lies about what it verified is worse than one that says what it means.
 *
 * A module that could not start is not a probe either. It is a fact the boot already
 * established and core already collected (`Application.notStarted`), and it is the
 * other half of the promise this comment has always made — "its modules are running".
 * Without it an application whose collections table does not exist yet listens, serves
 * Studio, answers this endpoint with 200 and refuses every data request with 503.
 */
import { AssemoraError, type NotStarted } from '@assemora/core'
import { type Route, route } from '@assemora/http'
import { string } from '@assemora/schema'

/** What this application would answer a readiness probe with, at the moment it is asked. */
export type Readiness = {
  /** Boot has finished and everything that had to be mounted is mounted. */
  readonly booted: boolean
  /** The modules that booted and are not running (SPEC.md §88). */
  readonly notStarted: readonly NotStarted[]
}

/** "collections", or "collections and search", or "collections, search and media". */
const list = (names: readonly string[]): string =>
  names.length < 2
    ? (names[0] ?? '')
    : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`

export const healthRoutes = (readiness: () => Readiness): Route[] => [
  route.get('/health', {
    description: 'Liveness: this process is answering',
    tags: ['developer'],
    response: { status: string() },
    handler: () => ({ status: 'ok' }),
  }),

  route.get('/ready', {
    description: 'Readiness: this application has finished booting and its modules are running',
    tags: ['developer'],
    response: { status: string() },
    errors: [{ code: 'NOT_READY', status: 503, description: 'The application is not serving' }],
    handler: () => {
      const { booted, notStarted } = readiness()

      // Refused the way everything else in this application is refused, rather than a
      // 503 carrying a body shaped like a success (SPEC.md §46).
      //
      // Two refusals, because they are two different things to do about it. "Still
      // starting" resolves itself and a probe is right to keep asking; a module that
      // could not start never will, and whoever is reading the probe is owed the
      // reason rather than the same sentence for ever. It goes first for that reason:
      // it is the more specific account of the same 503.
      //
      // Both are `expected`, which is what keeps a probe from becoming an incident
      // feed: this endpoint answers 503 because a load balancer has to read one, not
      // because anything failed, and `notStarted` is never revoked — a probe every five
      // seconds against it is seventeen thousand reports a day about a fact `listen()`
      // already logged once (SPEC.md §88).
      if (notStarted.length > 0) {
        throw new AssemoraError(
          'NOT_READY',
          // Named once each: a module may report from more than one hook, and core keeps
          // every reason on purpose — but "collections and collections did not start"
          // is a sentence about the reporting rather than about the application. The
          // reasons themselves are all in `details`, unmerged.
          `This application booted, but ${list([...new Set(notStarted.map((entry) => entry.module))])} did not start, so it is not ready to serve.`,
          // The module's own sentences, which is why `cannotStart` takes written text
          // rather than whatever was caught: this body is served to anyone who can
          // reach the probe.
          { status: 503, expected: true, details: { notStarted } },
        )
      }

      if (!booted) {
        throw new AssemoraError('NOT_READY', 'This application is still starting', {
          status: 503,
          expected: true,
        })
      }

      return { status: 'ready' }
    },
  }),
]
