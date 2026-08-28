import { createApplication, createLogger, permitAll, silentWriter } from '@assemora/core'
import { describe, expectTypeOf, it } from 'vitest'

import {
  type CrudBuses,
  type CrudLookup,
  type CrudResource,
  crudRoutes,
  publishedOperations,
} from './crud.js'
import type { Route } from './route.js'

const application = createApplication({
  authorization: permitAll(),
  logger: createLogger(silentWriter),
})

const buses: CrudBuses = { commands: application.commands, queries: application.queries }

const Articles: CrudResource = {
  name: 'articles',
  label: 'Articles',
  api: { create: true, read: true, update: true, delete: false },
}

const live: CrudLookup = (name) => (name === Articles.name ? Articles : undefined)

describe('generating CRUD for a resource (SPEC.md §43)', () => {
  it('needs the resources and the buses, and nothing else', () => {
    expectTypeOf(crudRoutes([Articles], buses)).toEqualTypeOf<Route[]>()
  })

  it('takes the two things a caller may say about the endpoints, by name', () => {
    expectTypeOf(crudRoutes([Articles], buses, { operations: ['list'] })).toEqualTypeOf<Route[]>()
    expectTypeOf(crudRoutes([Articles], buses, { current: live })).toEqualTypeOf<Route[]>()
  })

  it('refuses an operation that is not one of the five', () => {
    // @ts-expect-error — the five are the whole vocabulary, and a typo in one used to
    // narrow the generated set to nothing rather than say so.
    crudRoutes([Articles], buses, { operations: ['listing'] })
  })

  it('refuses the bare list of operations the third argument used to be', () => {
    // @ts-expect-error — it is an options object now, because there are two things to
    // say about generated endpoints and a second positional would not read.
    crudRoutes([Articles], buses, ['list'])
  })

  it('refuses a lookup that answers with something other than a resource', () => {
    // @ts-expect-error — what comes back is what the endpoint dispatches on, so it is a
    // description or nothing at all (SPEC.md §37).
    crudRoutes([Articles], buses, { current: (name: string) => name })
  })

  it('names the operations a resource publishes, not booleans', () => {
    expectTypeOf(publishedOperations(Articles)).toEqualTypeOf<
      readonly ('list' | 'get' | 'create' | 'update' | 'delete')[]
    >()
  })
})
