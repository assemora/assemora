import { createContext, ForbiddenError } from '@assemora/core'
import { useAdapter } from '@assemora/data'
import { createMemoryAdapter, type MemoryAdapter } from '@assemora/database'
import { beforeEach, describe, expect, it } from 'vitest'

import { policies, subjectOf } from './authorization.js'
import { Agent, ApiToken, Permission, Role, RolePermission, UserRole } from './models.js'
import { holds } from './permissions.js'
import { clearPolicies, policy, registerPolicy } from './policies.js'

/** The models validate a user id as a UUID, so the fixtures use real ones. */
const USER = '11111111-1111-4111-8111-111111111111'
const ROOT = '22222222-2222-4222-8222-222222222222'
const EDITOR = '33333333-3333-4333-8333-333333333333'
const MODERATOR = '44444444-4444-4444-8444-444444444444'
const STRANGER = '55555555-5555-4555-8555-555555555555'

const context = (actor?: { type: 'user' | 'agent' | 'api'; id: string }) =>
  createContext({ source: 'rest', ...(actor === undefined ? {} : { actor }) })

let adapter: MemoryAdapter

const grant = async (userId: string, ...names: string[]) => {
  const role = await Role.create({ name: `role-${userId}`, label: 'Role' })
  await UserRole.create({ userId, roleId: role.id })

  for (const name of names) {
    const permission = await Permission.create({ name, description: null })
    await RolePermission.create({ roleId: role.id, permissionId: permission.id })
  }
}

beforeEach(() => {
  clearPolicies()
  adapter = createMemoryAdapter({})
  useAdapter(adapter)
})

describe('a command name is a permission name', () => {
  it('reads the subject out of an entries command', () => {
    expect(
      subjectOf({ command: 'entries.update', input: { resource: 'articles' }, context: context() }),
    ).toEqual({ subject: 'articles', action: 'update' })
  })

  it('treats listing and reading one as the same right', () => {
    for (const command of ['entries.list', 'entries.get']) {
      expect(subjectOf({ command, input: { resource: 'articles' }, context: context() })).toEqual({
        subject: 'articles',
        action: 'read',
      })
    }
  })

  it('splits any other command at its last dot', () => {
    expect(subjectOf({ command: 'pages.publish', input: {}, context: context() })).toEqual({
      subject: 'pages',
      action: 'publish',
    })
    expect(subjectOf({ command: 'auth.users.create', input: {}, context: context() })).toEqual({
      subject: 'auth.users',
      action: 'create',
    })
  })
})

describe('listing and fetching are one right', () => {
  it('folds list and get into read, for every subject and not only entries', () => {
    for (const command of ['pages.list', 'pages.get']) {
      expect(subjectOf({ command, input: {}, context: context() })).toEqual({
        subject: 'pages',
        action: 'read',
      })
    }

    expect(subjectOf({ command: 'auth.users.list', input: {}, context: context() })).toEqual({
      subject: 'auth.users',
      action: 'read',
    })
  })
})

describe('a wildcard grants the group below it', () => {
  it('accepts the exact name, the group and everything', () => {
    expect(holds(new Set(['articles.update']), 'articles.update')).toBe(true)
    expect(holds(new Set(['articles.*']), 'articles.update')).toBe(true)
    expect(holds(new Set(['*']), 'articles.update')).toBe(true)
  })

  it('grants every depth above the permission', () => {
    expect(holds(new Set(['auth.*']), 'auth.users.create')).toBe(true)
    expect(holds(new Set(['auth.users.*']), 'auth.users.create')).toBe(true)
  })

  it('matches whole segments only', () => {
    expect(holds(new Set(['articles.*']), 'articlesecret.read')).toBe(false)
    expect(holds(new Set(['articles.*']), 'articles')).toBe(false)
    expect(holds(new Set(['articles.update']), 'articles.delete')).toBe(false)
    expect(holds(new Set(), 'articles.update')).toBe(false)
  })
})

describe('permissions decide first (SPEC.md §50)', () => {
  it('allows what the actor holds', async () => {
    await grant(USER, 'articles.update')

    await expect(
      policies().authorize({
        command: 'entries.update',
        input: { resource: 'articles' },
        context: context({ type: 'user', id: USER }),
      }),
    ).resolves.toBeUndefined()
  })

  it('refuses everything else, with nobody registered', async () => {
    await expect(
      policies().authorize({
        command: 'entries.create',
        input: { resource: 'articles' },
        context: context({ type: 'user', id: STRANGER }),
      }),
    ).rejects.toThrowError(ForbiddenError)
  })

  it('refuses an anonymous caller by default (SPEC.md §85)', async () => {
    await expect(
      policies().authorize({
        command: 'entries.create',
        input: { resource: 'articles' },
        context: context(),
      }),
    ).rejects.toThrowError(ForbiddenError)
  })

  it('honours a wildcard', async () => {
    await grant(ROOT, '*')

    await expect(
      policies().authorize({
        command: 'entries.delete',
        input: { resource: 'anything' },
        context: context({ type: 'user', id: ROOT }),
      }),
    ).resolves.toBeUndefined()
  })
})

