import { array, boolean, json, string, uuid } from '@assemora/schema'
import { describe, expectTypeOf, it } from 'vitest'

import { createApplication } from './application.js'
import { permitAll } from './ports.js'
import { query } from './queries.js'

describe('query output inference', () => {
  it('types what execute answers from the handler when nothing was declared', async () => {
    const Count = query('pages.count', {
      input: { status: string() },
      handle: async () => 3,
    })
    const app = createApplication({ authorization: permitAll() })

    expectTypeOf(await app.queries.execute(Count, {})).toEqualTypeOf<number>()
  })

  it('types it from the declared output otherwise, shape or schema', async () => {
    const One = query('pages.one', {
      input: { id: uuid() },
      output: { id: uuid(), published: boolean() },
      handle: async ({ id }) => ({ id, published: false, title: 'more than promised' }),
    })
    const Many = query('pages.many', {
      input: {},
      output: array(json<Record<string, unknown>>()),
      handle: async () => [{ id: 'a' }],
    })
    const app = createApplication({ authorization: permitAll() })

    expectTypeOf(await app.queries.execute(One, {})).toEqualTypeOf<{
      readonly id: string
      readonly published: boolean
    }>()
    expectTypeOf(await app.queries.execute(Many, {})).toEqualTypeOf<
      readonly Readonly<Record<string, unknown>>[]
    >()
  })

  it('refuses a handler that answers something its output does not describe', () => {
    query('pages.one', {
      input: { id: uuid() },
      output: { id: uuid(), published: boolean() },
      // @ts-expect-error `published` is promised and not answered
      handle: async ({ id }) => ({ id }),
    })
  })
})
