import { array, boolean, enumOf, number, string, uuid } from '@assemora/schema'
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

  it('types what execute answers from the declared output, not from the handler', async () => {
    const Archive = command('pages.archive', {
      input: { id: uuid() },
      output: { id: uuid(), archived: boolean() },
      // A model row answers with more than the output names, and that is allowed:
      // the output is what a caller is promised, not everything the handler knows.
      handle: async ({ id }) => ({ id, archived: true, touchedAt: new Date() }),
    })
    const app = createApplication({ authorization: permitAll() })
    const result = await app.commands.execute(Archive, {})

    // Read-only, because an answer is a caller's to read and never to write.
    expectTypeOf(result).toEqualTypeOf<{ readonly id: string; readonly archived: boolean }>()
  })

  it('takes a schema as the output where the answer is not an object', async () => {
    const stored: readonly string[] = ['a', 'b']
    const Ids = command('pages.ids', {
      input: {},
      output: array(uuid()),
      // A row's own array is read-only, and `array()` still describes it.
      handle: async () => stored,
    })
    const app = createApplication({ authorization: permitAll() })

    expectTypeOf(await app.commands.execute(Ids, {})).toEqualTypeOf<readonly string[]>()
  })

  it('refuses a handler that answers something its output does not describe', () => {
    command('pages.archive', {
      input: { id: uuid() },
      output: { id: uuid(), archived: boolean() },
      // @ts-expect-error `archived` is promised and not answered
      handle: async ({ id }) => ({ id }),
    })

    command('pages.count', {
      input: {},
      output: number(),
      // @ts-expect-error a string is not the number the output promised
      handle: async () => 'many',
    })
  })

  it('returns unknown when a command is addressed by name', async () => {
    const app = createApplication({ authorization: permitAll() })
    const result = await app.commands.execute('pages.publish', {})

    expectTypeOf(result).toEqualTypeOf<unknown>()
  })

  it('takes after-commit work that answers nothing, or a promise of nothing', () => {
    command('probe.afterCommit', {
      input: { title: string() },
      handle: async (_input, context) => {
        context.afterCommit(() => undefined)
        context.afterCommit(async () => undefined)

        expectTypeOf(context.afterCommit).returns.toEqualTypeOf<void>()

        return null
      },
    })
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

  it('rejects after-commit work that answers something, which nothing would read', () => {
    command('probe.afterCommitResult', {
      input: { title: string() },
      handle: async (_input, context) => {
        // @ts-expect-error the batch runs after the caller has gone; there is no answer
        // to give it, and a value returned here would be silently dropped.
        context.afterCommit(() => 'registered')
        return null
      },
    })
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
