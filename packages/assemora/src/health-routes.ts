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
 */
import { AssemoraError } from '@assemora/core'
import { type Route, route } from '@assemora/http'
import { string } from '@assemora/schema'

export const healthRoutes = (isReady: () => boolean): Route[] => [
  route.get('/health', {
    description: 'Liveness: this process is answering',
    tags: ['developer'],
    response: { status: string() },
    handler: () => ({ status: 'ok' }),
  }),

  route.get('/ready', {
    description: 'Readiness: this application has finished booting',
    tags: ['developer'],
    response: { status: string() },
    errors: [{ code: 'NOT_READY', status: 503, description: 'The application is still starting' }],
    handler: () => {
      // Refused the way everything else in this application is refused, rather than a
      // 503 carrying a body shaped like a success (SPEC.md §46).
      if (!isReady()) {
        throw new AssemoraError('NOT_READY', 'This application is still starting', { status: 503 })
      }

      return { status: 'ready' }
    },
  }),
]
