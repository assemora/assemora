/**
 * Durable work, reached from an application (SPEC.md §82, ADR-0023).
 *
 * The umbrella owes jobs four things, and each of them is a test here: what a command
 * dispatches reaches the adapter the application passed and nothing else; a rolled-back
 * command queues nothing; a process can become a worker without becoming a server; and
 * a worker stops before the database it was using does.
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
  clearRestorers,
  command,
  createLogger,
  dispatch,
  job,
  type Logger,
  type LogRecord,
  module,
  type QueuedJob,
  type QueuePort,
  runJob,
  silentWriter,
} from '@assemora/core'
import { createMemoryAdapter, type DatabaseAdapter } from '@assemora/database'
import { clearRouteRegistry, type HttpServer, type InjectedResponse } from '@assemora/http'
import { clearStorage } from '@assemora/media'
import { uuid } from '@assemora/schema'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { type AssemoraApplication, assemora } from './assemora.js'
import type { AssemoraOptions, JobWorker } from './options.js'

const PAGE = '11111111-1111-4111-8111-111111111111'
const PASSWORD = 'correct horse battery staple'

/** What ran in *this* process, which is exactly what a queue is supposed to prevent. */
let rebuilt: string[] = []

const Rebuild = job('sitemap.rebuild', {
  description: 'Rebuilds the sitemap after a page changes',
  input: { pageId: uuid() },
  handle: async ({ pageId }) => {
    rebuilt.push(pageId)
  },
})

const Publish = command('notes.publish', {
  description: 'Publishes a note',
  input: { id: uuid() },
  handle: async ({ id }) => {
    // SPEC.md §82's own line, written inside a command: held until the commit.
    await dispatch(Rebuild({ pageId: id }))

    return { id }
  },
})

const Refuse = command('notes.refuse', {
  description: 'Dispatches, then changes its mind',
  input: { id: uuid() },
  handle: async ({ id }) => {
    await dispatch(Rebuild({ pageId: id }))

    throw new Error('this command changed its mind')
  },
})

const work = () => module('work').commands(Publish, Refuse).jobs(Rebuild)

type Recording = QueuePort & { readonly pushed: QueuedJob[] }

/** A queue adapter that keeps what it was handed instead of running it. */
const recordingQueue = (): Recording => {
  const pushed: QueuedJob[] = []

  return {
    pushed,
    push: (jobs) => {
      pushed.push(...jobs)

      return Promise.resolve()
    },
  }
}

/** A queue adapter that holds connections, the way the BullMQ one does. */
const closingQueue = (order: string[]): Recording & { close(): Promise<void> } => ({
  ...recordingQueue(),
  close: () => {
    order.push('queue')

    return Promise.resolve()
  },
})

/** A database whose close is observable, so the shutdown order can be asserted. */
const closingDatabase = (order: string[]) => ({
  ...createMemoryAdapter(),
  close: () => {
    order.push('database')

    return Promise.resolve()
  },
})

const quiet: Logger = createLogger(silentWriter)

let running: AssemoraApplication[] = []

const build = (
  options: Omit<AssemoraOptions, 'database'>,
  database: DatabaseAdapter = createMemoryAdapter(),
): AssemoraApplication => {
  const built = assemora({ logger: quiet, ...options, database })

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

/** Signs in and answers with what a browser must send back with a mutation. */
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
    payload: { id: PAGE },
    headers: await asStudio(server),
  })
}

beforeEach(() => {
  clearPolicies()
  clearRouteRegistry()
  clearRestorers()
  clearStorage()
  rebuilt = []
})

afterEach(async () => {
  for (const built of running) await built.shutdown()

  running = []
})

describe('the queue an application passes is the one its commands reach (SPEC.md §82)', () => {
  it('hands a dispatched job to the adapter instead of running it here', async () => {
    const queue = recordingQueue()
    const built = build({ modules: [auth(), work()], jobs: { queue } })

    await built.boot()
    await administrator()

    expect((await send(built, 'notes.publish')).statusCode).toBe(200)

    expect(queue.pushed.map((entry) => entry.name)).toEqual(['sitemap.rebuild'])
    expect(queue.pushed[0]?.payload).toEqual({ pageId: PAGE })
    // Nothing ran in the process that scheduled it, which is the whole point of an
    // adapter: the request returned, and the work is somebody else's now.
    expect(rebuilt).toEqual([])
  })

  it('seals the actor and the request into the envelope, so a worker knows who', async () => {
    const queue = recordingQueue()
    const built = build({ modules: [auth(), work()], jobs: { queue } })

    await built.boot()
    await administrator()
    await send(built, 'notes.publish')

    const [queued] = queue.pushed

    // The job's own writes are authorized as the person whose click scheduled them,
    // and the chain click → command → job shares one request id (SPEC.md §67, §87).
    expect(queued?.actor?.type).toBe('user')
    expect(queued?.dispatchedFrom).toBe('rest')
    expect(queued?.requestId).toEqual(expect.any(String))
  })

  it('queues nothing for a command that rolled back', async () => {
    const queue = recordingQueue()
    const built = build({ modules: [auth(), work()], jobs: { queue } })

    await built.boot()
    await administrator()

    expect((await send(built, 'notes.refuse')).statusCode).toBe(500)

    // A job that reached the queue before the rollback would run against a world that
    // never existed. This is the defect ADR-0023 exists to prevent.
    expect(queue.pushed).toEqual([])
  })

  it('runs jobs in this process when no queue is registered', async () => {
    const built = build({ modules: [auth(), work()] })

    await built.boot()
    await administrator()

    expect((await send(built, 'notes.publish')).statusCode).toBe(200)

    // Core's default, reached through the umbrella. Not a discard: a missing revision
    // is an absence, a missing job is a lie.
    expect(rebuilt).toEqual([PAGE])
  })

  it('says out loud that in-process is not a durable queue', async () => {
    const written: LogRecord[] = []

    build({ modules: [work()], logger: createLogger((record) => written.push(record)) })

    const warning = written.find((record) => record.level === 'warn')

    expect(warning?.message).toContain('inside the process that schedules them')
    expect(warning?.jobs).toEqual(['sitemap.rebuild'])
  })

  it('keeps quiet for an application that declares no jobs at all', async () => {
    const written: LogRecord[] = []

    build({ modules: [auth()], logger: createLogger((record) => written.push(record)) })

    expect(written.filter((record) => record.level === 'warn')).toEqual([])
  })
})

