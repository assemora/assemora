/**
 * Jobs (SPEC.md §82, ADR-0023).
 *
 * The case that matters most is the rollback: a command that dispatches and then
 * fails must queue nothing, or a worker runs against a world that never existed.
 */

import { string, unknown, uuid } from '@assemora/schema'
import { describe, expect, it } from 'vitest'

import { createApplication } from './application.js'
import { command } from './commands.js'
import { AssemoraError, ValidationError } from './errors.js'
import { dispatch, job, runJob } from './jobs.js'
import { createLogger, type LogRecord } from './logger.js'
import { module } from './module.js'
import { permitAll, type QueuedJob, type QueuePort, type TransactionPort } from './ports.js'

const PAGE_ID = '3f2504e0-4f89-41d3-9a0c-0305e82c3301'

const GenerateSitemap = job('sitemap.generate', {
  description: 'Rebuilds the sitemap after a page changes',
  input: { pageId: uuid() },
  retries: 5,
  handle: async () => undefined,
})

/** A queue that records instead of running, so a test can see what was handed over. */
const recordingQueue = (): QueuePort & { readonly pushed: QueuedJob[] } => {
  const pushed: QueuedJob[] = []

  return {
    pushed,
    push: async (jobs) => {
      pushed.push(...jobs)
    },
  }
}

const recordingLogger = () => {
  const records: LogRecord[] = []

  return {
    records,
    logger: createLogger((record) => {
      records.push(record)
    }),
  }
}

/**
 * A transaction port that has a commit boundary of its own.
 *
 * The fake this suite used before could only fail by the operation throwing, so
 * "just before the commit" and "after it" were the same instant and every mutation
 * of the flush stayed green. This one nests — a second `run` is a savepoint the
 * caller still owns — and it keeps registered work until the outermost one commits,
 * which is the whole property `dataTransactions()` implements for real.
 *
 * One mutable slot rather than AsyncLocalStorage: a test opens one transaction at a
 * time, and the seam under test is the ordering, not the isolation.
 */
const transactions = (): TransactionPort => {
  let pending: (() => Promise<void>)[] | undefined

  const outermost = async <T>(operation: () => Promise<T>, rollback: boolean): Promise<T> => {
    const work: (() => Promise<void>)[] = []
    pending = work

    try {
      const value = await operation()

      // A preview is undone, so nothing registered against it ever runs — and work
      // registered by a *committing* transaction runs with the slot already cleared,
      // because by then there is nothing left to wait for.
      pending = undefined

      if (!rollback) for (const item of work) await item()

      return value
    } finally {
      pending = undefined
    }
  }

  return {
    run: (operation, options) =>
      pending === undefined
        ? outermost(operation, options?.rollback === true)
        : // A nested run is a savepoint: the caller owns the commit, so anything
          // registered inside it goes on waiting for theirs.
          operation(),
    afterCommit: (work) => {
      if (pending === undefined) return work()

      pending.push(work)

      return Promise.resolve()
    },
  }
}

