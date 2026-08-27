import { string, uuid } from '@assemora/schema'
import { describe, expect, it, vi } from 'vitest'

import { createApplication } from './application.js'
import { command, createCommandBus } from './commands.js'
import { createContext, runInContext } from './context.js'
import {
  AssemoraError,
  ConfigurationError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
  UnknownCommandError,
  ValidationError,
} from './errors.js'
import { createEventBus } from './events.js'
import { job } from './jobs.js'
import { createLogger, type Logger, type LogRecord, silentWriter } from './logger.js'
import { module } from './module.js'
import {
  type AuditPort,
  CAPTURE_CEILING_MS,
  captureError,
  collectErrors,
  denyAll,
  discardAudit,
  discardRevisions,
  type ErrorReport,
  type ErrorTrackingPort,
  isIncident,
  logErrors,
  permitAll,
  type QueuePort,
  runJobsHere,
} from './ports.js'
import { createQueryBus, query } from './queries.js'
import { createSchemaRegistry } from './registry.js'

const PAGE_ID = '3f2504e0-4f89-41d3-9a0c-0305e82c3301'

/** A logger whose records can be read back, for the default reporter's own tests. */
const recorder = (): { readonly records: LogRecord[]; readonly logger: Logger } => {
  const records: LogRecord[] = []

  return {
    records,
    logger: createLogger((record) => {
      records.push(record)
    }),
  }
}

const harness = (
  overrides: {
    readonly reporter?: ErrorTrackingPort
    readonly logger?: Logger
    readonly audit?: AuditPort
    readonly queue?: QueuePort
  } = {},
) => {
  const logger = overrides.logger ?? createLogger(silentWriter)
  const collected = collectErrors()
  const errors = overrides.reporter ?? collected

  const shared = {
    authorization: permitAll(),
    registry: createSchemaRegistry(),
    logger,
    audit: overrides.audit ?? discardAudit(),
    errors,
  }

  const commands = createCommandBus({
    ...shared,
    transactions: { run: (operation) => operation(), afterCommit: (work) => work() },
    revisions: discardRevisions(),
    events: createEventBus(logger),
    queue: overrides.queue ?? runJobsHere(async () => {}),
  })

  return { commands, queries: createQueryBus(shared), reports: collected.reports }
}

const Explode = command('pages.explode', {
  input: { id: uuid() },
  handle: async ({ id }, context) => {
    context.revise({ entityType: 'page', entityId: id, before: null, after: { id } })
    throw new TypeError('Cannot read properties of undefined')
  },
})

const List = query('pages.list', {
  input: { status: string().optional() },
  handle: async () => {
    throw new Error('the connection pool is exhausted')
  },
})

describe('where the line falls (SPEC.md §88)', () => {
  it('calls a caller-attributable failure what it is: not an incident', () => {
    expect(isIncident(new ValidationError([]))).toBe(false)
    expect(isIncident(new ForbiddenError())).toBe(false)
    expect(isIncident(new NotFoundError('Article', 'a-1'))).toBe(false)
    expect(isIncident(new ConflictError())).toBe(false)
    expect(isIncident(new UnknownCommandError('pages.vanish'))).toBe(false)
  })

  it('treats anything nobody attributed to the caller as an incident', () => {
    expect(isIncident(new TypeError('undefined is not a function'))).toBe(true)
    expect(isIncident(new ConfigurationError('No storage driver is registered'))).toBe(true)
    expect(isIncident(new AssemoraError('DATABASE_ERROR', 'The database rejected it'))).toBe(true)
    expect(isIncident('boom')).toBe(true)
  })

  it('lets a catch hand over whatever it caught, and reports only the incidents', async () => {
    const errors = collectErrors()
    const reporting = { errors, logger: createLogger(silentWriter) }
    const operation = { kind: 'command', name: 'pages.publish' } as const

    await captureError(reporting, new ForbiddenError(), operation)
    await captureError(reporting, new TypeError('boom'), operation)

    expect(errors.reports.map((report) => report.error.message)).toEqual(['boom'])
  })
})