describe('a process becomes a worker by saying so (SPEC.md §82, ADR-0021)', () => {
  const worker = (
    order: string[] = [],
  ): { built: number; stopped: number; make: () => JobWorker } => {
    const counts = { built: 0, stopped: 0, make: () => ({}) as JobWorker }

    counts.make = () => {
      counts.built += 1

      return {
        stop: () => {
          counts.stopped += 1
          order.push('worker')
        },
      }
    }

    return counts
  }

  it('does not build one just because the application booted', async () => {
    const counts = worker()
    const built = build({
      modules: [work()],
      api: false,
      jobs: { queue: recordingQueue(), worker: counts.make },
    })

    await built.boot()

    // `assemora routes` boots this very application to describe it. A read about
    // routes must not attach a consumer to the production queue.
    expect(counts.built).toBe(0)
  })

  it('works without serving, and runs what the queue hands back', async () => {
    const counts = worker()
    const built = build({
      modules: [work()],
      api: false,
      jobs: { queue: recordingQueue(), worker: counts.make },
    })

    await built.work()
    await built.work()

    expect(built.server).toBeUndefined()
    // One worker, however often a process asks — the same bargain `boot()` makes.
    expect(counts.built).toBe(1)

    // What the four-line worker process does with a payload, and all it does.
    await runJob({
      name: 'sitemap.rebuild',
      payload: { pageId: PAGE },
      retries: 3,
      requestId: 'a-request-that-has-long-since-finished',
      dispatchedFrom: 'rest',
    })

    expect(rebuilt).toEqual([PAGE])
  })

  it('serves and works in one process', async () => {
    const counts = worker()
    const built = build({
      modules: [auth(), work()],
      jobs: { queue: recordingQueue(), worker: counts.make },
    })

    const address = await built.listen(0)

    await built.work()

    expect(address).toMatch(/^http:\/\//)
    expect(counts.built).toBe(1)
  })

  it('refuses to work when nothing said how, naming the option', async () => {
    const built = build({ modules: [work()], api: false, jobs: { queue: recordingQueue() } })

    await expect(built.work()).rejects.toThrow(/jobs: \{ queue, worker \}/)
  })

  it('stops the worker, then the queue, then the database', async () => {
    const order: string[] = []
    const counts = worker(order)
    const built = build(
      {
        modules: [work()],
        api: false,
        jobs: { queue: closingQueue(order), worker: counts.make },
      },
      closingDatabase(order),
    )

    await built.work()
    await built.shutdown()

    // A worker stops by refusing new jobs and waiting for the ones already running,
    // and those jobs execute commands. The other order strands a job halfway through,
    // and a queue closed first takes the connection out from under it.
    expect(order).toEqual(['worker', 'queue', 'database'])
    expect(counts.stopped).toBe(1)
  })

  it('closes a queue and a database whose worker was never started', async () => {
    const order: string[] = []
    const built = build(
      { modules: [work()], api: false, jobs: { queue: closingQueue(order) } },
      closingDatabase(order),
    )

    await built.boot()
    await built.shutdown()

    // A process that only serves still opened a producer's connection, and a pool
    // nobody closed outlives the process that forgot it.
    expect(order).toEqual(['queue', 'database'])
  })
})

describe('what an application can schedule is introspectable (SPEC.md §42)', () => {
  it('describes its jobs to the CLI and to the API Explorer', async () => {
    const built = build({ modules: [auth(), work()], api: { introspection: 'public' } })

    await built.boot()

    // The CLI is handed `app`, boots it and reads it (ADR-0021).
    expect(built.app.jobs.names()).toEqual(['sitemap.rebuild'])

    const explorer = await serverOf(built).inject({ method: 'GET', url: '/api/_introspection' })
    const described = explorer.json<Record<string, { name: string }[]>>()

    expect(described.jobs?.map((entry) => entry.name)).toEqual(['sitemap.rebuild'])
  })

  it('does not publish a job as a command endpoint', async () => {
    const built = build({ modules: [auth(), work()] })

    await built.boot()

    // A job is not a command, and an agent cannot dispatch one (ADR-0023). Nothing
    // generates a route or a tool from the jobs section, and this is what says so.
    const missing = await serverOf(built).inject({
      method: 'POST',
      url: '/api/commands/sitemap.rebuild',
      payload: { pageId: PAGE },
    })

    expect(missing.statusCode).toBe(404)
  })
})
