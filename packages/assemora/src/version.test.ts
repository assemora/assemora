/**
 * A versioned application, end to end (SPEC.md §47).
 *
 * `@assemora/http` cannot prove this on its own: it may not depend on
 * `@assemora/resources` (SPEC.md §8), so its own suite has to hand it a resource
 * description and stub the `entries.*` handlers — and a version that worked against
 * stubs would say nothing about a version that has to pass policies. The umbrella is
 * where the whole stack is legal in one file, so this is where a versioned
 * `/api/v1/notes` is asked to go through the Query Bus, the Command Bus, the policy
 * layer and CSRF exactly as the unversioned one does.
 */
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

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
import { clearRestorers, createLogger, type Logger, module, silentWriter } from '@assemora/core'
import { model, string, uuid } from '@assemora/data'
import { createMemoryAdapter } from '@assemora/database'
import { clearRouteRegistry, type HttpServer, type InjectedResponse, route } from '@assemora/http'
import { clearStorage } from '@assemora/media'
import { clearBlockRegistry } from '@assemora/pages'
import { clearResourceRegistry, resource, select, text } from '@assemora/resources'
import { string as stringSchema } from '@assemora/schema'
import { generateSdk } from '@assemora/sdk'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { type AssemoraApplication, assemora } from './assemora.js'
import type { AssemoraOptions } from './options.js'

const Note = model('notes', {
  id: uuid().primary().defaultRandom(),
  title: string(),
  status: string().default('draft'),
})

const Notes = resource(Note as never, {
  title: text().required().searchable(),
  status: select('draft', 'published').required().filterable(),
})

const notes = () =>
  module('notes')
    .models(Note as never)
    .resources(Notes as never)

/** What v2 answers with instead of the generated listing. */
const listNotesV2 = route.get('/notes', {
  description: 'Lists Notes, the v2 way',
  response: { titles: stringSchema() },
  handler: () => ({ titles: 'the second shape' }),
})

const PASSWORD = 'correct horse battery staple'
const quiet: Logger = createLogger(silentWriter)

let running: AssemoraApplication[] = []

const build = (options: Omit<AssemoraOptions, 'database' | 'logger'>): AssemoraApplication => {
  const built = assemora({ ...options, database: createMemoryAdapter(), logger: quiet })

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

const signIn = (server: HttpServer): Promise<InjectedResponse> =>
  server.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: { email: 'ada@assemora.dev', password: PASSWORD },
  })

const asStudio = (jar: Record<string, string>): Record<string, string> => ({
  cookie: `assemora_session=${jar.assemora_session}; assemora_csrf=${jar.assemora_csrf}`,
  'x-csrf-token': jar.assemora_csrf ?? '',
})

const asReader = (jar: Record<string, string>): Record<string, string> => ({
  cookie: `assemora_session=${jar.assemora_session}`,
})

beforeEach(() => {
  clearPolicies()
  clearResourceRegistry()
  clearRouteRegistry()
  clearRestorers()
  clearBlockRegistry()
  clearStorage()
})

afterEach(async () => {
  for (const built of running) await built.shutdown()

  running = []
})

