/**
 * SPEC.md §88, end to end through one call (ADR-0022).
 *
 * The umbrella's claim is that an application which configures nothing is already
 * observable, and that an application which wants Sentry has one place to put it. Both
 * are asserted against a real application over `inject()`, and never against the shape
 * of the object this package returns.
 */
import {
  auth,
  clearPolicies,
  hashPassword,
  Permission,
  Role,
  RolePermission,
  User,
  UserRole,
} from '@assemora/auth'
import {
  captureError,
  clearRestorers,
  collectErrors,
  command,
  createContext,
  createLogger,
  type ErrorTrackingPort,
  type LogRecord,
  module,
  NotFoundError,
  runInContext,
} from '@assemora/core'
import { clearSlowQueryLog, useSlowQueryLog } from '@assemora/data'
import { createMemoryAdapter, type DatabaseAdapter } from '@assemora/database'
import { clearRouteRegistry, type HttpServer, type InjectedResponse, route } from '@assemora/http'
import { clearStorage } from '@assemora/media'
import { uuid } from '@assemora/schema'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { type AssemoraApplication, assemora } from './assemora.js'
import { type AssemoraOptions, resolve } from './options.js'
import { reportedOnce } from './reporting.js'

const NOTE = '11111111-1111-4111-8111-111111111111'
const PASSWORD = 'correct horse battery staple'

/** A defect: nothing has claimed this failure belongs to the caller. */
const Explode = command('notes.explode', {
  description: 'Fails the way a defect fails',
  input: { id: uuid() },
  handle: () => {
    throw new TypeError('cannot read properties of undefined')
  },
})

/** The pipeline doing its job. A 404 is an answer, not an incident. */
const Vanish = command('notes.vanish', {
  description: 'Fails the way a caller’s mistake fails',
  input: { id: uuid() },
  handle: () => {
    throw new NotFoundError('notes', 'nothing here')
  },
})

/** A failure no bus ever saw: the route itself is what threw. */
const leak = route.get('/leak', {
  handler: async () => {
    throw new Error('the upstream refused')
  },
})

const notes = () => module('notes').commands(Explode, Vanish).routes(leak)

/**
 * A module that boots and does not start, so `/ready` refuses for as long as the
 * process lives (ADR-0026). Nothing revokes the report, which is what makes the
 * readiness 503 permanent rather than a boot window.
 */
const stalled = () =>
  module('stalled').boot((context) => {
    context.cannotStart('Its table does not exist yet.', { remedy: 'Run assemora db:migrate.' })
  })

let running: AssemoraApplication[] = []
let written: LogRecord[]

const recording = () =>
  createLogger((record) => {
    written.push(record)
  })

const build = (
  options: Omit<AssemoraOptions, 'database' | 'logger'>,
  database: DatabaseAdapter = createMemoryAdapter(),
): AssemoraApplication => {
  const built = assemora({ ...options, database, logger: recording() })

  running.push(built)

  return built
}

const serverOf = (built: AssemoraApplication): HttpServer => {
  if (built.server === undefined) throw new Error('this application was built without an API')

  return built.server
}

const administrator = async (): Promise<void> => {
  const user = await User.create({
    email: 'ada@assemora.dev',
    name: 'Ada',
    passwordHash: await hashPassword(PASSWORD),
    active: true,
    version: 1,
  })
  const role = await Role.create({ name: 'administrator', label: 'Administrator', version: 1 })
  const everything = await Permission.create({ name: '*', description: null })

  await UserRole.create({ userId: user.id, roleId: role.id })
  await RolePermission.create({ roleId: role.id, permissionId: everything.id })
}

const cookiesOf = (response: InjectedResponse): Record<string, string> => {
  const header = response.headers['set-cookie']
  const all = Array.isArray(header) ? header : [String(header ?? '')]
  const found: Record<string, string> = {}

  for (const line of all) {
    const [pair] = String(line).split(';')
    const [name, ...rest] = (pair ?? '').split('=')

    if (name !== undefined && name !== '') found[name] = decodeURIComponent(rest.join('='))
  }

  return found
}

