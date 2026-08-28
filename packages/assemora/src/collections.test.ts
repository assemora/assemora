/**
 * A collection is a resource, so it is served like one (SPEC.md §37, §43).
 *
 * Two ways for one to arrive, and each of them used to end in a 404.
 *
 * The umbrella builds the server while the application is still un-booted, and the
 * resources module registers every stored collection *in* its boot hook — so
 * `mountResources()` read the registry before the hook had run, and a collection
 * restored from the database was never mounted at all. It is mounted now, on a second
 * pass while Fastify is still willing to take a route.
 *
 * And a collection made in Studio arrives at a process that is already serving, where
 * no route can be taken. That one is answered by the parameterised pair of endpoints
 * `@assemora/http` mounts beside the generated ones.
 *
 * A file of its own because collections live in module-level registries, and Vitest
 * gives each file its own module graph.
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
import { clearRestorers, createLogger, type Logger, silentWriter } from '@assemora/core'
import { createMemoryAdapter } from '@assemora/database'
import { clearRouteRegistry, type HttpServer } from '@assemora/http'
import {
  clearResourceRegistry,
  collections,
  type DynamicDefinition,
  ResourceDefinitionModel,
} from '@assemora/resources'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { type AssemoraApplication, assemora } from './assemora.js'
import type { AssemoraOptions } from './options.js'

const PASSWORD = 'correct horse battery staple'

const quiet: Logger = createLogger(silentWriter)

let running: AssemoraApplication[] = []

const testimonials: DynamicDefinition = {
  name: 'testimonials',
  label: 'Testimonials',
  fields: [
    { name: 'author', kind: 'text', required: true },
    { name: 'quote', kind: 'textarea', required: true },
  ],
}

const build = (options: Omit<AssemoraOptions, 'database' | 'logger'>): AssemoraApplication => {
  const built = assemora({ ...options, database: createMemoryAdapter(), logger: quiet })

  running.push(built)

  return built
}

const serverOf = (built: AssemoraApplication) => {
  if (built.server === undefined) throw new Error('this application was built without an API')

  return built.server
}

/** A definition row written before the boot that reads it: a collection from last run. */
const store = (definition: DynamicDefinition) =>
  ResourceDefinitionModel.create({
    name: definition.name,
    label: definition.label ?? definition.name,
    schema: definition,
    settings: {},
  })

/** Both cookies a signed-in browser holds: the session, and the CSRF token it repeats. */
const signIn = async (server: HttpServer): Promise<Record<string, string>> => {
  const response = await server.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: { email: 'ada@assemora.dev', password: PASSWORD },
  })
  const header = response.headers['set-cookie']
  const jar: Record<string, string> = {}

  for (const line of Array.isArray(header) ? header : [String(header ?? '')]) {
    const [name, ...rest] = (String(line).split(';')[0] ?? '').split('=')

    if (name !== undefined && name !== '') jar[name] = decodeURIComponent(rest.join('='))
  }

  return jar
}

/** What a browser has to send with a mutation once it holds a session (SPEC.md §85). */
const asStudio = (jar: Record<string, string>): Record<string, string> => ({
  cookie: `assemora_session=${jar.assemora_session}; assemora_csrf=${jar.assemora_csrf}`,
  'x-csrf-token': jar.assemora_csrf ?? '',
})

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

beforeEach(() => {
  clearPolicies()
  clearResourceRegistry()
  clearRouteRegistry()
  clearRestorers()
})

afterEach(async () => {
  for (const built of running) await built.shutdown()

  running = []
})

