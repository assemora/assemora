import { string } from '@assemora/schema'
import { describe, expect, it, vi } from 'vitest'

import { createApplication } from './application.js'
import { command } from './commands.js'
import { currentContext } from './context.js'
import { ConfigurationError, ForbiddenError } from './errors.js'
import { createLogger, type LogRecord } from './logger.js'
import { module, type NotStarted } from './module.js'
import { collectAudit, permitAll } from './ports.js'

const Rename = command('blog.rename', {
  input: { title: string().min(2) },
  handle: async ({ title }) => title,
})

describe('application lifecycle', () => {
  it('registers modules before anything boots', () => {
    const app = createApplication({ modules: [module('blog').commands(Rename)] })

    expect(app.modules).toEqual(['blog'])
    expect(app.commands.has('blog.rename')).toBe(true)
  })

  it('runs boot hooks, then ready hooks, in module order', async () => {
    const trace: string[] = []
    const record = (label: string) => () => {
      trace.push(label)
    }

    await createApplication({
      modules: [
        module('first').boot(record('first:boot')).ready(record('first:ready')),
        module('second').boot(record('second:boot')).ready(record('second:ready')),
      ],
    }).boot()

    expect(trace).toEqual(['first:boot', 'second:boot', 'first:ready', 'second:ready'])
  })

  it('shuts modules down in reverse order', async () => {
    const trace: string[] = []
    const record = (label: string) => () => {
      trace.push(label)
    }

    const app = createApplication({
      modules: [
        module('first').shutdown(record('first')),
        module('second').shutdown(record('second')),
      ],
    })

    await app.boot()
    await app.shutdown()

    expect(trace).toEqual(['second', 'first'])
  })

  it('hands each module a context scoped to it', async () => {
    const seen: string[] = []

    await createApplication({
      modules: [
        module('blog').boot((context) => {
          seen.push(context.module)
          expect(context.commands).toBeDefined()
          expect(context.registry).toBeDefined()
        }),
      ],
    }).boot()

    expect(seen).toEqual(['blog'])
  })

  it('refuses to boot twice', async () => {
    const app = createApplication()
    await app.boot()

    await expect(app.boot()).rejects.toThrowError(ConfigurationError)
  })

  it('is safe to shut down twice', async () => {
    const app = createApplication()
    await app.boot()
    await app.shutdown()

    await expect(app.shutdown()).resolves.toBeUndefined()
  })

  it('refuses two modules with the same name', () => {
    expect(() => createApplication({ modules: [module('blog'), module('blog')] })).toThrowError(
      'Module "blog" is registered twice',
    )
  })
})

describe('a module that did not start (SPEC.md §88)', () => {
  it('says nothing when every module started', async () => {
    const app = await createApplication({ modules: [module('blog').boot(() => {})] }).boot()

    expect(app.notStarted).toEqual([])
  })

  it('carries the reason, the remedy and the module that reported them', async () => {
    const app = await createApplication({
      modules: [
        module('collections').boot((context) => {
          context.cannotStart('Its table does not exist yet.', {
            remedy: 'Run assemora db:migrate.',
          })
        }),
      ],
    }).boot()

    expect(app.notStarted).toEqual([
      {
        module: 'collections',
        reason: 'Its table does not exist yet.',
        remedy: 'Run assemora db:migrate.',
      },
    ])
  })

  it('boots anyway, because db:generate boots against a schema that is not applied', async () => {
    const trace: string[] = []

    const app = await createApplication({
      modules: [
        module('collections').boot((context) => {
          context.cannotStart('Its table does not exist yet.')
        }),
        module('blog').boot(() => {
          trace.push('blog')
        }),
      ],
    }).boot()

    // The module behind it still booted, and the registry is readable — which is the
    // whole reason this is a report rather than a throw (ADR-0021).
    expect(trace).toEqual(['blog'])
    expect(app.notStarted).toEqual([
      { module: 'collections', reason: 'Its table does not exist yet.' },
    ])
  })

  it('keeps every reason, from every module and every hook', async () => {
    const app = await createApplication({
      modules: [
        module('collections')
          .boot((context) => {
            context.cannotStart('Its table does not exist yet.')
          })
          .ready((context) => {
            context.cannotStart('And nothing rebuilt the index.')
          }),
        module('search').boot((context) => {
          context.cannotStart('No index has been built.')
        }),
      ],
    }).boot()

    expect(app.notStarted.map((entry) => `${entry.module}: ${entry.reason}`)).toEqual([
      'collections: Its table does not exist yet.',
      'search: No index has been built.',
      'collections: And nothing rebuilt the index.',
    ])
  })

  it('is not the list a caller can edit', async () => {
    const app = await createApplication({
      modules: [
        module('collections').boot((context) => {
          context.cannotStart('Its table does not exist yet.')
        }),
      ],
    }).boot()

    const taken = app.notStarted as NotStarted[]
    taken.length = 0

    expect(app.notStarted).toHaveLength(1)
  })

  it('does not log the line an operator greps for', async () => {
    const records: LogRecord[] = []

    await createApplication({
      logger: createLogger((record) => records.push(record)),
      modules: [
        module('collections').boot((context) => {
          context.cannotStart('Its table does not exist yet.', {
            remedy: 'Run assemora db:migrate.',
          })
        }),
      ],
    }).boot()

    expect(records.map((record) => record.message)).toEqual([
      'Application booted without every module running',
    ])
    expect(records[0]).toMatchObject({
      level: 'warn',
      notStarted: [{ module: 'collections', remedy: 'Run assemora db:migrate.' }],
    })
  })
})

describe('application defaults', () => {
  it('denies every command until authorization is provided', async () => {
    const app = createApplication({ modules: [module('blog').commands(Rename)] })

    await expect(app.commands.execute('blog.rename', { title: 'ok' })).rejects.toThrowError(
      ForbiddenError,
    )
  })

  it('runs commands once a provider is registered', async () => {
    const app = createApplication({
      modules: [module('blog').commands(Rename)],
      authorization: permitAll(),
    })

    await expect(app.commands.execute('blog.rename', { title: 'ok' })).resolves.toBe('ok')
  })

  it('provides a context to everything an operation awaits', async () => {
    const app = createApplication({ authorization: permitAll() })

    const seen = await app.run({ source: 'cli', requestId: 'req-1' }, async () => {
      await Promise.resolve()
      return currentContext()
    })

    expect(seen).toMatchObject({ requestId: 'req-1', source: 'cli' })
  })

  it('carries that context into the audit trail', async () => {
    const audit = collectAudit()
    const app = createApplication({
      modules: [module('blog').commands(Rename)],
      authorization: permitAll(),
      audit,
    })

    await app.run({ source: 'studio', actor: { type: 'user', id: 'u-1' } }, () =>
      app.commands.execute(Rename, { title: 'ok' }),
    )

    expect(audit.entries[0]).toMatchObject({
      action: 'blog.rename',
      source: 'studio',
      actor: { type: 'user', id: 'u-1' },
      outcome: 'succeeded',
    })
  })

  it('writes lifecycle events through the logger it was given', async () => {
    const records: LogRecord[] = []
    const app = createApplication({ logger: createLogger((record) => records.push(record)) })

    await app.boot()
    await app.shutdown()

    expect(records.map((record) => record.message)).toEqual([
      'Application ready',
      'Application stopped',
    ])
  })

  it('stays quiet by default, so importing the kernel prints nothing', () => {
    const write = vi.spyOn(console, 'log').mockImplementation(() => {})

    createApplication().logger.info('ignored')

    expect(write).not.toHaveBeenCalled()
    write.mockRestore()
  })
})
