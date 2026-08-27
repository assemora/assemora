import { createLogger, silentWriter } from '@assemora/core'
import { describe, expectTypeOf, it } from 'vitest'

import { clearSlowQueryLog, type SlowQueryLogOptions, useSlowQueryLog } from './slow-queries.js'

const logger = createLogger(silentWriter)

describe('slow query logging (SPEC.md §88)', () => {
  it('takes the logger, and the threshold only when there is a reason to name one', () => {
    expectTypeOf(useSlowQueryLog(logger)).toEqualTypeOf<void>()
    expectTypeOf(useSlowQueryLog(logger, { slowerThanMs: 50 })).toEqualTypeOf<void>()
    expectTypeOf(clearSlowQueryLog()).toEqualTypeOf<void>()
  })

  it('refuses a registration that cannot work', () => {
    // @ts-expect-error the logger is the point: without one there is nowhere to write
    useSlowQueryLog()

    // @ts-expect-error a threshold is a number of milliseconds
    useSlowQueryLog(logger, { slowerThanMs: '50ms' })

    // @ts-expect-error a misspelled option would otherwise switch nothing on in silence
    useSlowQueryLog(logger, { slowerThan: 50 })
  })

  it('describes the threshold and nothing else', () => {
    expectTypeOf<SlowQueryLogOptions>().toEqualTypeOf<{ readonly slowerThanMs?: number }>()
  })
})
