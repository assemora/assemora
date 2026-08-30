/**
 * What one call has to be worth (SPEC.md §9, §124, ADR-0022).
 *
 * The claim of the umbrella is that a project writes `assemora({…})` and gets a
 * working, secure application. Every test here is one clause of that claim, asserted
 * against a real application over `inject()` — not against the shape of the object
 * this package returns.
 */
import { existsSync } from 'node:fs'
import { mkdtemp, rm, rmdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { AuditLog } from '@assemora/audit'
import {
  auth,
  clearPolicies,
  createAgent,
  hashPassword,
  Permission,
  policy,
  Role,
  RolePermission,
  Session,
  User,
  UserRole,
} from '@assemora/auth'
import {
  clearRestorers,
  createLogger,
  type Logger,
  type LogRecord,
  module,
  silentWriter,
} from '@assemora/core'
import { model, string, uuid } from '@assemora/data'
import {
  createMemoryAdapter,
  type DatabaseAdapter,
  type DatabaseContext,
  schemaNotApplied,
} from '@assemora/database'
import { clearRouteRegistry, type HttpServer, type InjectedResponse } from '@assemora/http'
import { clearStorage, localStorage, media, s3Storage, useStorage } from '@assemora/media'
import { block, clearBlockRegistry, pages } from '@assemora/pages'
import {
  clearResourceRegistry,
  collections,
  ResourceDefinitionModel,
  resource,
  select,
  text,
} from '@assemora/resources'
import { Revision } from '@assemora/revisions'
import { Theme } from '@assemora/theme'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { type AssemoraApplication, assemora } from './assemora.js'
import { type AssemoraOptions, defaultMediaRoot, resolve } from './options.js'

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

/**
 * A module that boots and does not start (SPEC.md §88).
 *
 * The mechanism on its own, with no database in it: what `collections()` does against
 * a schema that has not been applied, and what any later module that has to survive
 * something it cannot work without will do.
 */
const stalled = () =>
  module('stalled').boot((context) => {
    context.cannotStart('Its table does not exist yet.', { remedy: 'Run assemora db:migrate.' })
  })

/** One block type, which is all SPEC.md §124 asks a developer to declare. */
const Hero = block('hero', {
  title: text().required(),
  variant: select('centered', 'split'),
})

const PASSWORD = 'correct horse battery staple'

const quiet: Logger = createLogger(silentWriter)

let running: AssemoraApplication[] = []

/** Every application under test is stopped, so no Fastify instance outlives its test. */
const build = (
  options: Omit<AssemoraOptions, 'database' | 'logger'>,
  database: DatabaseAdapter = createMemoryAdapter(),
): AssemoraApplication => {
  const built = assemora({ ...options, database, logger: quiet })

  running.push(built)

  return built
}

const serverOf = (built: AssemoraApplication) => {
  if (built.server === undefined) throw new Error('this application was built without an API')

  return built.server
}

/** An administrator, the way an application seeds its first one. */
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

/** What a browser has to send with a mutation once it holds a session (SPEC.md §85). */
const asStudio = (jar: Record<string, string>): Record<string, string> => ({
  cookie: `assemora_session=${jar.assemora_session}; assemora_csrf=${jar.assemora_csrf}`,
  'x-csrf-token': jar.assemora_csrf ?? '',
})

/** What it sends when it is only reading: the session, and nothing else. */
const asReader = (jar: Record<string, string>): Record<string, string> => ({
  cookie: `assemora_session=${jar.assemora_session}`,
})

const PNG = [0x89, 0x50, 0x4e, 0x47]

const upload = (server: HttpServer, jar: Record<string, string>): Promise<InjectedResponse> =>
  server.inject({
    method: 'POST',
    url: '/api/commands/media.upload',
    payload: {
      filename: 'dot.png',
      mimeType: 'image/png',
      data: Buffer.from(PNG).toString('base64'),
    },
    headers: asStudio(jar),
  })

const bundle = async (body: string): Promise<string> => {
  const root = await mkdtemp(join(tmpdir(), 'assemora-bundle-'))

  await writeFile(join(root, 'index.html'), body)

  return root
}

const rpc = (id: number, method: string, params: Record<string, unknown> = {}) => ({
  jsonrpc: '2.0',
  id,
  method,
  params,
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

  // The default media directory is under the working directory, which for a test run
  // is the repository. A test that uploads through it leaves nothing behind — and the
  // directory above it goes only if this was the only thing in it.
  await rm(defaultMediaRoot(), { recursive: true, force: true })
  await rmdir(dirname(defaultMediaRoot())).catch(() => undefined)
})

describe('a model and a resource are the whole configuration (SPEC.md §124)', () => {
  it('publishes REST CRUD, OpenAPI, the API Explorer and a registry an SDK can read', async () => {
    const built = build({ modules: [auth(), notes()] })

    await built.boot()
    await administrator()

    const server = serverOf(built)

    // Present, and refused — which is the pair §124 promises and §85 requires. A 404
    // would mean no CRUD; a 200 would mean no authorization.
    const list = await server.inject({ method: 'GET', url: '/api/notes' })

    expect(list.statusCode).toBe(403)

    const document = await server.inject({ method: 'GET', url: '/api/openapi.json' })
    const paths = Object.keys(document.json<{ paths: Record<string, unknown> }>().paths)

    expect(document.statusCode).toBe(200)
    expect(paths).toContain('/notes')
    expect(paths).toContain('/notes/{id}')

    const jar = cookiesOf(await signIn(server))
    const explorer = await server.inject({
      method: 'GET',
      url: '/api/_introspection',
      headers: asReader(jar),
    })
    const described = explorer.json<Record<string, { name: string }[]>>()

    expect(described.resources?.map((entry) => entry.name)).toContain('notes')
    expect(described.routes?.map((entry) => entry.name)).toContain('get /notes')
    expect(described.commands?.map((entry) => entry.name)).toContain('entries.create')

    // The SDK is generated from the same snapshot the explorer just served.
    expect(built.app.registry.describe()).toMatchObject({ resources: expect.anything() })
  })

  it('does not describe itself to a caller it cannot name (SPEC.md §85)', async () => {
    const built = build({ modules: [auth(), notes()] })

    await built.boot()

    const server = serverOf(built)
    const anonymous = await server.inject({ method: 'GET', url: '/api/_introspection' })

    // The snapshot holds every model and every column of the auth schema, the API
    // Explorer that reads it is behind Studio's login, and every other read on this
    // surface denies by default. This one used to be the exception.
    expect(anonymous.statusCode).toBe(401)
    expect(anonymous.body).not.toContain('passwordHash')
  })

  it('describes itself to anybody only for an application that asked for that', async () => {
    const built = build({ modules: [notes()], api: { introspection: 'public' } })

    await built.boot()

    const open = await serverOf(built).inject({ method: 'GET', url: '/api/_introspection' })

    expect(open.statusCode).toBe(200)
    expect(open.json<Record<string, { name: string }[]>>().resources?.[0]?.name).toBe('notes')
  })

  it('refuses a command sent by nobody, so the umbrella did not open the door', async () => {
    const built = build({ modules: [notes()] })

    await built.boot()

    const refused = await serverOf(built).inject({
      method: 'POST',
      url: '/api/commands/entries.create',
      payload: { resource: 'notes', data: { title: 'Anonymous', status: 'draft' } },
    })

    expect(refused.statusCode).toBe(403)
  })

  it('assembles a page from blocks, records every change and undoes it', async () => {
    const built = build({ modules: [auth(), pages({ blocks: [Hero] })] })

    await built.boot()
    await administrator()

    const server = serverOf(built)
    const jar = cookiesOf(await signIn(server))

    const send = (name: string, payload: Record<string, unknown>) =>
      server.inject({
        method: 'POST',
        url: `/api/commands/${name}`,
        payload,
        headers: asStudio(jar),
      })

    // A block a developer declared is a block Studio and an agent can both place.
    expect(
      built.app.registry.describe().blocks?.map((entry) => (entry as { name: string }).name),
    ).toContain('hero')

    const page = (await send('pages.create', { slug: 'home', title: 'Home' })).json<{
      id: string
    }>()

    const added = await send('blocks.add', {
      id: page.id,
      type: 'hero',
      props: { title: 'Welcome', variant: 'centered' },
    })

    expect(added.statusCode).toBe(200)

    const published = await send('pages.publish', { id: page.id })

    expect(published.statusCode).toBe(200)

    const history = await server.inject({
      method: 'GET',
      url: `/api/queries/revisions.list?entityType=pages&entityId=${page.id}`,
      headers: asReader(jar),
    })

    expect(
      history.json<{ data: { command: string }[] }>().data.map((entry) => entry.command),
    ).toEqual(['pages.publish', 'blocks.add', 'pages.create'])

    const undone = await send('revisions.undo', { entityType: 'pages', entityId: page.id })

    expect(undone.statusCode).toBe(200)

    const read = await server.inject({
      method: 'GET',
      url: '/api/queries/pages.get?slug=home&mode=draft',
      headers: asReader(jar),
    })

    expect(read.json<{ status: string }>().status).toBe('draft')
  })
})

describe('signing in (SPEC.md §49, §85)', () => {
  it('answers with an httpOnly session cookie and a readable CSRF cookie', async () => {
    const built = build({ modules: [auth(), notes()] })

    await built.boot()
    await administrator()

    const response = await signIn(serverOf(built))

    expect(response.statusCode).toBe(200)
    expect(response.json<{ csrfToken: string }>().csrfToken).toEqual(expect.any(String))

    const header = response.headers['set-cookie']
    const lines = Array.isArray(header) ? header.map(String) : [String(header)]
    const session = lines.find((line) => line.startsWith('assemora_session='))
    const csrf = lines.find((line) => line.startsWith('assemora_csrf='))

    // The session token is one an injected script must not be able to read; the CSRF
    // token is one the page has to be able to echo back.
    expect(session).toContain('HttpOnly')
    expect(session).toContain('SameSite=Strict')
    expect(csrf).not.toContain('HttpOnly')
  })

  it('marks both cookies Secure, because that is the default and not a guess', async () => {
    const built = build({ modules: [auth(), notes()] })

    await built.boot()
    await administrator()

    const header = (await signIn(serverOf(built))).headers['set-cookie']
    const lines = Array.isArray(header) ? header.map(String) : [String(header)]

    // Not `NODE_ENV === 'production'`: a security default decided by an environment
    // variable is not a default, and the container that forgets to set it is exactly
    // the deployment whose session cookie would then travel in cleartext.
    expect(lines.find((line) => line.startsWith('assemora_session='))).toContain('Secure')
    expect(lines.find((line) => line.startsWith('assemora_csrf='))).toContain('Secure')
  })

  it('drops Secure only for an application that says so out loud', async () => {
    const built = build({ modules: [auth(), notes()], session: { secure: false } })

    await built.boot()
    await administrator()

    const header = (await signIn(serverOf(built))).headers['set-cookie']
    const lines = Array.isArray(header) ? header.map(String) : [String(header)]

    expect(lines.find((line) => line.startsWith('assemora_session='))).not.toContain('Secure')
  })

  it('refuses a cookie-authenticated mutation that does not repeat the CSRF token', async () => {
    const built = build({ modules: [auth(), notes()] })

    await built.boot()
    await administrator()

    const server = serverOf(built)
    const jar = cookiesOf(await signIn(server))
    const create = { resource: 'notes', data: { title: 'From Studio', status: 'draft' } }
    const { 'x-csrf-token': token, ...cookieOnly } = asStudio(jar)

    const forged = await server.inject({
      method: 'POST',
      url: '/api/commands/entries.create',
      payload: create,
      headers: cookieOnly,
    })

    expect(forged.statusCode).toBe(403)
    expect(forged.json()).toMatchObject({ error: { code: 'CSRF_FAILED' } })

    const genuine = await server.inject({
      method: 'POST',
      url: '/api/commands/entries.create',
      payload: create,
      headers: { ...cookieOnly, 'x-csrf-token': token ?? '' },
    })

    expect(genuine.statusCode).toBe(200)
    expect(genuine.json()).toMatchObject({ entry: { title: 'From Studio' } })
  })

  it('says who is asking, and what they may do', async () => {
    const built = build({ modules: [auth(), notes()] })

    await built.boot()
    await administrator()

    const server = serverOf(built)
    const jar = cookiesOf(await signIn(server))

    const me = await server.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: { cookie: `assemora_session=${jar.assemora_session}` },
    })

    expect(me.json()).toMatchObject({ email: 'ada@assemora.dev', permissions: ['*'] })
  })

  it('ends a session, and says so with an expired cookie', async () => {
    const built = build({ modules: [auth(), notes()] })

    await built.boot()
    await administrator()

    const server = serverOf(built)
    const jar = cookiesOf(await signIn(server))

    const out = await server.inject({
      method: 'POST',
      url: '/api/auth/logout',
      headers: asStudio(jar),
    })

    expect(out.statusCode).toBe(200)

    const after = await server.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: { cookie: `assemora_session=${jar.assemora_session}` },
    })

    expect(after.statusCode).toBe(401)
  })
})