describe('a job definition', () => {
  it('validates the payload where it is written, not where it runs', () => {
    expect(() => GenerateSitemap({ pageId: 'not a uuid' })).toThrow(ValidationError)
  })

  it('names the offending field, like every other validation failure', () => {
    try {
      GenerateSitemap({ pageId: 'not a uuid' })
      expect.unreachable('the payload is invalid')
    } catch (error) {
      expect(error).toBeInstanceOf(ValidationError)
      expect((error as ValidationError).fields).toHaveProperty('pageId')
    }
  })

  it('answers with what dispatch takes, and runs nothing', () => {
    let ran = false

    const Probe = job('probe.run', {
      input: { id: string() },
      handle: async () => {
        ran = true
      },
    })

    expect(Probe({ id: 'a' })).toEqual({ name: 'probe.run', payload: { id: 'a' }, retries: 3 })
    expect(ran).toBe(false)
  })

  it('carries the name, the description and the retries it declared', () => {
    expect(GenerateSitemap.name).toBe('sitemap.generate')
    expect(GenerateSitemap.description).toBe('Rebuilds the sitemap after a page changes')
    expect(GenerateSitemap.retries).toBe(5)
  })

  it('refuses a declared-optional field that was handed an undefined', () => {
    const Optional = job('probe.optional', {
      input: { pageId: uuid(), note: string().optional() },
      handle: async () => undefined,
    })

    // `object().parse` keeps an explicitly-undefined optional key, so the payload
    // leaves here holding a value no wire format has and the queue refuses it after
    // the command has already committed. `exactOptionalPropertyTypes` refuses the
    // literal below, which is why it is written through a wider signature — a spread
    // from a wider type is the shape this actually arrives in.
    const widened = Optional as (payload: { pageId: string; note: string | undefined }) => unknown

    try {
      widened({ pageId: PAGE_ID, note: undefined })
      expect.unreachable('undefined cannot cross a queue')
    } catch (error) {
      expect(error).toBeInstanceOf(ValidationError)
      expect((error as ValidationError).fields).toHaveProperty('note')
    }
  })

  it('names the path when the undefined is buried in the payload', () => {
    const Meta = job('probe.meta', {
      input: { meta: unknown() },
      handle: async () => undefined,
    })

    try {
      Meta({ meta: { tags: ['a', undefined] } })
      expect.unreachable('undefined cannot cross a queue')
    } catch (error) {
      expect((error as ValidationError).fields).toHaveProperty('meta.tags.1')
    }
  })

  it('says nothing about what a codec beyond JSON might carry', () => {
    const Scheduled = job('probe.scheduled', {
      input: { at: unknown() },
      handle: async () => undefined,
    })

    // A Date is not JSON either, and the BullMQ adapter carries one. What a queue can
    // encode is the queue's business; core refuses only what no queue could hold.
    expect(() => Scheduled({ at: new Date(0) })).not.toThrow()
  })
})