describe('the command pipeline reports what it could not blame the caller for', () => {
  it('captures a handler that threw, and names what it had reached', async () => {
    const { commands, reports } = harness()

    await expect(commands.execute(Explode, { id: PAGE_ID })).rejects.toThrowError(TypeError)

    expect(reports).toHaveLength(1)
    expect(reports[0]?.operation).toMatchObject({
      kind: 'command',
      name: 'pages.explode',
      // §87 asks for entityType and entityId where available, and from the first
      // `revise()` onwards they are — including on the way out through the catch.
      entityType: 'page',
      entityId: PAGE_ID,
    })
    expect(reports[0]?.operation.durationMs).toBeGreaterThanOrEqual(0)
    expect(reports[0]?.error.message).toBe('Cannot read properties of undefined')
    expect(reports[0]?.error.stack).toContain('at ')
  })

  it('carries the context of the request that failed', async () => {
    const { commands, reports } = harness()

    await runInContext(
      createContext({ source: 'mcp', requestId: 'req-9', actor: { type: 'agent', id: 'writer' } }),
      async () => {
        await expect(commands.execute(Explode, { id: PAGE_ID })).rejects.toThrowError(TypeError)
      },
    )

    expect(reports[0]?.context).toMatchObject({
      requestId: 'req-9',
      source: 'mcp',
      actor: { type: 'agent', id: 'writer' },
    })
  })

  it('captures nothing when a command merely fails validation', async () => {
    const { commands, reports } = harness()

    await expect(commands.execute(Explode, { id: 'not-a-uuid' })).rejects.toThrowError(
      ValidationError,
    )

    expect(reports).toEqual([])
  })

  it('captures nothing when the actor was simply not allowed', async () => {
    const errors = collectErrors()
    const logger = createLogger(silentWriter)

    const commands = createCommandBus({
      authorization: denyAll(),
      transactions: { run: (operation) => operation(), afterCommit: (work) => work() },
      revisions: discardRevisions(),
      audit: discardAudit(),
      events: createEventBus(logger),
      queue: runJobsHere(async () => {}),
      registry: createSchemaRegistry(),
      logger,
      errors,
    })

    await expect(commands.execute(Explode, { id: PAGE_ID })).rejects.toThrowError(ForbiddenError)
    expect(errors.reports).toEqual([])
  })

  it('captures nothing when a command succeeds', async () => {
    const { commands, reports } = harness()
    const Publish = command('pages.publish', { input: { id: uuid() }, handle: async () => 'ok' })

    await expect(commands.execute(Publish, { id: PAGE_ID })).resolves.toBe('ok')
    expect(reports).toEqual([])
  })

  it('carries an AssemoraError code and status, and never its details', async () => {
    const { commands, reports } = harness()
    const Fail = command('pages.fail', {
      input: {},
      handle: async () => {
        throw new AssemoraError('DATABASE_ERROR', 'The database rejected the operation', {
          status: 500,
          details: {
            statement: 'select "email" from "users"',
            dsn: 'postgres://ada:hunter2@db/app',
          },
        })
      },
    })

    await expect(commands.execute(Fail, {})).rejects.toThrowError(AssemoraError)

    expect(reports[0]?.code).toBe('DATABASE_ERROR')
    expect(reports[0]?.status).toBe(500)
    // `details` is `unknown`: core cannot know what a handler put in there, so none of
    // it travels rather than some of it being guessed at.
    expect(reports[0]).not.toHaveProperty('details')
    expect(JSON.stringify(reports[0])).not.toContain('hunter2')
  })

  it('strips a secret out of the message on the way to the port', async () => {
    const { commands, reports } = harness()
    const Leak = command('pages.leak', {
      input: {},
      handle: async () => {
        throw new Error('sync failed', {
          cause: new Error(
            'postgres://ada:hunter2@db:5432/app refused: token=ses_7c1e9a, DB_PASSWORD=p4ssw0rd',
          ),
        })
      },
    })

    await expect(commands.execute(Leak, {})).rejects.toThrowError(Error)

    const cause = reports[0]?.error.cause
    expect(cause).toBeInstanceOf(Error)
    expect((cause as Error).message).toContain('db:5432')
    for (const secret of ['hunter2', 'ses_7c1e9a', 'p4ssw0rd']) {
      expect((cause as Error).message).not.toContain(secret)
    }
  })

  it('does not fail the command when the reporter does', async () => {
    const { records, logger } = recorder()
    const broken: ErrorTrackingPort = {
      capture: () => Promise.reject(new Error('https://ada:hunter2@sentry.io is unreachable')),
    }
    const { commands } = harness({ reporter: broken, logger })

    // The caller still sees the error the handler threw, not the reporter's.
    await expect(commands.execute(Explode, { id: PAGE_ID })).rejects.toThrowError(
      'Cannot read properties of undefined',
    )

    expect(records).toContainEqual(
      expect.objectContaining({
        message: 'The error reporter failed',
        reason: 'https://***@sentry.io is unreachable',
      }),
    )

    // And the incident it lost lands in the log anyway, so a broken reporter is not
    // what swallows the error it was installed to catch.
    expect(records).toContainEqual(
      expect.objectContaining({
        message: 'Unhandled failure',
        command: 'pages.explode',
        reason: 'Cannot read properties of undefined',
      }),
    )
  })
})