describe('one door per session command (SPEC.md §85)', () => {
  it('publishes no raw alias of the login route', async () => {
    const built = build({ modules: [auth(), notes()] })

    await built.boot()
    await administrator()

    const server = serverOf(built)

    // `/auth/login` answers with an httpOnly cookie and a CSRF token, and records the
    // user agent the request actually carried. The generic command endpoint would
    // hand the same session token back as readable JSON, exempt from CSRF because it
    // works as a bearer credential, with the forensic fields chosen by the caller.
    const alias = await server.inject({
      method: 'POST',
      url: '/api/commands/auth.login',
      payload: {
        email: 'ada@assemora.dev',
        password: PASSWORD,
        ipAddress: '10.0.0.1',
        userAgent: 'not really',
      },
    })

    expect(alias.statusCode).toBe(404)

    const logout = await server.inject({
      method: 'POST',
      url: '/api/commands/auth.logout',
      payload: { token: 'anything' },
    })

    expect(logout.statusCode).toBe(404)

    // The hardened route is untouched, and everything else is still published: the
    // generic mount is safe because authorization denies by default, and these two
    // are the exception because they are the two that are publicly authorized.
    expect((await signIn(server)).statusCode).toBe(200)

    const other = await server.inject({
      method: 'POST',
      url: '/api/commands/entries.create',
      payload: { resource: 'notes', data: { title: 'Anonymous', status: 'draft' } },
    })

    expect(other.statusCode).toBe(403)
  })

  it('does not document the alias either', async () => {
    const built = build({ modules: [auth(), notes()] })

    await built.boot()

    const document = await serverOf(built).inject({ method: 'GET', url: '/api/openapi.json' })
    const paths = Object.keys(document.json<{ paths: Record<string, unknown> }>().paths)

    expect(paths).not.toContain('/commands/auth.login')
    expect(paths).toContain('/auth/login')
    expect(paths).toContain('/commands/entries.create')
  })
})