describe('policies decide what permissions do not (SPEC.md §51)', () => {
  it('lets a policy open a read to everyone', async () => {
    registerPolicy(policy('articles', { read: () => true }) as never)

    await expect(
      policies().authorize({
        command: 'entries.list',
        input: { resource: 'articles' },
        context: context(),
      }),
    ).resolves.toBeUndefined()
  })

  it('asks the rule, and refuses when it says no', async () => {
    registerPolicy(policy('articles', { create: ({ actor }) => actor?.type === 'user' }) as never)

    await expect(
      policies().authorize({
        command: 'entries.create',
        input: { resource: 'articles' },
        context: context({ type: 'agent', id: 'writer' }),
      }),
    ).rejects.toThrowError(ForbiddenError)

    await expect(
      policies().authorize({
        command: 'entries.create',
        input: { resource: 'articles' },
        context: context({ type: 'user', id: USER }),
      }),
    ).resolves.toBeUndefined()
  })

  it('gives a rule the permission check it asks for', async () => {
    await grant(EDITOR, 'articles.publish')
    registerPolicy(policy('articles', { create: ({ can }) => can('articles.publish') }) as never)

    await expect(
      policies().authorize({
        command: 'entries.create',
        input: { resource: 'articles' },
        context: context({ type: 'user', id: EDITOR }),
      }),
    ).resolves.toBeUndefined()
  })

  it('refuses an action the policy says nothing about', async () => {
    registerPolicy(policy('articles', { read: () => true }) as never)

    await expect(
      policies().authorize({
        command: 'entries.create',
        input: { resource: 'articles' },
        context: context({ type: 'user', id: USER }),
      }),
    ).rejects.toThrowError('says nothing about create')
  })
})

describe('the record decides for what already exists', () => {
  const ownership = policy<{ authorId: string }>('articles', {
    update: ({ actor, record }) => actor?.id === record.authorId,
  })

  it('defers an update past the first stage, where the row is unknown', async () => {
    registerPolicy(ownership as never)

    await expect(
      policies().authorize({
        command: 'entries.update',
        input: { resource: 'articles' },
        context: context({ type: 'user', id: USER }),
      }),
    ).resolves.toBeUndefined()
  })

  it('allows the owner and refuses everyone else', async () => {
    registerPolicy(ownership as never)
    const port = policies()

    await expect(
      port.authorizeRecord?.({
        subject: 'articles',
        action: 'update',
        record: { authorId: USER },
        context: context({ type: 'user', id: USER }),
      }),
    ).resolves.toBeUndefined()

    await expect(
      port.authorizeRecord?.({
        subject: 'articles',
        action: 'update',
        record: { authorId: STRANGER },
        context: context({ type: 'user', id: USER }),
      }),
    ).rejects.toThrowError(ForbiddenError)
  })

  it('lets a held permission override the record rule', async () => {
    await grant(MODERATOR, 'articles.update')
    registerPolicy(ownership as never)

    await expect(
      policies().authorizeRecord?.({
        subject: 'articles',
        action: 'update',
        record: { authorId: STRANGER },
        context: context({ type: 'user', id: MODERATOR }),
      }),
    ).resolves.toBeUndefined()
  })
})

describe('agents and API tokens carry their own permissions (SPEC.md §72)', () => {
  it('reads the permissions an agent carries, and honours its enabled flag', async () => {
    const agent = await Agent.create({
      name: 'content-agent',
      description: null,
      permissions: ['articles.create'],
      enabled: true,
    })

    const request = {
      command: 'entries.create',
      input: { resource: 'articles' },
      context: context({ type: 'agent', id: agent.id }),
    }

    await expect(policies().authorize(request)).resolves.toBeUndefined()

    await agent.update({ enabled: false })

    await expect(policies().authorize(request)).rejects.toThrowError(ForbiddenError)
  })

  it('reads the permissions an API token carries', async () => {
    const token = await ApiToken.create({
      name: 'ci',
      tokenHash: 'digest',
      userId: null,
      permissions: ['articles.read'],
      expiresAt: null,
    })

    await expect(
      policies().authorize({
        command: 'entries.list',
        input: { resource: 'articles' },
        context: context({ type: 'api', id: token.id }),
      }),
    ).resolves.toBeUndefined()
  })
})

describe('reading an entry across languages (SPEC.md §131)', () => {
  it('is the same permission as reading it', () => {
    const request = {
      command: 'entries.translations',
      input: { resource: 'articles' },
      context: context(),
    }

    // A role that may read an entry should not need a second grant to be told which
    // languages it is written in.
    expect(subjectOf(request)).toEqual({ subject: 'articles', action: 'read' })
  })
})