/**
 * The reporter is on the failure path, and the failure path is where an outage lives.
 *
 * The correlated case is the whole point: the database goes down, every request 500s,
 * and the tracker is the thing being hammered or rate-limiting. A reporter awaited
 * with no ceiling turns that burst into held connections — a `capture` that took three
 * seconds made one failing command over HTTP take six, because it is awaited before
 * the reply is sent and awaited again by the layer above.
 */
describe('how long a failing operation will wait for the reporter', () => {
  it('stops waiting for one that has stopped answering, and writes the incident itself', async () => {
    vi.useFakeTimers()

    try {
      const { records, logger } = recorder()
      let reached: () => void = () => {}
      const called = new Promise<void>((resolve) => {
        reached = resolve
      })

      // A tracker under back-pressure: it will answer, long after anybody cares.
      const stalled: ErrorTrackingPort = {
        capture: () =>
          new Promise((resolve) => {
            reached()
            setTimeout(resolve, 30 * CAPTURE_CEILING_MS)
          }),
      }

      const { commands } = harness({ reporter: stalled, logger })

      const failing = commands.execute(Explode, { id: PAGE_ID })
      let refused: string | undefined
      // Attached before anything is awaited, so the assertion below reads whether the
      // caller has already been answered rather than waiting for it to be.
      const settled = failing.catch((error: unknown) => {
        refused = error instanceof Error ? error.message : String(error)
      })

      await called
      await vi.advanceTimersByTimeAsync(CAPTURE_CEILING_MS)

      expect(refused).toBe('Cannot read properties of undefined')
      expect(records).toContainEqual(
        expect.objectContaining({
          message: 'The error reporter timed out',
          command: 'pages.explode',
        }),
      )
      // And the incident goes to the log, because a reporter that is not answering is
      // not one to trust with the only copy.
      expect(records).toContainEqual(
        expect.objectContaining({
          message: 'Unhandled failure',
          command: 'pages.explode',
          reason: 'Cannot read properties of undefined',
        }),
      )

      await settled
    } finally {
      vi.useRealTimers()
    }
  })

  it('does not give up on a reporter that answers in time', async () => {
    vi.useFakeTimers()

    try {
      const reports: ErrorReport[] = []
      const { records, logger } = recorder()
      const slow: ErrorTrackingPort = {
        capture: (report) =>
          new Promise((resolve) => {
            setTimeout(() => {
              reports.push(report)
              resolve()
            }, CAPTURE_CEILING_MS / 2)
          }),
      }

      const { commands } = harness({ reporter: slow, logger })
      const failing = commands.execute(Explode, { id: PAGE_ID })
      const settled = failing.catch(() => undefined)

      await vi.advanceTimersByTimeAsync(CAPTURE_CEILING_MS)
      await settled

      expect(reports).toHaveLength(1)
      expect(records.map((record) => record.message)).not.toContain('The error reporter timed out')
    } finally {
      vi.useRealTimers()
    }
  })
})

/**
 * What the pipeline's own record-keeping says it was acting on (SPEC.md §87).
 *
 * The audit row and the queue hand-over both happen after the transaction has
 * committed, so neither may fail the command — which makes their log line the only
 * record that they went wrong, and `entityType`/`entityId` the only way to join that
 * line to the page it was about.
 */