describe('a version under assemora() (SPEC.md §9, §47)', () => {
  it('serves the versioned resource and nothing at the bare address', async () => {
    const built = build({
      modules: [auth(), notes()],
      api: {
        crud: false,
        versions: {
          v1: (api) => {
            api.resource(Notes)
          },
        },
      },
    })

    await built.boot()
    await administrator()

    const server = serverOf(built)

    // Present and refused, which is the pair §124 promises and §85 requires: a 404
    // would mean the version published nothing, a 200 would mean no authorization.
    expect((await server.inject({ method: 'GET', url: '/api/v1/notes' })).statusCode).toBe(403)
    expect((await server.inject({ method: 'GET', url: '/api/notes' })).statusCode).toBe(404)

    const document = await server.inject({ method: 'GET', url: '/api/openapi.json' })
    const paths = Object.keys(document.json<{ paths: Record<string, unknown> }>().paths)

    expect(paths).toContain('/v1/notes')
    expect(paths).not.toContain('/notes')
  })

  it('creates and reads through the same command and query path the bare one takes', async () => {
    const built = build({
      modules: [auth(), notes()],
      api: {
        crud: false,
        versions: {
          v1: (api) => {
            api.resource(Notes)
          },
        },
      },
    })

    await built.boot()
    await administrator()

    const server = serverOf(built)
    const jar = cookiesOf(await signIn(server))

    const created = await server.inject({
      method: 'POST',
      url: '/api/v1/notes',
      payload: { title: 'Ada writes', status: 'draft' },
      headers: asStudio(jar),
    })

    expect(created.statusCode).toBe(201)

    const id = created.json<{ id: string }>().id
    const read = await server.inject({
      method: 'GET',
      url: `/api/v1/notes/${id}`,
      headers: asReader(jar),
    })

    expect(read.json<{ title: string }>().title).toBe('Ada writes')

    const listed = await server.inject({
      method: 'GET',
      url: '/api/v1/notes',
      headers: asReader(jar),
    })

    expect(listed.json<{ total: number }>().total).toBe(1)

    // The audit log and the revisions ran too: a versioned write is the same write.
    const history = await server.inject({
      method: 'GET',
      url: `/api/queries/revisions.list?entityType=notes&entityId=${id}`,
      headers: asReader(jar),
    })

    expect(history.json<{ data: unknown[] }>().data.length).toBeGreaterThan(0)
  })

  it('still asks a versioned mutation for its CSRF token (SPEC.md §85)', async () => {
    const built = build({
      modules: [auth(), notes()],
      api: {
        crud: false,
        versions: {
          v1: (api) => {
            api.resource(Notes)
          },
        },
      },
    })

    await built.boot()
    await administrator()

    const server = serverOf(built)
    const jar = cookiesOf(await signIn(server))

    const forged = await server.inject({
      method: 'POST',
      url: '/api/v1/notes',
      payload: { title: 'From another site', status: 'draft' },
      headers: asReader(jar),
    })

    expect(forged.statusCode).toBe(403)
    expect(forged.json<{ error: { code: string } }>().error.code).toBe('CSRF_FAILED')
  })

  it('lets one version change a single endpoint of a resource', async () => {
    const built = build({
      modules: [auth(), notes()],
      api: {
        crud: false,
        versions: {
          v1: (api) => {
            api.resource(Notes)
          },
          v2: (api) => {
            api.resource(Notes, { except: ['list'] }).mount(listNotesV2)
          },
        },
      },
    })

    await built.boot()
    await administrator()

    const server = serverOf(built)
    const jar = cookiesOf(await signIn(server))

    const first = await server.inject({
      method: 'GET',
      url: '/api/v1/notes',
      headers: asReader(jar),
    })
    const second = await server.inject({ method: 'GET', url: '/api/v2/notes' })

    expect(first.json<{ total: number }>().total).toBe(0)
    expect(second.json()).toEqual({ titles: 'the second shape' })

    // The four endpoints v2 kept are still generated CRUD, still authorized: an
    // anonymous read of one is refused rather than answered or missing.
    const anonymous = await server.inject({
      method: 'GET',
      url: '/api/v2/notes/00000000-0000-4000-8000-000000000000',
    })

    expect(anonymous.statusCode).toBe(403)
  })

  it('generates an SDK for both versions that actually compiles (SPEC.md §92, §124)', async () => {
    const built = build({
      modules: [auth(), notes()],
      api: {
        crud: false,
        versions: {
          v1: (api) => {
            api.resource(Notes)
          },
          v2: (api) => {
            api.resource(Notes, { except: ['list'] }).mount(listNotesV2)
          },
        },
      },
    })

    await built.boot()

    const source = generateSdk(built.app.registry.describe(), {
      clientModule: join(process.cwd(), 'packages/sdk/dist/index.js'),
    })

    expect(source).toContain('getV1Notes(input: {')
    expect(source).toContain('getV2Notes(): Promise<{')

    const directory = mkdtempSync(join(tmpdir(), 'assemora-versioned-sdk-'))

    writeFileSync(join(directory, 'client.ts'), source, 'utf8')
    writeFileSync(
      join(directory, 'tsconfig.json'),
      JSON.stringify({
        compilerOptions: {
          strict: true,
          noEmit: true,
          module: 'nodenext',
          moduleResolution: 'nodenext',
          target: 'es2023',
          lib: ['es2023', 'dom'],
          skipLibCheck: true,
          types: [],
        },
        include: ['client.ts'],
      }),
      'utf8',
    )

    // No assertion beyond "it did not throw": two versions of one resource are two
    // methods, and a name collision between them would be a compile error right here.
    execFileSync(join(process.cwd(), 'node_modules/.bin/tsc'), ['-p', directory], {
      encoding: 'utf8',
      stdio: 'pipe',
    })
  }, 60_000)

  it('refuses to start when a version collides with an address already served', async () => {
    expect(() =>
      build({
        modules: [auth(), notes()],
        api: {
          // `crud: true` publishes `/api/notes`; the version publishes `/api/v2/notes`,
          // and its own `mount()` wants that same address a second time.
          versions: {
            v2: (api) => {
              api.resource(Notes).mount(listNotesV2)
            },
          },
        },
      }),
    ).toThrow(/Version v2 publishes "get \/v2\/notes" twice/)
  })
})
