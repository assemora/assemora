import {
  collectErrors,
  createApplication,
  createLogger,
  type ErrorTrackingPort,
  permitAll,
  silentWriter,
} from '@assemora/core'
import { describe, expectTypeOf, it } from 'vitest'

import { type RequestLogOptions, SLOW_REQUEST_MS } from './request-log.js'
import { createHttpServer, type HttpServer, type HttpServerOptions } from './server.js'

const application = createApplication({
  authorization: permitAll(),
  logger: createLogger(silentWriter),
})

const buses = {
  registry: application.registry,
  commands: application.commands,
  queries: application.queries,
  logger: application.logger,
}

describe('the shape of the request line (SPEC.md §88)', () => {
  it('needs nothing said about it, because it is on by default', () => {
    expectTypeOf(createHttpServer(buses)).toEqualTypeOf<HttpServer>()
  })

  it('is tuned by a threshold and turned off by false', () => {
    expectTypeOf(
      createHttpServer({ ...buses, requestLog: { slowMs: 250 } }),
    ).toEqualTypeOf<HttpServer>()
    expectTypeOf(createHttpServer({ ...buses, requestLog: false })).toEqualTypeOf<HttpServer>()
    expectTypeOf<HttpServerOptions['requestLog']>().toEqualTypeOf<
      RequestLogOptions | false | undefined
    >()
  })

  it('refuses a knob nobody declared, so a typo is not a silently ignored setting', () => {
    // @ts-expect-error `slow` is not `slowMs`
    createHttpServer({ ...buses, requestLog: { slow: 250 } })
    // @ts-expect-error milliseconds are a number
    createHttpServer({ ...buses, requestLog: { slowMs: '250ms' } })
    // @ts-expect-error `true` says nothing `undefined` does not already say
    createHttpServer({ ...buses, requestLog: true })
  })

  it('states the default as a number an application can reason from', () => {
    expectTypeOf(SLOW_REQUEST_MS).toEqualTypeOf<number>()
  })
})

describe('where a failure this layer owns is reported (SPEC.md §88)', () => {
  it('takes the port core declares, exactly as the buses do', () => {
    expectTypeOf(
      createHttpServer({ ...buses, errors: collectErrors() }),
    ).toEqualTypeOf<HttpServer>()
    expectTypeOf<HttpServerOptions['errors']>().toEqualTypeOf<ErrorTrackingPort | undefined>()
  })

  it('refuses a reporter that does not answer with a promise', () => {
    // @ts-expect-error `capture` is awaited, so a batching reporter has somewhere to flush
    createHttpServer({ ...buses, errors: { capture: () => {} } })
    // @ts-expect-error a logger is not an error tracker
    createHttpServer({ ...buses, errors: createLogger(silentWriter) })
  })
})