describe('the agent endpoint (SPEC.md §68, §76)', () => {
  it('speaks the protocol to a caller carrying an agent token', async () => {
    const built = build({
      modules: [auth(), notes()],
      mcp: true,
      project: { name: 'demo', version: '2.1.0' },
    })

    await built.boot()

    const agent = await createAgent({ name: 'content-agent', permissions: ['assemora.*'] })
    const server = serverOf(built)
    const headers = { authorization: `Bearer ${agent.token}` }

    const initialized = await server.inject({
      method: 'POST',
      url: '/api/mcp',
      headers,
      payload: rpc(1, 'initialize', {
        protocolVersion: '2025-06-18',
        capabilities: {},
        clientInfo: { name: 'test', version: '1' },
      }),
    })

    expect(initialized.json()).toMatchObject({
      result: { serverInfo: { name: 'demo', version: '2.1.0' } },
    })

    // A notification has no reply, and JSON-RPC says to answer it with nothing.
    const notified = await server.inject({
      method: 'POST',
      url: '/api/mcp',
      headers,
      payload: { jsonrpc: '2.0', method: 'notifications/initialized' },
    })

    expect(notified.statusCode).toBe(202)

    const listed = await server.inject({
      method: 'POST',
      url: '/api/mcp',
      headers,
      payload: rpc(2, 'tools/list'),
    })

    const tools = listed.json<{ result: { tools: { name: string }[] } }>().result.tools

    // Generated from the registry: the resource declared above is already a tool.
    expect(tools.map((tool) => tool.name)).toContain('assemora.entries.create')
  })

  it('counts tool calls against a ceiling, and against the default one by default', async () => {
    // SPEC.md §76 lists rate limits among the seven things a tool call must pass, and
    // the agent-facing half of §85's ceiling had nothing pinning it: raising
    // MCP_RATE_LIMIT to ten million, or handing the endpoint a limiter of its own, left
    // every test in the repository green. Both mutations fail here.
    expect(resolve({ database: createMemoryAdapter(), mcp: true }).mcp?.rateLimit).toEqual({
      max: 120,
      windowMs: 60_000,
    })

    const built = build({
      modules: [auth(), notes()],
      mcp: { rateLimit: { max: 2, windowMs: 60_000 } },
    })

    await built.boot()

    const agent = await createAgent({ name: 'content-agent', permissions: ['assemora.*'] })
    const server = serverOf(built)
    const headers = { authorization: `Bearer ${agent.token}` }

    await server.inject({
      method: 'POST',
      url: '/api/mcp',
      headers,
      payload: rpc(1, 'initialize', {
        protocolVersion: '2025-06-18',
        capabilities: {},
        clientInfo: { name: 'test', version: '1' },
      }),
    })

    const call = async (id: number): Promise<string> => {
      const answered = await server.inject({
        method: 'POST',
        url: '/api/mcp',
        headers,
        payload: rpc(id, 'tools/call', { name: 'assemora.describe', arguments: {} }),
      })

      const result = answered.json<{ result: { isError?: boolean; content: { text: string }[] } }>()
        .result

      return result.isError === true
        ? ((JSON.parse(result.content[0]?.text ?? '{}') as { error?: { code?: string } }).error
            ?.code ?? 'UNKNOWN')
        : 'ok'
    }

    expect([await call(2), await call(3), await call(4)]).toEqual(['ok', 'ok', 'RATE_LIMITED'])
  })

  it('refuses an anonymous caller rather than running its tools as nobody', async () => {
    const built = build({ modules: [auth(), notes()], mcp: true })

    await built.boot()

    const refused = await serverOf(built).inject({
      method: 'POST',
      url: '/api/mcp',
      payload: rpc(1, 'tools/list'),
    })

    expect(refused.statusCode).toBe(401)
  })
})

describe('an MCP mutation is a proposal (SPEC.md §75, ADR-0020)', () => {
  it('answers a mutating tool call with a change set, and leaves production alone', async () => {
    const built = build({ modules: [auth(), notes()], mcp: true })

    await built.boot()

    const agent = await createAgent({
      name: 'content-agent',
      permissions: ['assemora.*', 'notes.create', 'notes.read', 'changesets.propose'],
    })
    const server = serverOf(built)
    const headers = { authorization: `Bearer ${agent.token}` }

    await server.inject({
      method: 'POST',
      url: '/api/mcp',
      headers,
      payload: rpc(1, 'initialize', {
        protocolVersion: '2025-06-18',
        capabilities: {},
        clientInfo: { name: 'test', version: '1' },
      }),
    })

    const called = await server.inject({
      method: 'POST',
      url: '/api/mcp',
      headers,
      payload: rpc(2, 'tools/call', {
        name: 'assemora.entries.create',
        arguments: { resource: 'notes', data: { title: 'From an agent', status: 'draft' } },
      }),
    })

    const answered = called.json<{
      result: { isError?: boolean; content: { text: string }[] }
    }>().result

    expect(answered.isError).not.toBe(true)

    const proposal = JSON.parse(answered.content[0]?.text ?? '{}') as { status?: string }

    // `mutations: 'change-set'` is the default, and it is the whole of SPEC.md §75:
    // production state changes when a person applies the proposal, not before.
    expect(proposal.status).toBe('pending')
    expect(await Note.where('title', 'From an agent').first()).toBeNull()
  })
})