describe('a collection stored in the database, after a restart (SPEC.md §37)', () => {
  it('answers at the REST path the command promised it would', async () => {
    const built = build({ modules: [auth(), collections()], studio: false })

    await store(testimonials)
    await built.boot()
    await administrator()

    const server = serverOf(built)

    // Present and refused, exactly as a static resource is for an anonymous caller: a
    // 404 would mean the collection has no REST endpoint at all, which is the promise
    // `collections.create` makes and the Studio success screen repeats verbatim.
    const anonymous = await server.inject({ method: 'GET', url: '/api/testimonials' })

    expect(anonymous.statusCode).toBe(403)

    const signedIn = await server.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'ada@assemora.dev', password: PASSWORD },
    })
    const session = String(signedIn.headers['set-cookie'] ?? '').split(';')[0] ?? ''

    const listed = await server.inject({
      method: 'GET',
      url: '/api/testimonials',
      headers: { cookie: session },
    })

    expect(listed.statusCode).toBe(200)
    expect(listed.json<{ total: number }>().total).toBe(0)
  })

  it('is documented at that path too, so OpenAPI and the SDK do not publish a 404', async () => {
    const built = build({ modules: [auth(), collections()], studio: false })

    await store(testimonials)
    await built.boot()

    const document = await serverOf(built).inject({ method: 'GET', url: '/api/openapi.json' })
    const paths = Object.keys(document.json<{ paths: Record<string, unknown> }>().paths)

    expect(paths).toContain('/api/testimonials')
    expect(paths).toContain('/api/testimonials/{id}')

    // The registry is what the SDK generator reads, and it now describes the same
    // addresses the server answers on (SPEC.md §98).
    expect(built.app.registry.describe().routes?.map((entry) => entry.name)).toEqual(
      expect.arrayContaining(['get /testimonials', 'delete /testimonials/:id']),
    )
  })

  it('is not published under a version nobody wrote it into (SPEC.md §47)', async () => {
    const built = build({
      modules: [auth(), collections()],
      studio: false,
      api: { versions: { v1: () => undefined } },
    })

    await store(testimonials)
    await built.boot()

    const server = serverOf(built)

    expect((await server.inject({ method: 'GET', url: '/api/testimonials' })).statusCode).toBe(403)
    // A version carries what `api.resource(name)` names, and a collection made after
    // that callback ran is not in it — so this is a 404, and honestly one.
    expect((await server.inject({ method: 'GET', url: '/api/v1/testimonials' })).statusCode).toBe(
      404,
    )
  })

  /**
   * The one new refusal the ordering brings, pinned rather than discovered.
   *
   * `collections.create` already refuses a name whose generated paths a route serves,
   * so this needs a row nobody could have made through the command — a hand-written
   * one, or a name a later release turned into a route. Mounting is where the two meet,
   * and a server that will not start naming the address is the honest answer: the other
   * one is `/api/health` answering with a listing of somebody's collection.
   */
  it('refuses to start when a stored collection claims an address already served', async () => {
    const built = build({ modules: [auth(), collections()], studio: false })

    await store({ name: 'health', label: 'Health', fields: [{ name: 'note', kind: 'text' }] })

    await expect(built.boot()).rejects.toThrow(/already served by this application/)
  })
})

/**
 * The half a restart could never fix (SPEC.md §37, §43).
 *
 * A collection made in Studio is made in a process that is already serving, and Fastify
 * takes no route once its instance is ready. Until this, `collections.create` answered
 * with a promise of REST paths "when the server starts" — and the person who made the
 * collection had to restart production to get the address the answer had just given
 * them. That is what made a collection a second-class resource, and it is the whole of
 * what these tests are about.
 */