describe('a command that dispatches', () => {
  const Publish = command('pages.publish', {
    input: { id: uuid() },
    handle: async ({ id }, context) => {
      context.revise({ entityType: 'page', entityId: id, before: null, after: { id } })
      await dispatch(GenerateSitemap({ pageId: id }))
      return { id }
    },
  })

  const Fail = command('pages.fail', {
    input: { id: uuid() },
    handle: async ({ id }) => {
      await dispatch(GenerateSitemap({ pageId: id }))
      throw new Error('the handler changed its mind')
    },
  })

  const application = (queue: QueuePort) =>
    createApplication({
      authorization: permitAll(),
      transactions: transactions(),
      queue,
      modules: [module('pages').commands(Publish, Fail).jobs(GenerateSitemap)],
    })

  it('queues exactly one job once the transaction commits', async () => {
    const queue = recordingQueue()
    const app = application(queue)

    await app.run({ source: 'studio', actor: { type: 'user', id: 'ada' } }, () =>
      app.commands.execute(Publish, { id: PAGE_ID }),
    )

    expect(queue.pushed).toHaveLength(1)
    expect(queue.pushed[0]).toMatchObject({
      name: 'sitemap.generate',
      payload: { pageId: PAGE_ID },
      retries: 5,
      actor: { type: 'user', id: 'ada' },
      dispatchedFrom: 'studio',
    })
  })

  it('queues nothing when the command throws', async () => {
    const queue = recordingQueue()
    const app = application(queue)

    await expect(
      app.run({ source: 'studio' }, () => app.commands.execute(Fail, { id: PAGE_ID })),
    ).rejects.toThrow('the handler changed its mind')

    expect(queue.pushed).toEqual([])
  })

  it('carries the request id of the operation that scheduled the work', async () => {
    const queue = recordingQueue()
    const app = application(queue)

    await app.run({ source: 'cli', requestId: 'req-1' }, () =>
      app.commands.execute(Publish, { id: PAGE_ID }),
    )

    expect(queue.pushed[0]?.requestId).toBe('req-1')
  })

  it('reaches the same batch through the command context', async () => {
    const queue = recordingQueue()

    const Both = command('pages.both', {
      input: { id: uuid() },
      handle: async ({ id }, context) => {
        context.dispatch(GenerateSitemap({ pageId: id }))
        await dispatch(GenerateSitemap({ pageId: id }))
        return null
      },
    })

    const app = createApplication({
      authorization: permitAll(),
      queue,
      modules: [module('pages').commands(Both).jobs(GenerateSitemap)],
    })

    await app.run({ source: 'rest' }, () => app.commands.execute(Both, { id: PAGE_ID }))

    expect(queue.pushed).toHaveLength(2)
  })

  it('lets a nested command wait for the commit of the one that called it', async () => {
    const queue = recordingQueue()

    const Outer = command('pages.outer', {
      input: {},
      handle: async (_input, context) => {
        await context.execute('pages.publish', { id: PAGE_ID })
        throw new Error('the outer command changed its mind')
      },
    })

    const app = createApplication({
      authorization: permitAll(),
      transactions: transactions(),
      queue,
      modules: [module('pages').commands(Publish, Outer).jobs(GenerateSitemap)],
    })

    await expect(
      app.run({ source: 'studio' }, () => app.commands.execute(Outer, {})),
    ).rejects.toThrow('the outer command changed its mind')

    // The nested command "committed" into a savepoint the outer one then undid.
    expect(queue.pushed).toEqual([])
  })

  it('queues nothing for a nested command whose caller survived its failure', async () => {
    const queue = recordingQueue()

    const Inner = command('pages.inner', {
      input: { id: uuid() },
      handle: async ({ id }, context) => {
        context.dispatch(GenerateSitemap({ pageId: id }))
        throw new Error('the inner command changed its mind')
      },
    })

    const Outer = command('pages.outer', {
      input: { id: uuid() },
      handle: async ({ id }, context) => {
        // An optional step. The outer command decides the failure is survivable and
        // goes on to commit — which is what makes this the hard half: the inner
        // savepoint really was undone, and nothing else in the pipeline survives it.
        try {
          await context.execute('pages.inner', { id })
        } catch {
          // deliberately ignored
        }

        return { id }
      },
    })

    const app = createApplication({
      authorization: permitAll(),
      transactions: transactions(),
      queue,
      modules: [module('pages').commands(Inner, Outer).jobs(GenerateSitemap)],
    })

    await app.run({ source: 'studio' }, () => app.commands.execute(Outer, { id: PAGE_ID }))

    expect(queue.pushed).toEqual([])
  })

  it('queues nothing when the transaction the command ran inside is undone', async () => {
    const queue = recordingQueue()
    const port = transactions()

    const app = createApplication({
      authorization: permitAll(),
      transactions: port,
      queue,
      modules: [module('pages').commands(Publish, Fail).jobs(GenerateSitemap)],
    })

    // No nesting of commands at all: two top-level commands inside somebody else's
    // transaction, the way `transaction()` from `@assemora/data` composes them. The
    // first commits its savepoint and would hand its job over at its own step 6; the
    // second fails, and the outer rollback takes the first one's row with it.
    await expect(
      app.run({ source: 'studio' }, () =>
        port.run(async () => {
          await app.commands.execute(Publish, { id: PAGE_ID })
          await app.commands.execute(Fail, { id: PAGE_ID })
        }),
      ),
    ).rejects.toThrow('the handler changed its mind')

    expect(queue.pushed).toEqual([])
  })

  it('queues once the outermost transaction commits, not before', async () => {
    const queue = recordingQueue()
    const port = transactions()
    const order: string[] = []

    const app = createApplication({
      authorization: permitAll(),
      transactions: port,
      queue: {
        push: async (jobs) => {
          order.push('queue')
          await queue.push(jobs)
        },
      },
      modules: [module('pages').commands(Publish).jobs(GenerateSitemap)],
    })

    await app.run({ source: 'studio' }, () =>
      port.run(async () => {
        await app.commands.execute(Publish, { id: PAGE_ID })
        order.push('still inside the transaction')
      }),
    )

    expect(order).toEqual(['still inside the transaction', 'queue'])
    expect(queue.pushed).toHaveLength(1)
  })

  it('reports a queue it cannot reach without failing a command that committed', async () => {
    const { logger, records } = recordingLogger()

    const app = createApplication({
      authorization: permitAll(),
      logger,
      queue: { push: () => Promise.reject(new Error('redis is asleep')) },
      modules: [module('pages').commands(Publish).jobs(GenerateSitemap)],
    })

    const result = await app.run({ source: 'studio' }, () =>
      app.commands.execute(Publish, { id: PAGE_ID }),
    )

    expect(result).toEqual({ id: PAGE_ID })
    expect(
      records.find(
        (record) => record.level === 'error' && record.message === 'Jobs could not be queued',
      ),
    ).toMatchObject({ reason: 'redis is asleep' })
  })

  it('reports a refusal that will never succeed as the defect it is', async () => {
    const { logger, records } = recordingLogger()

    const app = createApplication({
      authorization: permitAll(),
      logger,
      queue: {
        push: () =>
          Promise.reject(
            new AssemoraError(
              'UNQUEUEABLE_PAYLOAD',
              '"sitemap.generate" cannot be queued: it carries a Map at payload.tags',
              { status: 422 },
            ),
          ),
      },
      modules: [module('pages').commands(Publish).jobs(GenerateSitemap)],
    })

    await app.run({ source: 'studio' }, () => app.commands.execute(Publish, { id: PAGE_ID }))

    // Not an outage. Trying again tomorrow produces the same answer, so calling it
    // "could not be queued" points whoever reads the log at Redis instead of at the
    // payload (ADR-0023: a missing job is a lie).
    expect(records.some((record) => record.message === 'Jobs could not be queued')).toBe(false)
    expect(
      records.find(
        (record) =>
          record.level === 'error' && record.message === 'A job was refused and will never run',
      ),
    ).toMatchObject({ jobs: ['sitemap.generate'] })
  })
})