describe('the pipeline names what it was acting on when its own bookkeeping fails', () => {
  const Sitemap = job('sitemap.generate', {
    input: { pageId: uuid() },
    handle: async () => undefined,
  })

  const Publish = command('pages.publish', {
    input: { id: uuid() },
    handle: async ({ id }, context) => {
      context.revise({ entityType: 'page', entityId: id, before: null, after: { id } })
      context.dispatch(Sitemap({ pageId: id }))

      return { id }
    },
  })

  it('names it on the audit row it could not write', async () => {
    const { records, logger } = recorder()
    const broken: AuditPort = {
      record: () => Promise.reject(new Error('relation "assemora_audit_log" does not exist')),
    }

    const { commands } = harness({ logger, audit: broken })

    await expect(commands.execute(Publish, { id: PAGE_ID })).resolves.toEqual({ id: PAGE_ID })

    expect(
      records.find((record) => record.message === 'The audit log could not be written'),
    ).toMatchObject({
      command: 'pages.publish',
      entityType: 'page',
      entityId: PAGE_ID,
    })
  })

  it('names it on the jobs it could not queue', async () => {
    const { records, logger } = recorder()
    const unreachable: QueuePort = { push: () => Promise.reject(new Error('redis is asleep')) }

    const { commands } = harness({ logger, queue: unreachable })

    await expect(commands.execute(Publish, { id: PAGE_ID })).resolves.toEqual({ id: PAGE_ID })

    expect(records.find((record) => record.message === 'Jobs could not be queued')).toMatchObject({
      command: 'pages.publish',
      entityType: 'page',
      entityId: PAGE_ID,
      jobs: ['sitemap.generate'],
    })
  })
})

describe('the Query Bus reports the same way', () => {
  it('captures a read that broke', async () => {
    const { queries, reports } = harness()

    await expect(queries.execute(List, {})).rejects.toThrowError('the connection pool is exhausted')

    expect(reports[0]?.operation).toMatchObject({ kind: 'query', name: 'pages.list' })
    expect(reports[0]?.operation.durationMs).toBeGreaterThanOrEqual(0)
  })

  it('captures nothing when the reader was simply not allowed', async () => {
    const errors = collectErrors()

    const queries = createQueryBus({
      authorization: denyAll(),
      registry: createSchemaRegistry(),
      logger: createLogger(silentWriter),
      audit: discardAudit(),
      errors,
    })

    await expect(queries.execute(List, {})).rejects.toThrowError(ForbiddenError)
    expect(errors.reports).toEqual([])
  })
})

describe('the default reporter', () => {
  it('writes the incident to the log, with the fields of SPEC.md §87', async () => {
    const { records, logger } = recorder()
    const error = new Error('boom')
    error.stack = 'Error: boom\n    at publish (/app/pages.ts:12:9)'

    const report: ErrorReport = {
      error,
      code: 'DATABASE_ERROR',
      status: 500,
      context: createContext({ source: 'cli', requestId: 'req-1' }),
      operation: {
        kind: 'command',
        name: 'pages.publish',
        entityType: 'page',
        entityId: PAGE_ID,
        durationMs: 12,
      },
    }

    await logErrors(logger).capture(report)

    expect(records).toEqual([
      expect.objectContaining({
        level: 'error',
        message: 'Unhandled failure',
        command: 'pages.publish',
        reason: 'boom',
        code: 'DATABASE_ERROR',
        entityType: 'page',
        entityId: PAGE_ID,
        durationMs: 12,
        stack: 'Error: boom\n    at publish (/app/pages.ts:12:9)',
      }),
    ])
  })

  it('names the field after what ran, as the child loggers do', async () => {
    const { records, logger } = recorder()

    await logErrors(logger).capture({
      error: new Error('boom'),
      context: createContext({ source: 'rest' }),
      operation: { kind: 'request', name: 'GET /articles/:id' },
    })

    expect(records[0]).toMatchObject({ request: 'GET /articles/:id' })
  })

  it('is what an application gets when it registers nothing', async () => {
    const { records, logger } = recorder()
    const app = createApplication({
      authorization: permitAll(),
      logger,
      modules: [module('pages').commands(Explode)],
    })

    await expect(app.commands.execute('pages.explode', { id: PAGE_ID })).rejects.toThrowError(
      TypeError,
    )

    // Nothing was registered, and the failure is still in the logs the application
    // already had. A default that discarded would have taken it out of them.
    expect(records).toContainEqual(
      expect.objectContaining({ message: 'Unhandled failure', command: 'pages.explode' }),
    )
  })

  it('gives way to the one an application registers, for reads and writes alike', async () => {
    const errors = collectErrors()
    const app = createApplication({
      authorization: permitAll(),
      errors,
      modules: [module('pages').commands(Explode).queries(List)],
    })

    await expect(app.commands.execute('pages.explode', { id: PAGE_ID })).rejects.toThrowError(
      TypeError,
    )
    await expect(app.queries.execute('pages.list', {})).rejects.toThrowError(Error)

    expect(errors.reports.map((report) => report.operation.kind)).toEqual(['command', 'query'])
  })
})