describe('a collection created while this process serves (SPEC.md §37)', () => {
  const definition = {
    name: 'testimonials',
    label: 'Testimonials',
    fields: [
      { name: 'author', kind: 'text', required: true },
      { name: 'quote', kind: 'textarea', required: true },
    ],
  }

  const created = async (server: HttpServer, jar: Record<string, string>) =>
    server.inject({
      method: 'POST',
      url: '/api/commands/collections.create',
      payload: definition,
      headers: asStudio(jar),
    })

  it('answers at its own REST paths straight away, with no restart', async () => {
    const built = build({ modules: [auth(), collections()], studio: false })

    await built.boot()
    await administrator()

    const server = serverOf(built)
    const jar = await signIn(server)

    // Before it exists, and after the very sign-in that readied Fastify: nothing can be
    // mounted from here on.
    expect((await server.inject({ method: 'GET', url: '/api/testimonials' })).statusCode).toBe(404)

    const answer = await created(server, jar)

    expect(answer.statusCode).toBe(200)
    expect(answer.json<{ note: string }>().note).toContain('No restart')

    const listed = await server.inject({
      method: 'GET',
      url: '/api/testimonials',
      headers: { cookie: `assemora_session=${jar.assemora_session}` },
    })

    expect(listed.statusCode).toBe(200)
    expect(listed.json<{ total: number }>().total).toBe(0)

    const entry = await server.inject({
      method: 'POST',
      url: '/api/testimonials',
      payload: { author: 'Ada', quote: 'It works' },
      headers: asStudio(jar),
    })

    expect(entry.statusCode).toBe(201)

    // Anonymous is refused rather than missing — the same pair a static resource gives,
    // because it is the same command behind the same policy (SPEC.md §51).
    expect((await server.inject({ method: 'GET', url: '/api/testimonials' })).statusCode).toBe(403)
  })

  it('is documented at those paths, so OpenAPI and the SDK do not publish a 404', async () => {
    const built = build({ modules: [auth(), collections()], studio: false })

    await built.boot()
    await administrator()

    const server = serverOf(built)

    await created(server, await signIn(server))

    const document = await server.inject({ method: 'GET', url: '/api/openapi.json' })
    const body = document.json<{
      paths: Record<string, unknown>
      components: { schemas: Record<string, unknown> }
    }>()

    expect(Object.keys(body.paths)).toEqual(
      expect.arrayContaining(['/api/testimonials', '/api/testimonials/{id}']),
    )
    expect(Object.keys(body.components.schemas)).toContain('testimonials')
  })

  it('stops answering, and stops being documented, when it is deleted', async () => {
    const built = build({ modules: [auth(), collections()], studio: false })

    await built.boot()
    await administrator()

    const server = serverOf(built)
    const jar = await signIn(server)

    await created(server, jar)

    const deleted = await server.inject({
      method: 'POST',
      url: '/api/commands/collections.delete',
      payload: { name: 'testimonials' },
      headers: asStudio(jar),
    })

    expect(deleted.statusCode).toBe(200)

    expect(
      (
        await server.inject({
          method: 'GET',
          url: '/api/testimonials',
          headers: { cookie: `assemora_session=${jar.assemora_session}` },
        })
      ).statusCode,
    ).toBe(404)

    const document = await server.inject({ method: 'GET', url: '/api/openapi.json' })

    expect(Object.keys(document.json<{ paths: Record<string, unknown> }>().paths)).not.toContain(
      '/api/testimonials',
    )
  })

  it('leaves the addresses this application already serves alone', async () => {
    const built = build({ modules: [auth(), collections()], studio: false })

    await built.boot()
    await administrator()

    const server = serverOf(built)
    const jar = await signIn(server)

    // `/api/health` is a route this application declares. A collection of that name
    // would generate paths over it, so the command refuses before anything is stored —
    // and the probe goes on answering (SPEC.md §43, §98).
    const refused = await server.inject({
      method: 'POST',
      url: '/api/commands/collections.create',
      payload: { name: 'health', fields: [{ name: 'note', kind: 'text' }] },
      headers: asStudio(jar),
    })

    expect(refused.statusCode).toBe(409)
    expect((await server.inject({ method: 'GET', url: '/api/health' })).statusCode).toBe(200)
  })

  it('is not what an unknown address answers with', async () => {
    const built = build({ modules: [auth(), collections()], studio: false })

    await built.boot()

    const server = serverOf(built)
    const missing = await server.inject({ method: 'GET', url: '/api/nothing-here' })

    expect(missing.statusCode).toBe(404)
  })
})

/**
 * The last thing a resource written in TypeScript could do and one made in Studio could
 * not: publish less (SPEC.md §43).
 *
 * `collections.create` took an `api` object and dropped it, and every collection served
 * all five endpoints whatever it had been asked for. Equal rights is not "a collection
 * gets everything a static resource gets" — it is the same declaration, including the
 * one that takes something away.
 */