describe('a session command is not an agent tool (SPEC.md §76, §85)', () => {
  /** Everything a real agent does before it can call a tool. */
  const speak = async (built: AssemoraApplication, mutations?: 'direct') => {
    await built.boot()
    await administrator()

    const agent = await createAgent({
      name: 'content-agent',
      // Exactly what `tests/integration/v1.test.ts` grants a content agent, and no
      // auth permission at all.
      permissions: ['assemora.*', 'notes.read', 'changesets.propose'],
    })
    const server = serverOf(built)
    const headers = { authorization: `Bearer ${agent.token}` }

    await server.inject({
      method: 'POST',
      url: '/api/mcp',
      headers,
      payload: rpc(1, 'initialize', {
        protocolVersion: '2025-06-18',
        capabilities: {},
        clientInfo: { name: 'test', version: '1' },
      }),
    })

    const call = async (name: string, args: Record<string, unknown>, id: number) => {
      const answered = await server.inject({
        method: 'POST',
        url: '/api/mcp',
        headers,
        payload: rpc(id, 'tools/call', { name, arguments: args }),
      })

      return answered.json<{ result: { isError?: boolean; content: { text: string }[] } }>().result
    }

    return { server, headers, call, mutations }
  }

  it('does not list it, whatever an agent is allowed to do', async () => {
    const { server, headers } = await speak(build({ modules: [auth(), notes()], mcp: true }))

    const listed = await server.inject({
      method: 'POST',
      url: '/api/mcp',
      headers,
      payload: rpc(2, 'tools/list'),
    })

    const names = listed
      .json<{ result: { tools: { name: string }[] } }>()
      .result.tools.map((tool) => tool.name)

    expect(names).not.toContain('assemora.auth.login')
    expect(names).not.toContain('assemora.auth.logout')
    expect(names).toContain('assemora.entries.create')
  })

  it('answers a right password exactly as it answers a wrong one', async () => {
    const { call } = await speak(build({ modules: [auth(), notes()], mcp: true }))

    const right = await call(
      'assemora.auth.login',
      { email: 'ada@assemora.dev', password: PASSWORD },
      2,
    )
    const wrong = await call(
      'assemora.auth.login',
      { email: 'ada@assemora.dev', password: 'nope' },
      3,
    )

    // The oracle was exactly this difference: a wrong password answered
    // INVALID_CREDENTIALS and a right one answered with a pending change set, at 120
    // guesses a minute, from a credential holding no auth permission.
    expect(right.isError).toBe(true)
    expect(wrong.isError).toBe(true)
    expect(right.content[0]?.text).toContain('UNKNOWN_TOOL')
    expect(right.content[0]?.text).toEqual(wrong.content[0]?.text)
  })

  it('cannot be smuggled in as a proposed command either', async () => {
    const { call } = await speak(build({ modules: [auth(), notes()], mcp: true }))

    // `changesets.propose` takes the name of any command and previews it, so it is a
    // third generic door beside the endpoint and the tool. The preview is refused.
    const proposed = await call(
      'assemora.changesets.propose',
      {
        title: 'nothing to see here',
        commands: [
          { command: 'auth.login', input: { email: 'ada@assemora.dev', password: PASSWORD } },
        ],
      },
      2,
    )

    expect(proposed.isError).toBe(true)
    expect(proposed.content[0]?.text).toContain('UNREACHABLE_COMMAND')
    expect(proposed.content[0]?.text).not.toContain('ses_')
  })

  it('hands a zero-permission agent no session under `mutations: direct` either', async () => {
    const { call } = await speak(
      build({ modules: [auth(), notes()], mcp: { mutations: 'direct' } }),
      'direct',
    )

    const called = await call(
      'assemora.auth.login',
      { email: 'ada@assemora.dev', password: PASSWORD },
      2,
    )

    expect(called.isError).toBe(true)
    // Under `direct` this used to answer with a live administrator session.
    expect(called.content[0]?.text).not.toContain('ses_')
    expect(await Session.count()).toBe(0)
  })

  it('leaves the route that was written for it working', async () => {
    const built = build({ modules: [auth(), notes()], mcp: true })

    await built.boot()
    await administrator()

    const server = serverOf(built)

    const signedIn = await server.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'ada@assemora.dev', password: PASSWORD },
      headers: { 'user-agent': 'Mozilla/5.0 (a real browser)' },
    })

    expect(signedIn.statusCode).toBe(200)

    // Taken off the request, not out of the body: the caller does not get to write
    // the forensic record of its own sign-in (SPEC.md §85).
    expect((await Session.firstOrFail()).userAgent).toBe('Mozilla/5.0 (a real browser)')
  })
})

describe('the allow-list and the log (SPEC.md §85, §67)', () => {
  it('allows the origins it was given, and no others', async () => {
    const built = build({ modules: [notes()], origins: ['http://localhost:5173'] })

    await built.boot()

    const server = serverOf(built)
    const url = '/api/_introspection'

    const allowed = await server.inject({
      method: 'GET',
      url,
      headers: { origin: 'http://localhost:5173' },
    })
    const refused = await server.inject({
      method: 'GET',
      url,
      headers: { origin: 'https://elsewhere.example' },
    })

    expect(allowed.headers['access-control-allow-origin']).toBe('http://localhost:5173')
    expect(allowed.headers['access-control-allow-credentials']).toBe('true')
    expect(refused.headers['access-control-allow-origin']).toBeUndefined()
  })

  it('registers no CORS at all when nothing was allowed', async () => {
    const built = build({ modules: [notes()] })

    await built.boot()

    const response = await serverOf(built).inject({
      method: 'GET',
      url: '/api/_introspection',
      headers: { origin: 'https://elsewhere.example' },
    })

    expect(response.headers['access-control-allow-origin']).toBeUndefined()
  })

  it('records a revision and an audit entry for a write nobody asked it to record', async () => {
    const built = build({ modules: [auth(), notes()] })

    await built.boot()
    await administrator()

    const server = serverOf(built)
    const jar = cookiesOf(await signIn(server))

    const created = await server.inject({
      method: 'POST',
      url: '/api/commands/entries.create',
      payload: { resource: 'notes', data: { title: 'Recorded', status: 'draft' } },
      headers: asStudio(jar),
    })

    expect(created.statusCode).toBe(200)

    const id = created.json<{ entry: { id: string } }>().entry.id

    // The modules alone are not enough: without `revisions: revisions()` and
    // `audit: audit()` the ports discard everything and the tables stay empty.
    expect(await Revision.where('entityType', 'notes').where('entityId', id).first()).not.toBeNull()
    expect(await AuditLog.where('action', 'entries.create').first()).not.toBeNull()
  })
})

