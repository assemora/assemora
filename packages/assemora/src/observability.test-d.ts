import type { ErrorTrackingPort } from '@assemora/core'
import { createMemoryAdapter } from '@assemora/database'
import { describe, expectTypeOf, it } from 'vitest'

import type { AssemoraOptions, ObservabilityOptions } from './options.js'

const database = createMemoryAdapter()

const sentry: ErrorTrackingPort = { capture: () => Promise.resolve() }

describe('observability options (SPEC.md §88)', () => {
  it('takes a reporter and two thresholds, each switchable off', () => {
    const options: AssemoraOptions = {
      database,
      observability: { errors: sentry, slowQueryMs: 50, slowRequestMs: false },
    }

    expectTypeOf(options.observability).toEqualTypeOf<ObservabilityOptions | undefined>()
  })

  it('refuses a threshold that is not a number of milliseconds', () => {
    // @ts-expect-error a threshold is milliseconds, not a duration written out
    const written: AssemoraOptions = { database, observability: { slowQueryMs: '200ms' } }

    // @ts-expect-error `true` is not a threshold — leaving it out is how it stays on
    const enabled: AssemoraOptions = { database, observability: { slowRequestMs: true } }

    // @ts-expect-error a misspelled option would otherwise switch nothing on in silence
    const typo: AssemoraOptions = { database, observability: { slowQuery: 50 } }

    // @ts-expect-error a reporter is a port, not a function
    const bare: AssemoraOptions = { database, observability: { errors: () => undefined } }

    expectTypeOf(written).toEqualTypeOf<AssemoraOptions>()
    expectTypeOf(enabled).toEqualTypeOf<AssemoraOptions>()
    expectTypeOf(typo).toEqualTypeOf<AssemoraOptions>()
    expectTypeOf(bare).toEqualTypeOf<AssemoraOptions>()
  })
})