const asStudio = async (server: HttpServer): Promise<Record<string, string>> => {
  const jar = cookiesOf(
    await server.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'ada@assemora.dev', password: PASSWORD },
    }),
  )

  return {
    cookie: `assemora_session=${jar.assemora_session}; assemora_csrf=${jar.assemora_csrf}`,
    'x-csrf-token': jar.assemora_csrf ?? '',
  }
}

const send = async (built: AssemoraApplication, name: string): Promise<InjectedResponse> => {
  const server = serverOf(built)

  return server.inject({
    method: 'POST',
    url: `/api/commands/${name}`,
    payload: { id: NOTE },
    headers: await asStudio(server),
  })
}

const slowQueries = (): LogRecord[] =>
  written.filter((record) => record.message === 'A query was slower than the threshold')

beforeEach(() => {
  clearPolicies()
  clearRouteRegistry()
  clearRestorers()
  clearStorage()
  clearSlowQueryLog()
  written = []
})

afterEach(async () => {
  for (const built of running) await built.shutdown()

  running = []
  clearSlowQueryLog()
})

describe('an incident reaches the reporter the application named (SPEC.md §88)', () => {
  it('reports one failure once, however many layers it passed on its way out', async () => {
    const errors = collectErrors()
    const built = build({ modules: [auth(), notes()], observability: { errors } })

    await built.boot()
    await administrator()

    expect((await send(built, 'notes.explode')).statusCode).toBe(500)

    // The layer that reported it first is the layer that knows most about it: the
    // command it was, and what it acted on. The server in front of it would add the
    // route and the status, and the request line already carries both under the same
    // request id — so a second report is a second issue in the tracker and a second
    // copy of the same stack, for nothing (SPEC.md §87, §88).
    expect(errors.reports.map((report) => report.operation)).toEqual([
      expect.objectContaining({ kind: 'command', name: 'notes.explode' }),
    ])
    expect(errors.reports[0]?.error.message).toContain('cannot read properties of undefined')
  })

  it('still reports the failure of a route no bus ever saw', async () => {
    const errors = collectErrors()
    const built = build({ modules: [auth(), notes()], observability: { errors } })

    await built.boot()

    expect((await serverOf(built).inject({ method: 'GET', url: '/api/leak' })).statusCode).toBe(500)

    // Nothing else was there to report it, so the layer in front is the only one that
    // can. Suppression is of a *repeat*, never of the only report there is.
    expect(errors.reports.map((report) => report.operation)).toEqual([
      expect.objectContaining({ kind: 'request', name: 'GET /api/leak' }),
    ])
  })

  it('says nothing about a 404, because that is the pipeline working', async () => {
    const errors = collectErrors()
    const built = build({ modules: [auth(), notes()], observability: { errors } })

    await built.boot()
    await administrator()

    expect((await send(built, 'notes.vanish')).statusCode).toBe(404)

    expect(errors.reports).toEqual([])
  })

  /**
   * The endpoint whose 503 is the answer rather than the failure (SPEC.md §88).
   *
   * ADR-0026 made `/api/ready` refuse for as long as a module could not start, and a
   * `readinessProbe` at `periodSeconds: 5` asks about seventeen thousand times a day.
   * Every one of them was an incident: 503 is at or above the line `isIncident` draws,
   * and a tracker fed that page of them hides the 500 that mattered. The condition is
   * permanent by construction and `listen()` already reported it once.
   */
  it('says nothing about a readiness refusal, however often the probe asks', async () => {
    const errors = collectErrors()
    const built = build({ modules: [auth(), notes(), stalled()], observability: { errors } })

    await built.boot()

    const server = serverOf(built)

    for (let probe = 0; probe < 3; probe += 1) {
      const response = await server.inject({ method: 'GET', url: '/api/ready' })

      // Unchanged, which is the other half: it is still a 503 in the envelope of
      // §46, still carrying which module did not start and what to do about it.
      expect(response.statusCode).toBe(503)
      expect(response.json()).toMatchObject({
        error: {
          code: 'NOT_READY',
          message:
            'This application booted, but stalled did not start, so it is not ready to serve.',
          details: {
            notStarted: [
              {
                module: 'stalled',
                reason: 'Its table does not exist yet.',
                remedy: 'Run assemora db:migrate.',
              },
            ],
          },
        },
      })
    }

    expect(errors.reports).toEqual([])
  })

  it('goes on reporting a real 5xx from the application that answers those probes', async () => {
    const errors = collectErrors()
    const built = build({ modules: [auth(), notes(), stalled()], observability: { errors } })

    await built.boot()

    const server = serverOf(built)

    expect((await server.inject({ method: 'GET', url: '/api/ready' })).statusCode).toBe(503)
    expect((await server.inject({ method: 'GET', url: '/api/leak' })).statusCode).toBe(500)

    // One application, two 5xx answers, one incident. What tells them apart is a bit on
    // the error rather than anything switched off here — a route that documents a 502
    // upstream is still a defect, and still reported.
    expect(errors.reports.map((report) => report.operation)).toEqual([
      expect.objectContaining({ kind: 'request', name: 'GET /api/leak' }),
    ])
  })

  it('writes the incident to the application’s own log when nothing was named', async () => {
    const built = build({ modules: [auth(), notes()] })

    await built.boot()
    await administrator()
    await send(built, 'notes.explode')

    const reported = written.filter((record) => record.message === 'Unhandled failure')

    // One record, holding one ~2 kB stack. The default reporter is the application's own
    // log, and a log is not the place to write the same stack down twice either.
    expect(reported.map((record) => record.command ?? record.request)).toEqual(['notes.explode'])
  })
})

