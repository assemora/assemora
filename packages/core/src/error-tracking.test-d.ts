import { describe, expectTypeOf, it } from 'vitest'

import { createApplication } from './application.js'
import type { AssemoraContext } from './context.js'
import { AssemoraError } from './errors.js'
import {
  captureError,
  collectErrors,
  type ErrorOperation,
  type ErrorReport,
  type ErrorTrackingPort,
  isIncident,
  logErrors,
  permitAll,
} from './ports.js'

/** Stands in for the SDK an application would actually install. */
declare const Sentry: {
  captureException(error: Error, hint: Record<string, unknown>): void
}

/**
 * The adapter of SPEC.md §88, written the way an application writes it. It compiles,
 * which is the point: the report hands over an ordinary `Error`, so a real tracker
 * needs no translation layer of its own.
 */
const sentry = (): ErrorTrackingPort => ({
  capture: async ({ error, code, context, operation }) => {
    Sentry.captureException(error, {
      tags: { source: context.source, code, [operation.kind]: operation.name },
      user: context.actor === undefined ? undefined : { id: context.actor.id },
    })
  },
})

describe('the error tracking port', () => {
  it('hands a reporter a redacted Error and the context it was thrown in', () => {
    const port: ErrorTrackingPort = {
      capture: async (report) => {
        expectTypeOf(report).toEqualTypeOf<ErrorReport>()
        expectTypeOf(report.error).toEqualTypeOf<Error>()
        expectTypeOf(report.context).toEqualTypeOf<AssemoraContext>()
        expectTypeOf(report.operation).toEqualTypeOf<ErrorOperation>()
        expectTypeOf(report.code).toEqualTypeOf<string | undefined>()
        expectTypeOf(report.status).toEqualTypeOf<number | undefined>()
      },
    }

    expectTypeOf(port.capture).returns.toEqualTypeOf<Promise<void>>()
    expectTypeOf(sentry()).toEqualTypeOf<ErrorTrackingPort>()
  })

  it('names what ran, and nothing that could carry a secret', () => {
    expectTypeOf<ErrorOperation['kind']>().toEqualTypeOf<'command' | 'query' | 'request'>()
    expectTypeOf<ErrorOperation>().not.toHaveProperty('input')
    expectTypeOf<ErrorReport>().not.toHaveProperty('details')
  })

  it('takes whatever a catch caught, and answers whether it was an incident', () => {
    expectTypeOf(isIncident).toBeCallableWith('a string nobody wrapped')
    expectTypeOf(isIncident(new Error('boom'))).toEqualTypeOf<boolean>()
    expectTypeOf(
      captureError({ errors: collectErrors(), logger: createApplication().logger }, 'boom', {
        kind: 'command',
        name: 'pages.publish',
      }),
    ).toEqualTypeOf<Promise<void>>()
  })

  it('is what an application registers, beside the log it falls back to', () => {
    const app = createApplication({ authorization: permitAll(), errors: sentry() })

    expectTypeOf(logErrors(app.logger)).toEqualTypeOf<ErrorTrackingPort>()
    expectTypeOf(collectErrors().reports).toEqualTypeOf<ErrorReport[]>()
  })
})

describe('what the port refuses', () => {
  it('will not accept a reporter that cannot be awaited', () => {
    const port: ErrorTrackingPort = {
      // @ts-expect-error a reporter that batches has to be able to report its flush
      capture: () => {},
    }

    expectTypeOf(port).toEqualTypeOf<ErrorTrackingPort>()
  })

  it('will not accept an operation kind nothing produces', () => {
    // @ts-expect-error 'job' is not one of the three layers that report
    const operation: ErrorOperation = { kind: 'job', name: 'sitemap.generate' }

    expectTypeOf(operation).toEqualTypeOf<ErrorOperation>()
  })

  it('will not let a report smuggle the input that was being processed', () => {
    const operation: ErrorOperation = {
      kind: 'command',
      name: 'auth.login',
      // @ts-expect-error a command's input is where the password is
      input: { email: 'ada@assemora.dev', password: 'hunter2' },
    }

    expectTypeOf(operation).toEqualTypeOf<ErrorOperation>()
  })

  it('will not accept an application reporter of the wrong shape', () => {
    // @ts-expect-error the port is a capture method, not a bare function
    createApplication({ errors: (error: unknown) => console.error(error) })
  })
})

describe('a 5xx that is an answer rather than a failure (SPEC.md §88)', () => {
  /** The one throw in the framework that makes this claim, written as it is written. */
  const refusal = new AssemoraError('NOT_READY', 'This application is still starting', {
    status: 503,
    expected: true,
  })

  it('carries the bit on the error, which is where whose failure it is already lives', () => {
    expectTypeOf(refusal.expected).toEqualTypeOf<boolean>()
    expectTypeOf(refusal.status).toEqualTypeOf<number>()
    expectTypeOf(isIncident(refusal)).toEqualTypeOf<boolean>()
  })

  it('leaves it off, and false, for every error that does not ask', () => {
    expectTypeOf(new AssemoraError('DATABASE_ERROR', 'boom').expected).toEqualTypeOf<boolean>()
  })
})

describe('what the bit refuses', () => {
  it('will not take a reason where a decision belongs', () => {
    const refusal = new AssemoraError('NOT_READY', 'This application is still starting', {
      status: 503,
      // @ts-expect-error it withdraws an incident claim; the reason goes in the message
      expected: 'a readiness probe asks this every five seconds',
    })

    expectTypeOf(refusal).toEqualTypeOf<AssemoraError>()
  })

  it('will not let a layer change its mind after the throw', () => {
    const raised = new AssemoraError('NOT_READY', 'This application is still starting', {
      status: 503,
      expected: true,
    })

    // @ts-expect-error the error decides this once, where it is raised
    raised.expected = false

    expectTypeOf(raised.expected).toEqualTypeOf<boolean>()
  })
})