describe('liveness and readiness (SPEC.md §88)', () => {
  it('answers a probe before and after the application is ready', async () => {
    const built = build({ modules: [notes()] })
    const server = serverOf(built)

    const starting = await server.inject({ method: 'GET', url: '/api/ready' })

    // Liveness answers before anything has booted; readiness deliberately does not,
    // so nothing routes traffic at an application whose modules are not up.
    expect((await server.inject({ method: 'GET', url: '/api/health' })).statusCode).toBe(200)
    expect(starting.statusCode).toBe(503)
    expect(starting.json()).toMatchObject({ error: { code: 'NOT_READY' } })

    await built.boot()

    const ready = await server.inject({ method: 'GET', url: '/api/ready' })

    expect(ready.statusCode).toBe(200)
    expect(ready.json()).toMatchObject({ status: 'ready' })
  })

  it('never reports ready when a module did not start, and says which and why', async () => {
    const built = build({ modules: [notes(), stalled()] })
    const server = serverOf(built)

    await built.boot()

    // The process is up: it listens, it serves Studio, it answers OpenAPI. That is
    // liveness, and restarting it would fix nothing.
    expect((await server.inject({ method: 'GET', url: '/api/health' })).statusCode).toBe(200)

    const response = await server.inject({ method: 'GET', url: '/api/ready' })

    // And it is not ready, which is the half that used to answer 200 while every data
    // request answered 503 — so a probe routed production traffic at it.
    expect(response.statusCode).toBe(503)
    expect(response.json()).toMatchObject({
      error: {
        code: 'NOT_READY',
        message: 'This application booted, but stalled did not start, so it is not ready to serve.',
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
  })

  it('names every module that did not start, in a sentence', async () => {
    const also = (name: string) =>
      module(name).boot((context) => {
        context.cannotStart('It has nothing to read yet.')
      })

    const built = build({ modules: [stalled(), also('search'), also('sitemap')] })

    await built.boot()

    const response = await serverOf(built).inject({ method: 'GET', url: '/api/ready' })

    // Three of them, and a person still reads one sentence. The details carry the rest.
    expect(response.json()).toMatchObject({
      error: {
        message:
          'This application booted, but stalled, search and sitemap did not start, so it is not ready to serve.',
      },
    })
  })

  it('names a module once however many times it reported', async () => {
    // Core keeps a reason from every hook on purpose, and a module may fail at two
    // different things — but the sentence is about the application, not about how many
    // times it said so.
    const twice = module('archive')
      .boot((context) => {
        context.cannotStart('Its table does not exist yet.')
      })
      .ready((context) => {
        context.cannotStart('Its index was never built.')
      })

    const built = build({ modules: [twice] })

    await built.boot()

    const response = await serverOf(built).inject({ method: 'GET', url: '/api/ready' })
    const body = response.json() as {
      error: { message: string; details: { notStarted: readonly unknown[] } }
    }

    expect(body.error.message).toBe(
      'This application booted, but archive did not start, so it is not ready to serve.',
    )
    // Both reasons survive: the sentence is deduplicated, the account is not.
    expect(body.error.details.notStarted).toHaveLength(2)
  })

  it('is the answer an unmigrated database gets, end to end', async () => {
    const definitions = ResourceDefinitionModel.table
    const base = createMemoryAdapter()

    // A database that has been created and never migrated: the tables are not there,
    // and `assemora db:migrate` is what puts them there (ADR-0021).
    const unmigrated: DatabaseAdapter = {
      execute: (query, context) =>
        query.model === definitions
          ? Promise.reject(schemaNotApplied(definitions))
          : base.execute(query, context),
      transaction: (callback) => base.transaction(callback),
      introspect: () => base.introspect(),
    }

    const built = build({ modules: [collections()] }, unmigrated)

    await built.boot()

    const response = await serverOf(built).inject({ method: 'GET', url: '/api/ready' })

    expect(response.statusCode).toBe(503)
    expect(response.json()).toMatchObject({
      error: {
        code: 'NOT_READY',
        details: { notStarted: [{ module: 'collections', remedy: 'Run assemora db:migrate.' }] },
      },
    })
  })

  it('says so in the log of the one process for which it is fatal', async () => {
    const records: LogRecord[] = []
    const built = assemora({
      modules: [stalled()],
      database: createMemoryAdapter(),
      logger: createLogger((record) => records.push(record)),
    })

    running.push(built)

    await built.listen(0, '127.0.0.1')

    // Core warns that a module did not start, because it cannot tell `db:generate`
    // from a deployment. `listen()` is the caller that can, and for it the consequence
    // is a process that serves and is never routed traffic — which nobody should have
    // to discover from a load balancer.
    expect(records).toContainEqual(
      expect.objectContaining({
        level: 'error',
        message: 'This application is serving but will not report ready',
        endpoint: '/api/ready',
      }),
    )
  })
})

describe('serving Studio (SPEC.md §58, ADR-0022)', () => {
  it('names the package to install when it is not there', async () => {
    const built = build({ modules: [auth(), notes()], studio: true })

    await expect(built.boot()).rejects.toThrow(/@assemora\/studio/)
  })

  it('serves a bundle beside the API, on one origin', async () => {
    const root = await bundle('<!doctype html><title>Studio</title>')
    const built = build({ modules: [auth(), notes()], studio: { root } })

    await built.boot()

    const server = serverOf(built)
    const entry = await server.inject({ method: 'GET', url: '/studio' })
    const deep = await server.inject({ method: 'GET', url: '/studio/pages/42' })

    expect(entry.statusCode).toBe(200)
    expect(entry.body).toContain('<title>Studio</title>')
    // Studio routes in the browser, so an unknown path is the entry document.
    expect(deep.body).toContain('<title>Studio</title>')

    // Assets are not endpoints, so they are not described in OpenAPI.
    const document = await server.inject({ method: 'GET', url: '/api/openapi.json' })

    expect(Object.keys(document.json<{ paths: object }>().paths)).not.toContain('/studio')
  })

  it('refuses to be asked for without the module it signs in through', () => {
    expect(() => build({ modules: [notes()], studio: true })).toThrow(/auth\(\)/)
  })
})

describe('the frontend the builder canvas frames (SPEC.md §59, §85)', () => {
  it('serves it at the origin root, and lets the origins it named frame it', async () => {
    const root = await bundle('<!doctype html><title>Preview</title>')
    const built = build({
      modules: [notes()],
      frontend: { root, framedBy: ['http://localhost:5173'] },
    })

    await built.boot()

    const page = await serverOf(built).inject({ method: 'GET', url: '/preview' })

    expect(page.statusCode).toBe(200)
    expect(page.headers['content-security-policy']).toContain(
      "frame-ancestors 'self' http://localhost:5173",
    )
  })

  it('does not let an origin frame Studio because it may call the API', async () => {
    const root = await bundle('<!doctype html><title>Preview</title>')
    const studio = await bundle('<!doctype html><title>Studio</title>')
    const built = build({
      modules: [auth(), notes()],
      studio: { root: studio },
      frontend: { root },
      // Allowed to call the API, and nothing more. Who may frame the logged-in admin
      // UI is a different permission, and it is not this one.
      origins: ['https://partner.example'],
    })

    await built.boot()

    const page = await serverOf(built).inject({ method: 'GET', url: '/studio' })
    const policyHeader = String(page.headers['content-security-policy'])

    expect(policyHeader).toContain("frame-ancestors 'self'")
    expect(policyHeader).not.toContain('partner.example')
  })

  it('lets nothing frame an application that serves no frontend', async () => {
    const built = build({ modules: [notes()] })

    await built.boot()

    const response = await serverOf(built).inject({ method: 'GET', url: '/api/_introspection' })

    expect(response.headers['content-security-policy']).toContain("frame-ancestors 'none'")
  })

  it('refuses "*" rather than producing a policy open to everybody', () => {
    expect(() => build({ modules: [notes()], origins: ['*'] })).toThrow(/not an origin/)
  })

  it('lets the browser render the images the media driver hands out (SPEC.md §63)', async () => {
    const built = build({
      modules: [auth(), media(), notes()],
      media: {
        storage: s3Storage({
          bucket: 'assets',
          region: 'auto',
          accessKeyId: 'AKIAEXAMPLE',
          secretAccessKey: 'not-a-real-key',
          publicUrl: 'https://cdn.example.com/files',
        }),
      },
    })

    await built.boot()

    const response = await serverOf(built).inject({ method: 'GET', url: '/api/health' })
    const policy = String(response.headers['content-security-policy'])

    // S3 is mandatory in v1 and its URLs are not this origin, so `img-src 'self'`
    // alone blocks every image in Studio and in the preview. The origin is not an
    // option somebody types: it is read off the driver this application configured,
    // which is why it cannot become a way to open the policy generally.
    expect(policy).toContain("img-src 'self' data: blob: https://cdn.example.com")
    expect(policy).toContain("media-src 'self' https://cdn.example.com")
    expect(policy).toContain("script-src 'self';")
    expect(policy).not.toContain("script-src 'self' https://cdn.example.com")
  })

  it('keeps the narrow policy when the files are served from this origin', async () => {
    const root = await mkdtemp(join(tmpdir(), 'assemora-media-'))
    const built = build({ modules: [auth(), media(), notes()], media: { root } })

    await built.boot()

    const response = await serverOf(built).inject({ method: 'GET', url: '/api/health' })

    // `media: { root }` serves from `<prefix>/media`, which `'self'` already covers.
    expect(String(response.headers['content-security-policy'])).toContain(
      "img-src 'self' data: blob:;",
    )
  })

  it('refuses an origin that would add directives to the policy', async () => {
    const root = await bundle('<!doctype html><title>Preview</title>')

    expect(() =>
      build({
        modules: [notes()],
        frontend: { root, framedBy: ['https://studio.example; script-src *'] },
      }),
    ).toThrow(/scheme:\/\/host/)
  })
})

describe('media (SPEC.md §63)', () => {
  it('serves an uploaded file from the very URL the library handed out', async () => {
    const root = await mkdtemp(join(tmpdir(), 'assemora-media-'))
    const built = build({ modules: [auth(), media(), notes()], media: { root } })

    await built.boot()
    await administrator()

    const server = serverOf(built)
    const jar = cookiesOf(await signIn(server))
    const uploaded = await upload(server, jar)

    expect(uploaded.statusCode).toBe(200)

    // The driver's `baseUrl` and the mounted route have to be the same string, or
    // every image Studio renders is a 404. Following the URL is how that is proved.
    const url = uploaded.json<{ url: string }>().url

    expect(url.startsWith('/api/media/')).toBe(true)

    const file = await server.inject({ method: 'GET', url, headers: asReader(jar) })

    expect(file.statusCode).toBe(200)
    expect(file.headers['content-type']).toContain('image/png')
    expect([...file.rawBody]).toEqual(PNG)
  })

  it('leaves a storage driver the application registered itself alone', async () => {
    const root = await mkdtemp(join(tmpdir(), 'assemora-media-'))

    useStorage(localStorage({ root, baseUrl: 'https://cdn.example/files' }))

    const built = build({ modules: [auth(), media(), notes()] })

    await built.boot()
    await administrator()

    const server = serverOf(built)
    const uploaded = await upload(server, cookiesOf(await signIn(server)))

    // Omitting `media` means the umbrella never called `useStorage`, so the URLs stay
    // the ones this application's own driver decided on.
    expect(uploaded.json<{ url: string }>().url.startsWith('https://cdn.example/files/')).toBe(true)
  })

  it('serves a file a browser must not render as a download', async () => {
    const root = await mkdtemp(join(tmpdir(), 'assemora-media-'))
    const built = build({ modules: [auth(), media(), notes()], media: { root } })

    await built.boot()
    await administrator()

    const server = serverOf(built)
    const jar = cookiesOf(await signIn(server))

    const uploaded = await server.inject({
      method: 'POST',
      url: '/api/commands/media.upload',
      payload: {
        filename: 'payload.html',
        mimeType: 'text/html',
        data: Buffer.from('<script>alert(1)</script>').toString('base64'),
      },
      headers: asStudio(jar),
    })

    const file = await server.inject({
      method: 'GET',
      url: uploaded.json<{ url: string }>().url,
      headers: asReader(jar),
    })

    // An upload must not become a page on this origin (SPEC.md §85).
    expect(file.headers['content-type']).toContain('application/octet-stream')
    expect(file.headers['content-disposition']).toContain('attachment')
    expect(file.headers['x-content-type-options']).toBe('nosniff')
  })
})

describe('a photograph fits through the upload (SPEC.md §63, §85)', () => {
  /** Bigger than the 1 MiB every other address keeps, and smaller than the default. */
  const photograph = Buffer.alloc(3 * 1024 * 1024, 0x7f).toString('base64')

  it('accepts one, because the upload endpoint is sized for a file', async () => {
    const root = await mkdtemp(join(tmpdir(), 'assemora-media-'))
    const built = build({ modules: [auth(), media(), notes()], media: { root } })

    await built.boot()
    await administrator()

    const server = serverOf(built)
    const jar = cookiesOf(await signIn(server))

    const uploaded = await server.inject({
      method: 'POST',
      url: '/api/commands/media.upload',
      payload: { filename: 'pizza.jpg', mimeType: 'image/jpeg', data: photograph },
      headers: asStudio(jar),
    })

    expect(uploaded.statusCode).toBe(200)
  })

  it('refuses one at every other command, which is why the ceiling is not the server', async () => {
    const root = await mkdtemp(join(tmpdir(), 'assemora-media-'))
    const built = build({ modules: [auth(), media(), notes()], media: { root } })

    await built.boot()
    await administrator()

    const server = serverOf(built)
    const jar = cookiesOf(await signIn(server))

    const refused = await server.inject({
      method: 'POST',
      url: '/api/commands/entries.create',
      payload: { resource: 'notes', values: { title: photograph } },
      headers: asStudio(jar),
    })

    expect(refused.statusCode).toBe(413)
    expect(refused.json<{ error: { code: string } }>().error.code).toBe('PAYLOAD_TOO_LARGE')
  })

  it('is the application to set, when 16 MiB is the wrong number', async () => {
    const root = await mkdtemp(join(tmpdir(), 'assemora-media-'))
    const built = build({
      modules: [auth(), media(), notes()],
      media: { root, maxUploadBytes: 1024 },
    })

    await built.boot()
    await administrator()

    const server = serverOf(built)
    const jar = cookiesOf(await signIn(server))

    const refused = await server.inject({
      method: 'POST',
      url: '/api/commands/media.upload',
      payload: { filename: 'pizza.jpg', mimeType: 'image/jpeg', data: photograph },
      headers: asStudio(jar),
    })

    expect(refused.statusCode).toBe(413)
  })
})

describe('the bytes pass the policy the library passes (SPEC.md §51, §63)', () => {
  /** A library an application decided to keep behind a policy. */
  const closed = () => auth({ policies: [policy('media', { read: () => false })] })

  const stored = async (server: HttpServer, jar: Record<string, string>) => {
    const uploaded = await upload(server, jar)

    return uploaded.json<{ id: string; url: string }>()
  }

  it('refuses a caller the media policy refuses, at every door on to the file', async () => {
    const root = await mkdtemp(join(tmpdir(), 'assemora-media-'))
    const built = build({ modules: [closed(), media(), notes()], media: { root } })

    await built.boot()
    await administrator()

    const server = serverOf(built)
    const file = await stored(server, cookiesOf(await signIn(server)))

    // The three doors on to one file have to agree. The query was already right; the
    // two byte routes read the model directly and answered 200 to anybody.
    const asked = await server.inject({
      method: 'GET',
      url: `/api/queries/media.get?id=${file.id}`,
    })
    const byPath = await server.inject({ method: 'GET', url: file.url })
    const byId = await server.inject({ method: 'GET', url: `/api/media/by-id/${file.id}` })

    expect(asked.statusCode).toBe(403)
    expect(byPath.statusCode).toBe(403)
    expect(byId.statusCode).toBe(403)
  })

  it('says the same thing about a file that is not there', async () => {
    const root = await mkdtemp(join(tmpdir(), 'assemora-media-'))
    const built = build({ modules: [closed(), media(), notes()], media: { root } })

    await built.boot()

    // 403 rather than 404: a caller who may not read the library does not get to
    // learn which ids it holds. `/queries/media.get` answers the same way.
    const byId = await serverOf(built).inject({
      method: 'GET',
      url: `/api/media/by-id/${crypto.randomUUID()}`,
    })

    expect(byId.statusCode).toBe(403)
  })

  it('serves the same bytes to a caller it allows', async () => {
    const root = await mkdtemp(join(tmpdir(), 'assemora-media-'))
    const built = build({ modules: [closed(), media(), notes()], media: { root } })

    await built.boot()
    await administrator()

    const server = serverOf(built)
    const jar = cookiesOf(await signIn(server))
    const file = await stored(server, jar)

    // The administrator holds `*`, so the permission answers before the policy does.
    const byPath = await server.inject({ method: 'GET', url: file.url, headers: asReader(jar) })
    const byId = await server.inject({
      method: 'GET',
      url: `/api/media/by-id/${file.id}`,
      headers: asReader(jar),
    })

    expect(byPath.statusCode).toBe(200)
    expect([...byPath.rawBody]).toEqual(PNG)
    expect(byId.statusCode).toBe(200)
    expect([...byId.rawBody]).toEqual(PNG)
  })

  it('is a 404 for a storage path the library never handed out', async () => {
    const root = await mkdtemp(join(tmpdir(), 'assemora-media-'))
    const built = build({ modules: [auth(), media(), notes()], media: { root } })

    await built.boot()
    await administrator()

    const server = serverOf(built)
    const jar = cookiesOf(await signIn(server))

    const missing = await server.inject({
      method: 'GET',
      url: '/api/media/2026/08/nothing.png',
      headers: asReader(jar),
    })

    expect(missing.statusCode).toBe(404)
  })
})

describe('the theme, served (SPEC.md §62, ADR-0024)', () => {
  /** What a `<link rel="stylesheet">` in a built document actually does. */
  const load = async (server: HttpServer): Promise<InjectedResponse> => {
    const pointer = await server.inject({ method: 'GET', url: '/api/theme.css' })

    expect(pointer.statusCode).toBe(302)
    expect(pointer.headers['cache-control']).toBe('no-store')

    return server.inject({ method: 'GET', url: String(pointer.headers.location) })
  }

  const setBrand = (server: HttpServer, jar: Record<string, string>, colour: string) =>
    server.inject({
      method: 'POST',
      url: '/api/commands/theme.update',
      payload: { colors: { brand: colour } },
      headers: asStudio(jar),
    })

  it('serves the tokens as a stylesheet, at a URL that is its own version', async () => {
    const built = build({ modules: [notes()] })

    await built.boot()

    const server = serverOf(built)
    const stylesheet = await load(server)

    expect(stylesheet.statusCode).toBe(200)
    expect(stylesheet.headers['content-type']).toBe('text/css; charset=utf-8')
    // Immutable is a promise about a URL, and it is only honest because the URL is
    // the hash of what it answers with.
    expect(stylesheet.headers['cache-control']).toBe('public, max-age=31536000, immutable')
    expect(stylesheet.body).toContain('--space-xl:')
    expect(stylesheet.body).toContain('.assemora-design[data-width="narrow"]')
  })

  it('sends a page somewhere else the moment a token changes', async () => {
    const built = build({ modules: [auth(), notes()] })

    await built.boot()
    await administrator()

    const server = serverOf(built)
    const jar = cookiesOf(await signIn(server))
    const before = await server.inject({ method: 'GET', url: '/api/theme.css' })

    expect((await setBrand(server, jar, '#0f766e')).statusCode).toBe(200)

    const after = await server.inject({ method: 'GET', url: '/api/theme.css' })

    // The whole point of the pair: the document never changed, and it is now pointing
    // at a different stylesheet.
    expect(after.headers.location).not.toBe(before.headers.location)
    expect((await load(server)).body).toContain('--brand: #0f766e;')
  })

  it('sends a stale version on to the current one rather than lying about it', async () => {
    const built = build({ modules: [auth(), notes()] })

    await built.boot()
    await administrator()

    const server = serverOf(built)
    const jar = cookiesOf(await signIn(server))
    const stale = String(
      (await server.inject({ method: 'GET', url: '/api/theme.css' })).headers.location,
    )

    await setBrand(server, jar, '#0f766e')

    const asked = await server.inject({ method: 'GET', url: stale })

    expect(asked.statusCode).toBe(302)
    expect(asked.headers.location).not.toBe(stale)
    expect(asked.headers['cache-control']).toBe('no-store')
  })

  it('is a document a browser on this origin is allowed to load (SPEC.md §85)', async () => {
    const built = build({ modules: [notes()] })

    await built.boot()

    const stylesheet = await load(serverOf(built))

    // `style-src 'self'` is what lets the page use it, and the stylesheet is served
    // from the very origin that sent the policy — so nothing here has to be widened.
    expect(String(stylesheet.headers['content-security-policy'])).toContain(
      "style-src 'self' 'unsafe-inline'",
    )
  })

  it('still serves one for an application with no theme to edit', async () => {
    const built = build({ modules: [notes()], theme: false })

    await built.boot()

    const server = serverOf(built)
    const stylesheet = await load(server)

    expect(stylesheet.statusCode).toBe(200)
    expect(stylesheet.body).toContain('--space-xl:')
    // Nothing to edit, and nothing that could have edited it.
    expect(built.app.registry.find('commands', 'theme.update')).toBeUndefined()
  })

  it('does not open the document to everybody in order to serve the stylesheet', async () => {
    const built = build({ modules: [auth(), notes()] })

    await built.boot()

    const server = serverOf(built)

    expect((await load(server)).statusCode).toBe(200)
    // The overrides, the edit counter and when it was last touched are not public,
    // and the route that hands over the CSS is what keeps them from having to be.
    expect((await server.inject({ method: 'GET', url: '/api/queries/theme.get' })).statusCode).toBe(
      403,
    )
  })

  it('serves the defaults when the theme cannot be read at all', async () => {
    // The failure this is about is a project that upgrades: `theme: true` is the
    // default, so its schema gained a table, and until `assemora db:migrate` has run
    // the row cannot be read. Every site's own stylesheet has stopped carrying
    // `--space-*`, `--ink` and the block rules of §61, so a 500 here is not a missing
    // feature — it is an unstyled site. `css.ts` argues the rule this applies:
    // dropping what will not render degrades a page, and a stylesheet that fails
    // takes it down.
    const base = createMemoryAdapter()
    const unmigrated: DatabaseAdapter = {
      execute: <T>(query: Parameters<DatabaseAdapter['execute']>[0], context: DatabaseContext) =>
        query.model === Theme.table
          ? Promise.reject(new Error('relation "assemora_theme" does not exist'))
          : base.execute<T>(query, context),
      transaction: (callback) => base.transaction(callback),
      introspect: () => base.introspect(),
    }

    const built = build({ modules: [notes()] }, unmigrated)

    await built.boot()

    const stylesheet = await load(serverOf(built))

    expect(stylesheet.statusCode).toBe(200)
    expect(stylesheet.body).toContain('--brand: #4a5ed6;')
    expect(stylesheet.body).toContain('.assemora-design[data-width="narrow"]')
  })
})

describe('every switch removes exactly what it names', () => {
  it('builds no server at all when the API is off', async () => {
    const built = build({ modules: [notes()], api: false })

    await built.boot()

    expect(built.server).toBeUndefined()
    await expect(built.listen()).rejects.toThrow(/api: false/)
  })

  it('drops generated CRUD but keeps the commands behind it', async () => {
    const built = build({ modules: [notes()], api: { crud: false } })

    await built.boot()

    const server = serverOf(built)

    await expect(
      server.inject({ method: 'GET', url: '/api/notes' }).then((r) => r.statusCode),
    ).resolves.toBe(404)

    // A resource is still reachable the way Studio and an agent reach it.
    await expect(
      server
        .inject({ method: 'POST', url: '/api/commands/entries.create', payload: {} })
        .then((r) => r.statusCode),
    ).resolves.not.toBe(404)
  })

  it('stops publishing the API’s own description when documentation is off', async () => {
    const built = build({ modules: [notes()], api: { documentation: false } })

    await built.boot()

    const server = serverOf(built)

    await expect(
      server.inject({ method: 'GET', url: '/api/openapi.json' }).then((r) => r.statusCode),
    ).resolves.toBe(404)
    await expect(
      server.inject({ method: 'GET', url: '/api/_introspection' }).then((r) => r.statusCode),
    ).resolves.toBe(404)
  })

  it('leaves no agent endpoint and no agent queries when MCP is off', async () => {
    const built = build({ modules: [auth(), notes()] })

    await built.boot()

    const refused = await serverOf(built).inject({ method: 'POST', url: '/api/mcp', payload: {} })

    expect(refused.statusCode).toBe(404)
    expect(built.app.registry.find('queries', 'assemora.describe')).toBeUndefined()
    expect(built.app.modules).not.toContain('mcp')
  })

  it('adds revisions, audit, change sets and a theme that nobody asked for', async () => {
    const built = build({ modules: [notes()] })

    expect(built.app.modules).toEqual(['notes', 'revisions', 'audit', 'changesets', 'theme'])
  })

  it('takes them away again when they are switched off', () => {
    const built = build({
      modules: [notes()],
      revisions: false,
      audit: false,
      changeSets: false,
      theme: false,
    })

    expect(built.app.modules).toEqual(['notes'])
  })

  it('never registers a module the application listed itself twice', () => {
    const built = build({ modules: [auth(), notes()], mcp: true })

    expect(built.app.modules).toEqual([
      'auth',
      'notes',
      'revisions',
      'audit',
      'changesets',
      'theme',
      'mcp',
    ])
  })
})

describe('what the CLI is handed (ADR-0021)', () => {
  it('reaches a complete registry without booting anything', () => {
    const built = build({ modules: [notes()] })

    // Registration is synchronous, so `assemora routes` can describe an application
    // without opening a socket.
    expect(built.app.registry.find('resources', 'notes')).toBeDefined()
    expect(built.app.registry.find('commands', 'entries.create')).toBeDefined()
  })

  it('boots once, however often it is asked to', async () => {
    const built = build({ modules: [notes()] })

    const [first, second] = await Promise.all([built.boot(), built.boot()])

    expect(first).toBe(second)
    expect(first).toBe(built.app)
  })

  it('is the same boot whichever half of the handle is asked', async () => {
    const root = await bundle('<!doctype html><title>Studio</title>')
    const built = build({ modules: [auth(), notes()], studio: { root } })

    // The config hands the CLI the application and the CLI boots it (ADR-0021),
    // while `src/server.ts` calls `listen()`, which boots as well. Two paths on to
    // one boot: the second must not be refused, and the first must not leave an
    // application with no Studio and no explanation.
    const booted = await built.app.boot()

    await expect(built.boot()).resolves.toBe(booted)

    const entry = await serverOf(built).inject({ method: 'GET', url: '/studio' })

    expect(entry.statusCode).toBe(200)
  })

  it('closes the database even when something else fails to stop', async () => {
    let closed = false
    // A pool that outlives the process that forgot it is the failure being tested.
    const database = {
      ...createMemoryAdapter(),
      close: () => {
        closed = true

        return Promise.resolve()
      },
    }

    const stubborn = module('stubborn').shutdown(() => {
      throw new Error('this module did not stop')
    })

    const built = build({ modules: [notes(), stubborn] }, database)

    await built.boot()

    // A step that throws must not take the connection pool with it, and must not
    // leave the handle marked stopped without having stopped anything.
    await expect(built.shutdown()).rejects.toThrow(/did not stop/)
    expect(closed).toBe(true)
  })
})

describe('a configuration that cannot work is refused where it was written', () => {
  it('accepts media() when the application registered a driver itself', async () => {
    const root = await mkdtemp(join(tmpdir(), 'assemora-media-'))

    useStorage(localStorage({ root, baseUrl: 'https://cdn.example/files' }))

    expect(() => build({ modules: [auth(), media(), notes()] })).not.toThrow()
  })

  it('refuses Studio and the frontend on the same path', async () => {
    const root = await bundle('<!doctype html><title>Both</title>')

    expect(() =>
      build({
        modules: [auth(), notes()],
        studio: { root, path: '/app' },
        frontend: { root, path: '/app' },
      }),
    ).toThrow(/\/app/)
  })

  it('refuses media URLs that would point at routes nobody mounted', async () => {
    const root = await mkdtemp(join(tmpdir(), 'assemora-media-'))

    expect(() => build({ modules: [media(), notes()], api: false, media: { root } })).toThrow(
      /api: false/,
    )
  })

  it('refuses the default media directory too when there is no route to serve it', () => {
    // The same URLs, and the same reason: `media()` with nothing said about storage
    // now builds a local driver whose URLs point at `<prefix>/media`, which "api:
    // false" does not mount.
    expect(() => build({ modules: [media(), notes()], api: false })).toThrow(/api: false/)
  })
})

describe('the configuration SPEC.md §9 writes, written exactly as §9 writes it', () => {
  it('builds, boots and stores a file, with nothing said about where the bytes go', async () => {
    // §9 is "the reference against which architectural decisions are made", and this
    // package exists to implement it (ADR-0022). Listing media() among the modules and
    // passing no second "media" option is how §9 writes it, so it has to work: local
    // storage is mandatory in v1 (SPEC.md §63), and a project directory is where a
    // CMS keeps it until somebody says otherwise.
    const built = build({
      modules: [auth(), pages({ blocks: [Hero] }), media(), notes()],
      // §9 writes `studio: true`, which resolves the published bundle at boot; this
      // repository deliberately does not install it, so the bundle is named here and
      // the clause under test — media() with nothing said about storage — is untouched.
      studio: { root: await bundle('<!doctype html><title>Studio</title>') },
      api: true,
      mcp: true,
    })

    await built.boot()
    await administrator()

    const server = serverOf(built)
    const jar = cookiesOf(await signIn(server))
    const uploaded = await upload(server, jar)

    expect(uploaded.statusCode).toBe(200)

    const url = uploaded.json<{ url: string }>().url

    expect(url.startsWith('/api/media/')).toBe(true)

    const file = await server.inject({ method: 'GET', url, headers: asReader(jar) })

    expect(file.statusCode).toBe(200)
    expect([...file.rawBody]).toEqual(PNG)

    // Written where the umbrella said it would be, and not anywhere else.
    expect(existsSync(join(defaultMediaRoot(), url.replace('/api/media/', '')))).toBe(true)
  })

  it('says out loud that the bytes are on a disk this process happens to have', () => {
    const written: { message: string; fields: unknown }[] = []
    const noticed: Logger = {
      ...quiet,
      warn: (message, fields) => written.push({ message, fields }),
    }

    running.push(
      assemora({
        modules: [auth(), media(), notes()],
        database: createMemoryAdapter(),
        logger: noticed,
      }),
    )

    // A container replaces that directory on the next deploy, and an application that
    // meant S3 has to be able to see that it did not get it (SPEC.md §63).
    expect(written.map((line) => line.message).join('\n')).toMatch(/uploaded files/i)
    expect(written.some((line) => JSON.stringify(line.fields).includes(defaultMediaRoot()))).toBe(
      true,
    )
  })
})
