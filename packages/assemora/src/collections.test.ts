/**
 * A collection is a resource, so it is served like one (SPEC.md §37, §43).
 *
 * The umbrella builds the server while the application is still un-booted, and the
 * resources module registers every stored collection *in* its boot hook. Those two
 * facts used to be in the wrong order: `mountResources()` read the registry before the
 * hook had run, so a collection's `/api/<name>` answered 404 — not until the next
 * restart, which is what the command's own answer promised, but for ever.
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
import { clearRouteRegistry } from '@assemora/http'
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
