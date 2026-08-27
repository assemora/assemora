import { boolean, enumOf, number, string, uuid } from '@assemora/schema'
import { describe, expectTypeOf, it } from 'vitest'

import { createApplication } from './application.js'
import { command } from './commands.js'
import { createContainer, token } from './container.js'
import { module } from './module.js'
import { permitAll } from './ports.js'
import type { CommandReach } from './registry.js'

const PublishPage = command('pages.publish', {
  input: {
    id: uuid(),
    status: enumOf('draft', 'published'),
    views: number().optional(),
    notify: boolean(),
  },
  handle: async ({ id, status }) => ({ id, status }),
})

describe('command input inference', () => {
  it('types the handler input from the declared shape alone', () => {
    command('probe.run', {
      input: { title: string(), count: number().optional() },
      handle: async (input) => {
        expectTypeOf(input).toEqualTypeOf<{ title: string; count?: number }>()
        return null
      },
    })
  })

  it('narrows an enum field to its literal union', () => {
    command('probe.status', {
      input: { status: enumOf('draft', 'published') },
      handle: async ({ status }) => {
        expectTypeOf(status).toEqualTypeOf<'draft' | 'published'>()
        return null
      },
    })
  })

  it('carries the handler result through execute', async () => {
    const app = createApplication({ authorization: permitAll() })
    const result = await app.commands.execute(PublishPage, {})

    expectTypeOf(result).toEqualTypeOf<{ id: string; status: 'draft' | 'published' }>()
  })

  it('returns unknown when a command is addressed by name', async () => {
    const app = createApplication({ authorization: permitAll() })
    const result = await app.commands.execute('pages.publish', {})

    expectTypeOf(result).toEqualTypeOf<unknown>()
  })

  it('resolves where a command may be called from, declared or not', () => {
    expectTypeOf(PublishPage.reachableFrom).toEqualTypeOf<CommandReach>()

    const SignIn = command('auth.login', {
      reachableFrom: 'its own route',
      input: { email: string() },
      handle: async () => null,
    })

    expectTypeOf(SignIn.reachableFrom).toEqualTypeOf<CommandReach>()
  })
})

describe('container inference', () => {
  it('returns exactly what the token promised', () => {
    const clock = token<{ now(): number }>('clock')
    const container = createContainer()

    expectTypeOf(container.get(clock)).toEqualTypeOf<{ now(): number }>()
  })
})

describe('invalid usage does not compile', () => {
  it('rejects a field the input shape does not declare', () => {
    command('probe.unknown', {
      input: { title: string() },
      handle: async (input) => {
        // @ts-expect-error `subtitle` is not part of the declared input
        input.subtitle
        return null
      },
    })
  })

  it('rejects a shape entry that is not a schema', () => {
    command('probe.bad', {
      // @ts-expect-error an input shape holds schemas, not raw values
      input: { title: 'a string' },
      handle: async () => null,
    })
  })

  it('rejects using an optional input field as if it were present', () => {
    command('probe.optional', {
      input: { count: number().optional() },
      handle: async ({ count }) => {
        // @ts-expect-error the field may be absent, so it is not a number yet
        const doubled: number = count * 2
        return doubled
      },
    })
  })

  it('rejects a mistyped command result', async () => {
    const app = createApplication({ authorization: permitAll() })

    // @ts-expect-error the handler returns an object, not a string
    const wrong: string = await app.commands.execute(PublishPage, {})
    void wrong
  })

  it('rejects a value that does not match its token', () => {
    const clock = token<{ now(): number }>('clock')
    const container = createContainer()

    // @ts-expect-error a number is not a clock
    container.provideValue(clock, 42)
  })

  it('rejects a lifecycle hook that is not callable', () => {
    // @ts-expect-error a hook is a function
    module('blog').boot('later')
  })

  it('rejects a reach nobody defined, so a typo cannot quietly publish a command', () => {
    command('probe.reach', {
      // @ts-expect-error the only restriction is 'its own route'
      reachableFrom: 'route',
      input: { title: string() },
      handle: async () => null,
    })
  })
})