/**
 * Events share the seam, and shared it the bug.
 *
 * SPEC.md §81 says a listener runs after the command commits. "After the command's
 * own transaction" is not the same sentence when that transaction is a savepoint
 * inside somebody else's: the listener is notified for a change that is then undone,
 * and a cache invalidation or a search index write cannot be taken back either.
 */
describe('an event emitted inside a transaction that is undone', () => {
  const Publish = command('pages.publish', {
    input: { id: uuid() },
    handle: async ({ id }, context) => {
      context.emit('page.published', { pageId: id })
      return { id }
    },
  })

  const Fail = command('pages.fail', {
    input: {},
    handle: async () => {
      throw new Error('the handler changed its mind')
    },
  })

  const application = (port: TransactionPort) =>
    createApplication({
      authorization: permitAll(),
      transactions: port,
      modules: [module('pages').commands(Publish, Fail)],
    })

  it('notifies nobody when the transaction it ran inside rolls back', async () => {
    const port = transactions()
    const app = application(port)
    const notified: unknown[] = []

    app.events.on('page.published', (payload) => {
      notified.push(payload)
    })

    await expect(
      app.run({ source: 'studio' }, () =>
        port.run(async () => {
          await app.commands.execute(Publish, { id: PAGE_ID })
          await app.commands.execute(Fail, {})
        }),
      ),
    ).rejects.toThrow('the handler changed its mind')

    expect(notified).toEqual([])
  })

  it('notifies everybody once that transaction commits', async () => {
    const port = transactions()
    const app = application(port)
    const order: string[] = []

    app.events.on('page.published', () => {
      order.push('listener')
    })

    await app.run({ source: 'studio' }, () =>
      port.run(async () => {
        await app.commands.execute(Publish, { id: PAGE_ID })
        order.push('still inside the transaction')
      }),
    )

    expect(order).toEqual(['still inside the transaction', 'listener'])
  })
})

describe('a dry run', () => {
  const Publish = command('pages.publish', {
    input: { id: uuid() },
    handle: async ({ id }) => {
      await dispatch(GenerateSitemap({ pageId: id }))
      return { id }
    },
  })

  it('dispatches nothing and says what it would have dispatched', async () => {
    const queue = recordingQueue()

    const app = createApplication({
      authorization: permitAll(),
      transactions: transactions(),
      queue,
      modules: [module('pages').commands(Publish).jobs(GenerateSitemap)],
    })

    const preview = await app.run({ source: 'studio' }, () =>
      app.commands.dryRun(Publish, { id: PAGE_ID }),
    )

    expect(preview.jobs).toEqual(['sitemap.generate'])
    expect(queue.pushed).toEqual([])
  })

  it('dispatches nothing even when a real command is the one previewing', async () => {
    const queue = recordingQueue()

    const Propose = command('changes.propose', {
      input: {},
      handle: async (_input, context) =>
        context.preview([{ command: 'pages.publish', input: { id: PAGE_ID } }]),
    })

    const app = createApplication({
      authorization: permitAll(),
      transactions: transactions(),
      queue,
      modules: [module('pages').commands(Publish, Propose).jobs(GenerateSitemap)],
    })

    await app.run({ source: 'mcp' }, () => app.commands.execute(Propose, {}))

    expect(queue.pushed).toEqual([])
  })
})