/**
 * The rule the wiring above relies on, at its own level.
 *
 * Here rather than only through `inject()` because the case that matters most cannot
 * be produced through one: a single request that failed twice, differently — an agent's
 * batch where two tool calls threw — must still report twice.
 */
describe('one failure is one report, and a different one is not swallowed', () => {
  const reporting = (errors: ErrorTrackingPort) => ({ errors, logger: recording() })

  it('drops the copy the layer further out makes of the same failure', async () => {
    const collected = collectErrors()
    const errors = reportedOnce(collected)
    const failure = new TypeError('cannot read properties of undefined')

    await runInContext(createContext({ source: 'rest', requestId: 'req-1' }), async () => {
      await captureError(reporting(errors), failure, { kind: 'command', name: 'notes.explode' })
      await captureError(reporting(errors), failure, {
        kind: 'request',
        name: 'POST /api/commands',
      })
    })

    expect(collected.reports.map((report) => report.operation.kind)).toEqual(['command'])
  })

  it('reports both when one request failed twice, differently', async () => {
    const collected = collectErrors()
    const errors = reportedOnce(collected)

    await runInContext(createContext({ source: 'mcp', requestId: 'req-2' }), async () => {
      await captureError(reporting(errors), new Error('no such block'), {
        kind: 'command',
        name: 'pages.blocks.add',
      })
      await captureError(reporting(errors), new Error('the tree is frozen'), {
        kind: 'command',
        name: 'pages.blocks.update',
      })
    })

    expect(collected.reports.map((report) => report.operation.name)).toEqual([
      'pages.blocks.add',
      'pages.blocks.update',
    ])
  })

  it('does not offer the copy to a port that has just rejected the original', async () => {
    const attempted: string[] = []
    const errors = reportedOnce({
      capture: async (report) => {
        attempted.push(report.operation.name)

        throw new Error('the tracker is down')
      },
    })
    const failure = new TypeError('cannot read properties of undefined')

    written = []

    await runInContext(createContext({ source: 'rest', requestId: 'req-3' }), async () => {
      await captureError(reporting(errors), failure, { kind: 'command', name: 'notes.explode' })
      await captureError(reporting(errors), failure, {
        kind: 'request',
        name: 'POST /api/commands',
      })
    })

    expect(attempted).toEqual(['notes.explode'])
    // A failure is remembered before it is sent, not after — and nothing is lost by
    // that, because a reporter that threw has already had its fallback.
    expect(written.map((record) => record.message)).toContain('Unhandled failure')
  })

  it('reports every failure outside a request, because there is nothing to group by', async () => {
    const collected = collectErrors()
    const errors = reportedOnce(collected)
    const failure = new Error('the database is unreachable')

    // Two runs of a CLI command that failed the same way are two incidents, and each
    // one builds a context of its own (SPEC.md §12).
    await captureError(reporting(errors), failure, { kind: 'command', name: 'db:migrate' })
    await captureError(reporting(errors), failure, { kind: 'command', name: 'db:migrate' })

    expect(collected.reports).toHaveLength(2)
  })
})

