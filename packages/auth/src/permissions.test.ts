/**
 * What makes an actor still an actor (SPEC.md §49, §50).
 *
 * `permissionsOf` is the funnel every authorization decision passes through, and it
 * is the only place that sees an actor on every path there is — a session, a bearer
 * token, the CLI, an MCP tool, and a job replayed off a queue hours later. The
 * credential boundary cannot answer this on its own: a queued job mints no
 * credential, so nothing there ever asks whether the person is still allowed in.
 */
import {
  type Actor,
  clearJobBus,
  command,
  createApplication,
  createLogger,
  dispatch,
  ForbiddenError,
  job,
  module,
  type QueuedJob,
  runJob,
  silentWriter,
} from '@assemora/core'
import { dataTransactions, useAdapter } from '@assemora/data'
import { createMemoryAdapter } from '@assemora/database'
import { string } from '@assemora/schema'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { policies } from './authorization.js'
import { Agent, ApiToken, Permission, Role, RolePermission, User, UserRole } from './models.js'
import { auth } from './module.js'
import { permissionsOf } from './permissions.js'
import { clearPolicies } from './policies.js'

const ADA = '11111111-1111-4111-8111-111111111111'

const seedUser = async (id: string, ...names: readonly string[]) => {
  await User.create({
    id,
    email: `${id}@assemora.dev`,
    name: 'Ada',
    passwordHash: 'irrelevant',
    active: true,
    version: 1,
  })

  await grantRoles(id, ...names)
}

const grantRoles = async (userId: string, ...names: readonly string[]) => {
  const role = await Role.create({ name: `role-${userId}`, label: 'Role', version: 1 })

  await UserRole.create({ userId, roleId: role.id })

  for (const name of names) {
    const permission = await Permission.create({ name, description: null })

    await RolePermission.create({ roleId: role.id, permissionId: permission.id })
  }
}

const deactivate = async (id: string) => {
  const user = await User.findOrFail(id)

  await user.update({ active: false })
}

beforeEach(() => {
  clearPolicies()
  useAdapter(createMemoryAdapter({}))
})

describe('a user who may no longer sign in may no longer do anything', () => {
  it('holds their roles while they are active', async () => {
    await seedUser(ADA, 'articles.update')

    expect([...(await permissionsOf({ type: 'user', id: ADA }))]).toEqual(['articles.update'])
  })

  it('holds nothing once they are deactivated', async () => {
    await seedUser(ADA, 'articles.update')
    await deactivate(ADA)

    expect([...(await permissionsOf({ type: 'user', id: ADA }))]).toEqual([])
  })

  /**
   * Deliberate, and the reason the check reads the row rather than requiring one.
   *
   * The framework has no user deletion — `active: false` is the whole of how a person
   * is cut off — so an absent row is never a revocation this system performed. It is
   * an application whose identities live somewhere else and whose roles are assigned
   * here, and denying on absence would make `assemora_user_roles` unusable for it.
   */
  it('does not read an absent row as a revocation', async () => {
    await grantRoles(ADA, 'articles.update')

    expect([...(await permissionsOf({ type: 'user', id: ADA }))]).toEqual(['articles.update'])
  })
})

describe('a token is only as live as what stands behind it', () => {
  it('holds nothing once it has expired', async () => {
    const token = await ApiToken.create({
      name: 'nightly import',
      tokenHash: 'expired-token',
      userId: null,
      permissions: ['articles.update'],
      expiresAt: new Date(Date.now() - 1_000),
      lastUsedAt: null,
    })

    expect([...(await permissionsOf({ type: 'api', id: token.id }))]).toEqual([])
  })

  it('keeps its own permissions while it is live', async () => {
    const token = await ApiToken.create({
      name: 'nightly import',
      tokenHash: 'live-token',
      userId: null,
      permissions: ['articles.update'],
      expiresAt: new Date(Date.now() + 60_000),
      lastUsedAt: null,
    })

    expect([...(await permissionsOf({ type: 'api', id: token.id }))]).toEqual(['articles.update'])
  })

  it('holds nothing once the person it was issued for is deactivated', async () => {
    await seedUser(ADA, 'articles.update')

    const token = await ApiToken.create({
      name: "Ada's laptop",
      tokenHash: 'personal-token',
      userId: ADA,
      permissions: ['articles.update'],
      expiresAt: null,
      lastUsedAt: null,
    })

    expect([...(await permissionsOf({ type: 'api', id: token.id }))]).toEqual(['articles.update'])

    await deactivate(ADA)

    expect([...(await permissionsOf({ type: 'api', id: token.id }))]).toEqual([])
  })

  it('leaves a disabled agent holding nothing, as it already did', async () => {
    const agent = await Agent.create({
      name: 'importer',
      description: null,
      permissions: ['articles.update'],
      enabled: false,
    })

    expect([...(await permissionsOf({ type: 'agent', id: agent.id }))]).toEqual([])
  })
})

/**
 * The queue is the first place in Assemora where an identity is stored durably and
 * replayed later, and the window between the two is however long the job sits in
 * Redis — for a failed job, forever.
 */
describe('a job carrying a deactivated actor', () => {
  const renamed: string[] = []

  const Rename = command('notes.rename', {
    input: { title: string().min(1) },
    handle: async ({ title }) => {
      renamed.push(title)

      return { title }
    },
  })

  const RenameLater = job('notes.rename-later', {
    input: { title: string().min(1) },
    retries: 0,
    handle: async ({ title }, context) => {
      await context.commands.execute('notes.rename', { title })
    },
  })

  const pushed: QueuedJob[] = []
  let app: ReturnType<typeof createApplication>

  const asAda = <T>(work: () => Promise<T>): Promise<T> => {
    const actor: Actor = { type: 'user', id: ADA }

    return app.run({ source: 'studio', actor }, work)
  }

  beforeEach(async () => {
    renamed.length = 0
    pushed.length = 0

    app = createApplication({
      modules: [auth(), module('notes').commands(Rename).jobs(RenameLater)],
      authorization: policies(),
      transactions: dataTransactions(),
      logger: createLogger(silentWriter),
      queue: {
        push: async (jobs) => {
          pushed.push(...jobs)
        },
      },
    })

    await app.boot()
    await seedUser(ADA, '*')
  })

  afterEach(async () => {
    await app.shutdown()
    clearJobBus()
  })

  it('runs as them while they are active', async () => {
    await asAda(() => dispatch(RenameLater({ title: 'renamed by the job' })))
    await runJob(pushed[0] as QueuedJob)

    expect(renamed).toEqual(['renamed by the job'])
  })

  it('is refused once they are deactivated, however long it sat in the queue', async () => {
    await asAda(() => dispatch(RenameLater({ title: 'renamed by the job' })))
    await deactivate(ADA)

    await expect(runJob(pushed[0] as QueuedJob)).rejects.toThrow(ForbiddenError)
    expect(renamed).toEqual([])
  })
})
