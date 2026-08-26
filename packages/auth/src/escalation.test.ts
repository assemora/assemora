/**
 * You cannot hand out more than you hold (SPEC.md §50, §72).
 *
 * A role, an API token and an agent all carry permissions, so each of the three is a
 * way to mint a credential — and without this check, a way to mint one stronger than
 * the actor minting it, leaving an ordinary-looking audit trail behind.
 */
import {
  createApplication,
  createLogger,
  ForbiddenError,
  module,
  silentWriter,
} from '@assemora/core'
import { dataTransactions, useAdapter } from '@assemora/data'
import { createMemoryAdapter } from '@assemora/database'
import { beforeEach, describe, expect, it } from 'vitest'
import { policies } from './authorization.js'
import { authCommands } from './commands.js'
import { Permission, Role, RolePermission, User, UserRole } from './models.js'
import { clearPolicies } from './policies.js'

const EDITOR = '33333333-3333-4333-8333-333333333333'

let app: ReturnType<typeof createApplication>

/** Someone who may issue tokens, and holds `articles.*` and nothing more. */
const seedEditor = async () => {
  await User.create({
    id: EDITOR,
    email: 'editor@assemora.dev',
    name: 'Editor',
    passwordHash: 'irrelevant',
    active: true,
    version: 1,
  })

  const role = await Role.create({ name: 'editor', label: 'Editor', version: 1 })

  await UserRole.create({ userId: EDITOR, roleId: role.id })

  for (const name of [
    'articles.*',
    'auth.tokens.create',
    'auth.agents.create',
    'auth.roles.create',
  ]) {
    const permission = await Permission.create({ name, description: null })

    await RolePermission.create({ roleId: role.id, permissionId: permission.id })
  }
}

const run = <T>(work: () => Promise<T>): Promise<T> =>
  app.run({ source: 'rest', actor: { type: 'user', id: EDITOR } }, work)

beforeEach(async () => {
  clearPolicies()
  useAdapter(createMemoryAdapter())

  app = createApplication({
    modules: [module('auth').commands(...authCommands)],
    authorization: policies(),
    transactions: dataTransactions(),
    logger: createLogger(silentWriter),
  })

  await app.boot()
  await seedEditor()
})

describe('minting a credential', () => {
  it('lets an editor issue a token within what they hold', async () => {
    const issued = await run(() =>
      app.commands.execute('auth.tokens.create', {
        name: 'exporter',
        permissions: ['articles.read'],
      }),
    )

    // The plaintext exists exactly once, and this is it (SPEC.md §49).
    expect(issued).toMatchObject({ token: expect.stringMatching(/^ast?_/) })
  })

  it('refuses a token stronger than the person issuing it', async () => {
    await expect(
      run(() => app.commands.execute('auth.tokens.create', { name: 'root', permissions: ['*'] })),
    ).rejects.toBeInstanceOf(ForbiddenError)

    await expect(
      run(() =>
        app.commands.execute('auth.tokens.create', {
          name: 'sneaky',
          permissions: ['articles.read', 'auth.users.password'],
        }),
      ),
    ).rejects.toThrowError(/auth.users.password/)
  })

  it('refuses an agent stronger than the person creating it (SPEC.md §72)', async () => {
    await expect(
      run(() =>
        app.commands.execute('auth.agents.create', {
          name: 'assistant',
          permissions: ['pages.publish'],
        }),
      ),
    ).rejects.toBeInstanceOf(ForbiddenError)
  })

  it('refuses a role stronger than the person creating it', async () => {
    await expect(
      run(() =>
        app.commands.execute('auth.roles.create', {
          name: 'superuser',
          label: 'Superuser',
          permissions: ['*'],
        }),
      ),
    ).rejects.toBeInstanceOf(ForbiddenError)
  })
})
