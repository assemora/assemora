import { boolean, number, string, uuid } from '@assemora/schema'
import { describe, expectTypeOf, it } from 'vitest'

import { createApplication } from './application.js'
import { dispatch, type JobRequest, job } from './jobs.js'
import { module } from './module.js'
import { permitAll } from './ports.js'

const GenerateSitemap = job('sitemap.generate', {
  description: 'Rebuilds the sitemap after a page changes',
  input: { pageId: uuid(), force: boolean().optional() },
  retries: 3,
  handle: async () => undefined,
})

describe('job payload inference', () => {
  it('types the handler payload from the declared shape alone', () => {
    job('probe.run', {
      input: { title: string(), count: number().optional() },
      handle: async (payload) => {
        expectTypeOf(payload).toEqualTypeOf<{ title: string; count?: number }>()
      },
    })
  })

  it('gives the handler a context that can reach the buses', () => {
    job('probe.context', {
      input: {},
      handle: async (_payload, context) => {
        expectTypeOf(context.source).toEqualTypeOf<
          'studio' | 'rest' | 'sdk' | 'mcp' | 'cli' | 'job' | 'internal'
        >()
        expectTypeOf(context.commands.execute).toBeCallableWith('pages.publish', {})
      },
    })
  })

  it('produces what dispatch takes, and dispatch takes nothing else', async () => {
    expectTypeOf(GenerateSitemap({ pageId: 'a' })).toEqualTypeOf<JobRequest>()
    expectTypeOf(dispatch(GenerateSitemap({ pageId: 'a' }))).toEqualTypeOf<Promise<void>>()
  })

  it('is registered by a module the way a command is', () => {
    const app = createApplication({
      authorization: permitAll(),
      modules: [module('pages').jobs(GenerateSitemap)],
    })

    expectTypeOf(app.jobs.names()).toEqualTypeOf<readonly string[]>()
  })
})

describe('invalid usage does not compile', () => {
  it('rejects a payload field of the wrong type', () => {
    // @ts-expect-error — pageId is a string
    GenerateSitemap({ pageId: 42 })
  })

  it('rejects a field the input shape does not declare', () => {
    // @ts-expect-error — there is no `page` in the payload
    GenerateSitemap({ pageId: 'a', page: 'b' })
  })

  it('rejects a payload missing a required field', () => {
    // @ts-expect-error — pageId is required
    GenerateSitemap({ force: true })
  })

  it('rejects a raw payload where a request belongs', async () => {
    // @ts-expect-error — dispatch takes what a definition produced, not a payload
    await dispatch({ pageId: 'a' })
  })
})