describe('dispatching outside a command', () => {
  it('hands the job over immediately, because there is no transaction to wait for', async () => {
    const queue = recordingQueue()

    const app = createApplication({
      authorization: permitAll(),
      queue,
      modules: [module('pages').jobs(GenerateSitemap)],
    })

    await app.run({ source: 'cli' }, async () => {
      await dispatch(GenerateSitemap({ pageId: PAGE_ID }))
      expect(queue.pushed).toHaveLength(1)
    })
  })

  it('waits when there is a transaction to wait for after all', async () => {
    const queue = recordingQueue()
    const port = transactions()

    const app = createApplication({
      authorization: permitAll(),
      transactions: port,
      queue,
      modules: [module('pages').jobs(GenerateSitemap)],
    })

    // A script that wrapped its work in `transaction()` has one, and the rule does
    // not change because the dispatch did not come from a command.
    await expect(
      app.run({ source: 'cli' }, () =>
        port.run(async () => {
          await dispatch(GenerateSitemap({ pageId: PAGE_ID }))

          expect(queue.pushed).toEqual([])

          throw new Error('the script changed its mind')
        }),
      ),
    ).rejects.toThrow('the script changed its mind')

    expect(queue.pushed).toEqual([])
  })
})

describe('the in-process default', () => {
  it('runs the job rather than discarding it', async () => {
    const seen: string[] = []

    const Remember = job('sitemap.generate', {
      input: { pageId: uuid() },
      handle: async ({ pageId }) => {
        seen.push(pageId)
      },
    })

    const app = createApplication({
      authorization: permitAll(),
      modules: [module('pages').jobs(Remember)],
    })

    await app.run({ source: 'cli' }, () => dispatch(Remember({ pageId: PAGE_ID })))

    expect(seen).toEqual([PAGE_ID])
  })

  it('restores the actor and the request id, and runs as a worker', async () => {
    const seen: { source: string; requestId: string; actor: string | undefined }[] = []

    const Inspect = job('probe.context', {
      input: {},
      handle: async (_payload, context) => {
        seen.push({
          source: context.source,
          requestId: context.requestId,
          actor: context.actor?.id,
        })
      },
    })

    const app = createApplication({
      authorization: permitAll(),
      modules: [module('probe').jobs(Inspect)],
    })

    await app.run(
      { source: 'studio', requestId: 'req-7', actor: { type: 'user', id: 'ada' } },
      () => dispatch(Inspect({})),
    )

    expect(seen).toEqual([{ source: 'job', requestId: 'req-7', actor: 'ada' }])
  })

  it('gives the handler the buses, so a job can execute a command', async () => {
    const published: string[] = []

    const Publish = command('pages.publish', {
      input: { id: uuid() },
      handle: async ({ id }, context) => {
        published.push(`${id}:${context.source}`)
        return { id }
      },
    })

    const Rebuild = job('sitemap.generate', {
      input: { pageId: uuid() },
      handle: async ({ pageId }, context) => context.commands.execute(Publish, { id: pageId }),
    })

    const app = createApplication({
      authorization: permitAll(),
      modules: [module('pages').commands(Publish).jobs(Rebuild)],
    })

    await app.run({ source: 'studio' }, () => dispatch(Rebuild({ pageId: PAGE_ID })))

    expect(published).toEqual([`${PAGE_ID}:job`])
  })
})

