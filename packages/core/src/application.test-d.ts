import { describe, expectTypeOf, it } from 'vitest'

import { createApplication } from './application.js'
import { type ModuleContext, module, type NotStarted } from './module.js'

/**
 * The seam of SPEC.md §88, written the way a module writes it. It compiles, which is
 * the point: a boot hook already has the context, so reporting that it did not start
 * costs it no plumbing at all.
 */
const search = () =>
  module('search').boot((context) => {
    context.cannotStart('The search index has not been built.', {
      remedy: 'Run assemora search:reindex.',
    })
  })

describe('a module that did not start', () => {
  it('is read off the application as a list nothing can edit', () => {
    const app = createApplication({ modules: [search()] })

    expectTypeOf(app.notStarted).toEqualTypeOf<readonly NotStarted[]>()
    expectTypeOf<NotStarted['module']>().toEqualTypeOf<string>()
    expectTypeOf<NotStarted['reason']>().toEqualTypeOf<string>()
    expectTypeOf<NotStarted['remedy']>().toEqualTypeOf<string | undefined>()

    // @ts-expect-error the report is the boot's to write, not a caller's to append to
    app.notStarted.push({ module: 'search', reason: 'no' })
  })

  it('takes a written sentence, and a remedy only if there is one', () => {
    const context = {} as ModuleContext

    expectTypeOf(context.cannotStart).returns.toEqualTypeOf<void>()

    context.cannotStart('The search index has not been built.')

    // @ts-expect-error a reason is the whole point; there is nothing to report without one
    context.cannotStart()

    // @ts-expect-error a caught error is not a sentence, and this body is served to a probe
    context.cannotStart(new Error('relation "assemora_resource_definitions" does not exist'))

    // @ts-expect-error the module is read off the context, never claimed by the caller
    context.cannotStart('It did not start.', { module: 'collections' })

    // @ts-expect-error a remedy is something a person can do, written out
    context.cannotStart('It did not start.', { remedy: 42 })
  })
})