describe('every request writes one line (SPEC.md §88)', () => {
  it('names the method, the route and the status, and nothing that was in the URL', async () => {
    const built = build({ modules: [auth(), notes()] })

    await built.boot()
    await administrator()
    await asStudio(serverOf(built))

    const [line] = written.filter((record) => record.message === 'Request completed')

    expect(line).toMatchObject({
      level: 'info',
      method: 'POST',
      path: '/api/auth/login',
      status: 200,
    })
    expect(typeof line?.durationMs).toBe('number')
    expect(JSON.stringify(written)).not.toContain(PASSWORD)
  })

  it('is switched off by "false" and left on by everything else', async () => {
    expect(resolve({ database: createMemoryAdapter() }).observability.slowRequestMs).toBe(1_000)

    const built = build({ modules: [auth(), notes()], observability: { slowRequestMs: false } })

    await built.boot()
    await administrator()
    await asStudio(serverOf(built))

    expect(written.filter((record) => record.message === 'Request completed')).toEqual([])
  })
})

describe('slow query logging is on without being asked for (SPEC.md §88)', () => {
  it('writes the shape of a query that crossed the threshold, through the application’s logger', async () => {
    const built = build({ modules: [auth(), notes()], observability: { slowQueryMs: 0 } })

    await built.boot()
    await administrator()
    await asStudio(serverOf(built))

    const [first] = slowQueries()

    expect(slowQueries().length).toBeGreaterThan(0)
    expect(first?.level).toBe('warn')
    expect(typeof first?.model).toBe('string')
    expect(typeof first?.durationMs).toBe('number')
  })

  it('never writes down the password or the email a sign-in was looking for', async () => {
    const built = build({ modules: [auth(), notes()], observability: { slowQueryMs: 0 } })

    await built.boot()
    await administrator()
    await asStudio(serverOf(built))

    // The sign-in queries `users` by email and then writes a session row holding a
    // token digest. A slow query log is the file that ends up in a ticket.
    const serialized = JSON.stringify(slowQueries())

    expect(serialized).not.toContain(PASSWORD)
    expect(serialized).not.toContain('ada@assemora.dev')
    expect(serialized).toContain('email =')
  })

  it('writes the session lookup down as part of the request that caused it', async () => {
    const built = build({ modules: [auth(), notes()], observability: { slowQueryMs: 0 } })

    await built.boot()
    await administrator()

    const server = serverOf(built)
    const headers = await asStudio(server)
    const from = written.length

    await server.inject({
      method: 'POST',
      url: '/api/commands/notes.vanish',
      payload: { id: NOTE },
      headers: { ...headers, 'x-request-id': 'req-42' },
    })

    const during = written
      .slice(from)
      .filter((record) => record.message === 'A query was slower than the threshold')

    // Turning a session cookie into an actor is two reads, and they used to run before
    // the request had a context — so "the session lookup is against a database that is
    // down" was the one case in the log that named neither the request nor the client
    // (SPEC.md §87).
    expect(during.map((record) => record.model)).toContain('assemora_sessions')
    expect(during.filter((record) => record.requestId !== 'req-42')).toEqual([])
  })

  it('stays quiet at the default threshold, because nothing here is slow', async () => {
    const built = build({ modules: [auth(), notes()] })

    await built.boot()
    await administrator()
    await asStudio(serverOf(built))

    expect(slowQueries()).toEqual([])
  })

  it('is switched off by "false" and left on by everything else', () => {
    const database = createMemoryAdapter()

    expect(resolve({ database }).observability.slowQueryMs).toBe(200)
    expect(
      resolve({ database, observability: { slowQueryMs: 50 } }).observability.slowQueryMs,
    ).toBe(50)
    expect(
      resolve({ database, observability: { slowQueryMs: false } }).observability.slowQueryMs,
    ).toBe(false)
  })

  it('leaves the process with no query log when it is switched off', async () => {
    // Something else in this process switched it on. The application built next is the
    // one that decides, exactly as it decides which adapter every model reaches.
    useSlowQueryLog(recording(), { slowerThanMs: 0 })

    const built = build({ modules: [auth(), notes()], observability: { slowQueryMs: false } })

    await built.boot()
    await administrator()

    expect(slowQueries()).toEqual([])
  })
})