describe('a job that fails', () => {
  const Explode = job('sitemap.generate', {
    input: {},
    handle: async () => {
      throw new Error('the sitemap is on fire')
    },
  })

  it('is loud, and rejects so an adapter can decide to retry', async () => {
    const { logger, records } = recordingLogger()

    const app = createApplication({
      authorization: permitAll(),
      logger,
      modules: [module('pages').jobs(Explode)],
    })

    await app.boot()

    // Asked the way an adapter asks. `runJob` is the whole of what a worker does with
    // a payload, and its rejection is what tells BullMQ to try again — so that is
    // where the contract is proven, rather than through a queue that has to decide
    // separately what a failed job means to whoever dispatched it.
    await expect(
      runJob({
        name: 'sitemap.generate',
        payload: {},
        retries: 0,
        requestId: 'req-1',
        dispatchedFrom: 'cli',
      }),
    ).rejects.toThrow('the sitemap is on fire')

    expect(records.find((record) => record.message === 'Job failed')).toMatchObject({
      level: 'error',
      job: 'sitemap.generate',
      reason: 'the sitemap is on fire',
    })
  })

  it('does not fail whoever dispatched it, because a real queue would not either', async () => {
    const { logger, records } = recordingLogger()

    const app = createApplication({
      authorization: permitAll(),
      logger,
      modules: [module('pages').jobs(Explode)],
    })

    await app.run({ source: 'cli' }, () => dispatch(Explode({})))

    expect(records.find((record) => record.message === 'Job failed')).toMatchObject({
      job: 'sitemap.generate',
      reason: 'the sitemap is on fire',
    })
  })

  it('does not fail the command that scheduled it', async () => {
    const { logger, records } = recordingLogger()

    const Publish = command('pages.publish', {
      input: {},
      handle: async (_input, context) => {
        context.dispatch(Explode({}))
        return { published: true }
      },
    })

    const app = createApplication({
      authorization: permitAll(),
      logger,
      modules: [module('pages').commands(Publish).jobs(Explode)],
    })

    const result = await app.run({ source: 'studio' }, () => app.commands.execute(Publish, {}))

    expect(result).toEqual({ published: true })
    expect(records.some((record) => record.message === 'Job failed')).toBe(true)
    // The job reached the queue and ran. Reporting that as "could not be queued" was
    // false in both directions: it names the wrong subsystem, and it says nothing
    // about which job of the batch actually failed.
    expect(records.some((record) => record.message === 'Jobs could not be queued')).toBe(false)
  })

  it('does not cancel the jobs dispatched after it', async () => {
    const { logger, records } = recordingLogger()
    const ran: string[] = []

    const Boom = job('sitemap.boom', {
      input: {},
      handle: async () => {
        ran.push('boom')
        throw new Error('the sitemap is on fire')
      },
    })

    const Second = job('sitemap.second', {
      input: {},
      handle: async () => {
        ran.push('second')
      },
    })

    const Publish = command('pages.publish', {
      input: {},
      handle: async (_input, context) => {
        context.dispatch(Boom({}), Second({}))
        return { published: true }
      },
    })

    const app = createApplication({
      authorization: permitAll(),
      logger,
      modules: [module('pages').commands(Publish).jobs(Boom, Second)],
    })

    await app.run({ source: 'studio' }, () => app.commands.execute(Publish, {}))

    // Every job gets its turn. One bad job used to abort the loop, and the ones
    // behind it were dropped with no record that they had ever existed.
    expect(ran).toEqual(['boom', 'second'])
    expect(
      records.filter((record) => record.message === 'Job failed').map((record) => record.job),
    ).toEqual(['sitemap.boom'])
  })
})

describe('a worker', () => {
  it('refuses work nothing declares', async () => {
    const app = createApplication({
      authorization: permitAll(),
      modules: [module('pages').jobs(GenerateSitemap)],
    })

    await app.boot()

    await expect(
      runJob({
        name: 'sitemap.rebuild',
        payload: {},
        retries: 0,
        requestId: 'req-1',
        dispatchedFrom: 'studio',
      }),
    ).rejects.toThrow('Job "sitemap.rebuild" is not registered')
  })

  it('refuses a payload the queue handed back that no longer validates', async () => {
    const app = createApplication({
      authorization: permitAll(),
      modules: [module('pages').jobs(GenerateSitemap)],
    })

    await app.boot()

    await expect(
      runJob({
        name: 'sitemap.generate',
        payload: { pageId: 42 },
        retries: 0,
        requestId: 'req-1',
        dispatchedFrom: 'studio',
      }),
    ).rejects.toBeInstanceOf(ValidationError)
  })
})

describe('the registry', () => {
  it('describes what the application can schedule', () => {
    const app = createApplication({
      authorization: permitAll(),
      modules: [module('pages').jobs(GenerateSitemap)],
    })

    expect(app.registry.section('jobs')).toEqual([
      {
        name: 'sitemap.generate',
        description: 'Rebuilds the sitemap after a page changes',
        input: {
          type: 'object',
          properties: { pageId: { type: 'string', format: 'uuid' } },
          required: ['pageId'],
          additionalProperties: false,
        },
        retries: 5,
        module: 'pages',
      },
    ])
  })
})