describe('a collection that publishes less (SPEC.md §43)', () => {
  const readOnly = {
    name: 'changelog',
    label: 'Changelog',
    fields: [{ name: 'entry', kind: 'text', required: true }],
    api: { create: false, update: false, delete: false },
  }

  it('serves, and documents, only the endpoints it asked for', async () => {
    const built = build({ modules: [auth(), collections()], studio: false })

    await built.boot()
    await administrator()

    const server = serverOf(built)
    const jar = await signIn(server)

    const answer = await server.inject({
      method: 'POST',
      url: '/api/commands/collections.create',
      payload: readOnly,
      headers: asStudio(jar),
    })

    expect(answer.statusCode).toBe(200)
    // The answer says what was published and what was not, rather than promising five
    // endpoints and delivering two.
    expect(answer.json<{ note: string }>().note).toContain('GET /changelog')
    expect(answer.json<{ note: string }>().note).toContain('It has no POST /changelog')
    // And it does not promise the three operations it does not have.
    expect(answer.json<{ note: string }>().note).not.toContain('entries.create')

    const listed = await server.inject({
      method: 'GET',
      url: '/api/changelog',
      headers: { cookie: `assemora_session=${jar.assemora_session}` },
    })

    expect(listed.statusCode).toBe(200)

    const refused = await server.inject({
      method: 'POST',
      url: '/api/changelog',
      payload: { entry: 'It works' },
      headers: asStudio(jar),
    })

    expect(refused.statusCode).toBe(404)

    const document = await server.inject({ method: 'GET', url: '/api/openapi.json' })
    const paths = document.json<{ paths: Record<string, Record<string, unknown>> }>().paths

    expect(Object.keys(paths['/api/changelog'] ?? {})).toEqual(['get'])
    expect(Object.keys(paths['/api/changelog/{id}'] ?? {})).toEqual(['get'])
  })

  it('refuses the same operation on the command path, so Studio and MCP agree', async () => {
    const built = build({ modules: [auth(), collections()], studio: false })

    await built.boot()
    await administrator()

    const server = serverOf(built)
    const jar = await signIn(server)

    await server.inject({
      method: 'POST',
      url: '/api/commands/collections.create',
      payload: readOnly,
      headers: asStudio(jar),
    })

    // `entries.*` checks the same four flags a static resource's are checked against, so
    // this is not "no REST path for it" — the collection has no create operation, and
    // Studio's own form and an agent's MCP tool meet the same refusal an administrator
    // does here (SPEC.md §43). It is a shape rather than a permission: the actor holds
    // every permission there is.
    const written = await server.inject({
      method: 'POST',
      url: '/api/commands/entries.create',
      payload: { resource: 'changelog', data: { entry: 'From Studio' } },
      headers: asStudio(jar),
    })

    expect(written.statusCode).toBe(403)
    expect(written.json<{ error: { message: string } }>().error.message).toContain(
      'cannot be created',
    )

    const read = await server.inject({
      method: 'GET',
      url: '/api/queries/entries.list?resource=changelog',
      headers: asStudio(jar),
    })

    expect(read.statusCode).toBe(200)
  })

  it('keeps what it was given when an edit does not mention it', async () => {
    const built = build({ modules: [auth(), collections()], studio: false })

    await built.boot()
    await administrator()

    const server = serverOf(built)
    const jar = await signIn(server)

    await server.inject({
      method: 'POST',
      url: '/api/commands/collections.create',
      payload: readOnly,
      headers: asStudio(jar),
    })

    // Studio's editor does not send `api` in v1 — it is a command-level declaration
    // there and nothing more. An absent flag object meaning "all four" would have every
    // ordinary field edit hand back the operations somebody deliberately took away, so
    // it means "leave it", the way an absent label does.
    const edited = await server.inject({
      method: 'POST',
      url: '/api/commands/collections.update',
      payload: {
        name: 'changelog',
        fields: [
          { name: 'entry', kind: 'text', required: true },
          { name: 'author', kind: 'text' },
        ],
      },
      headers: asStudio(jar),
    })

    expect(edited.statusCode).toBe(200)
    expect(edited.json<{ resource: { api: Record<string, boolean> } }>().resource.api).toEqual({
      create: false,
      read: true,
      update: false,
      delete: false,
    })
    expect(
      (
        await server.inject({
          method: 'POST',
          url: '/api/changelog',
          payload: { entry: 'x' },
          headers: asStudio(jar),
        })
      ).statusCode,
    ).toBe(404)
  })
})
