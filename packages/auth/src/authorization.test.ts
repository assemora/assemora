import {
  createApplication,
  createContext,
  createLogger,
  ForbiddenError,
  type ModuleBuilder,
  module,
  query,
  silentWriter,
} from '@assemora/core'
import { model, string, useAdapter, uuid } from '@assemora/data'
import { createMemoryAdapter, type MemoryAdapter } from '@assemora/database'
import { beforeEach, describe, expect, it } from 'vitest'

import { policies, subjectOf } from './authorization.js'
import { Agent, ApiToken, Permission, Role, RolePermission, UserRole } from './models.js'
import { auth } from './module.js'
import { holds } from './permissions.js'
import {
  clearPolicies,
  describedPolicies,
  describePolicy,
  policy,
  registerModulePolicy,
  registerPolicy,
} from './policies.js'

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

  it('defers an update past the first stage, and says that it did', async () => {
    registerPolicy(ownership as never)

    // Saying so is what makes the second stage a guarantee rather than a convention:
    // the bus holds the command to it and refuses to commit one that never asked.
    await expect(
      policies().authorize({
        command: 'entries.update',
        input: { resource: 'articles' },
        context: context({ type: 'user', id: USER }),
      }),
    ).resolves.toEqual({ deferredTo: { subject: 'articles', action: 'update' } })
  })

  it('defers nothing when the actor holds the permission outright', async () => {
    registerPolicy(ownership as never)
    await grant(USER, 'articles.update')

    // Nothing was deferred, so nothing is owed — a command that asks anyway is free
    // to, and one that does not is not withholding a check that was promised.
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

/**
 * A policy is described, because access control is the one thing the single source of
 * truth must not be silent about (SPEC.md §51, ADR-0002, ADR-0027).
 *
 * `registerPolicy` grants access and wrote nothing anywhere. An installed package could
 * open `pages.create` to everybody in twelve lines, and the registry — which describes
 * every model, resource, command, query, route and block — said nothing about it.
 */
describe('what the registry is told about a policy', () => {
  const ownership = policy<{ authorId: string }>('articles', {
    read: () => true,
    update: ({ actor, record }) => actor?.id === record.authorId,
  })

  it('names the subject and the actions it answers for', () => {
    expect(describePolicy(ownership as never)).toEqual({
      name: 'articles',
      actions: ['read', 'update'],
    })
  })

  it('carries no rule, because a function is not data', () => {
    // A descriptor travels to Studio as JSON, and a function does not survive the trip:
    // carrying one would arrive as an empty object and say less than nothing (ADR-0027).
    const described = describePolicy(ownership as never, 'blog') as Record<string, unknown>

    expect(Object.keys(described).sort()).toEqual(['actions', 'module', 'name'])
    expect(JSON.parse(JSON.stringify(described))).toEqual(described)
  })

  it('names the module that registered it', () => {
    expect(describePolicy(ownership as never, 'blog')).toMatchObject({ module: 'blog' })
  })

  it('leaves the module out when nothing went through one', () => {
    // Legal, and exactly the registration worth being able to see: the absence is the
    // signal that `registerPolicy` was reached for directly.
    registerPolicy(ownership as never)

    expect(describedPolicies()).toEqual([{ name: 'articles', actions: ['read', 'update'] }])
  })

  it('remembers which module each subject came from', () => {
    registerModulePolicy(ownership as never, 'blog')

    expect(describedPolicies()).toEqual([
      { name: 'articles', actions: ['read', 'update'], module: 'blog' },
    ])
  })
})

describe('a policy reaches the registry (SPEC.md §51, ADR-0002)', () => {
  const ownership = policy<{ authorId: string }>('articles', {
    read: () => true,
    update: ({ actor, record }) => actor?.id === record.authorId,
  })

  it('is described by the module that declared it, at registration', () => {
    const app = createApplication({
      modules: [module('blog').policies(ownership as never)],
      logger: createLogger(silentWriter),
    })

    expect(app.registry.section('policies')).toEqual([
      { name: 'articles', actions: ['read', 'update'], module: 'blog' },
    ])
  })

  /**
   * The ADR-0027 case, and the half that prevents rather than reveals.
   *
   * An installed package reaches for `registerPolicy` at import time, grants itself
   * access and declares nothing. Until now it was *described* — visible to anybody who
   * went looking, which is not a control. Now the application refuses to start.
   */
  it('refuses to boot on a policy that went through no module at all', async () => {
    registerPolicy(ownership as never)

    const app = createApplication({
      modules: [auth()],
      logger: createLogger(silentWriter),
    })

    await expect(app.boot()).rejects.toThrow(/registered outside any module/)
  })
})

/**
 * Which subjects a module may speak for (SPEC.md §51, ADR-0027).
 *
 * A policy is a grant — `authorize` lets a caller through on a permission *or* a
 * policy — so a module writing one for somebody else's subject is a module opening it.
 */
describe('a module may only write a policy for a subject it declares', () => {
  const forPages = policy('pages', { create: () => true })

  /** A module named after the area, declaring a table named after the thing. */
  const Article = model('articles', { id: uuid().primary(), title: string() })

  const boot = async (...modules: ModuleBuilder[]) => {
    const app = createApplication({ modules, logger: createLogger(silentWriter) })

    await app.boot()

    return app
  }

  it('refuses a subject the module has nothing to do with', async () => {
    // Twelve lines in a dependency, which is the whole of the attack: `pages.create`
    // for everybody, from a package that has never heard of a page.
    await expect(boot(auth(), module('analytics').policies(forPages as never))).rejects.toThrow(
      /Module "analytics" registered a policy for "pages", which it does not declare/,
    )
  })

  it('says what would have had to be true, because it is read once by somebody else', async () => {
    const refusal = await boot(auth(), module('analytics').policies(forPages as never)).catch(
      (error: Error) => error.message,
    )

    expect(refusal).toContain('name "pages" as a model or a resource')
    expect(refusal).toContain('auth({ policies: [...] })')
  })

  it('allows a module its own name, and the namespace under it', async () => {
    const app = await boot(auth(), module('pages').policies(forPages as never))

    expect(app.registry.section('policies')).toContainEqual(
      expect.objectContaining({ name: 'pages', module: 'pages' }),
    )
  })

  /**
   * The case a name-only rule would break.
   *
   * An application's module is named after the area rather than the table:
   * `module('blog')` declaring `articles` is the ordinary shape, and it owns `articles`
   * because it *said so* — which the registry now records.
   */
  it('allows a subject the module declared under a name of its own', async () => {
    const app = await boot(
      auth(),
      module('blog')
        .models(Article)
        .policies(policy('articles', { read: () => true }) as never),
    )

    expect(app.registry.section('policies')).toContainEqual(
      expect.objectContaining({ name: 'articles', module: 'blog' }),
    )
  })

  /**
   * The case that proved a two-clause rule wrong, taken from a real project.
   *
   * A delivery site declares `menu.list`, `menu.get` and `menu.dish` and a
   * `policy('menu', …)` beside them — deliberately on `menu` rather than on `dishes`,
   * because the menu is public and the generated CRUD over dishes is not. A rule that
   * knew only names and resources refused it, and the only way to keep booting would
   * have been to move the policy onto `dishes`, which opens the admin surface.
   *
   * So: a module owns the group of a command or query it declared. A rule that pushes
   * an author toward the less safe design is a wrong rule, whatever else it prevents.
   */
  it('allows the group of a query the module declared, which is what a subject is', async () => {
    const ListMenu = query('menu.list', { input: {}, handle: async () => [] })

    const app = await boot(
      auth(),
      module('content')
        .queries(ListMenu)
        .policies(policy('menu', { read: () => true }) as never),
    )

    expect(app.registry.section('policies')).toContainEqual(
      expect.objectContaining({ name: 'menu', module: 'content' }),
    )
  })

  it('does not extend that to a group somebody else declared', async () => {
    const ListMenu = query('menu.list', { input: {}, handle: async () => [] })

    await expect(
      boot(
        auth(),
        module('content').queries(ListMenu),
        module('analytics').policies(policy('menu', { read: () => true }) as never),
      ),
    ).rejects.toThrow(/Module "analytics" registered a policy for "menu"/)
  })

  it('does not let one module claim what another declared', async () => {
    await expect(
      boot(
        auth(),
        module('blog').models(Article),
        module('analytics').policies(policy('articles', { read: () => true }) as never),
      ),
    ).rejects.toThrow(/Module "analytics" registered a policy for "articles"/)
  })

  /**
   * The application's own door.
   *
   * A policy over somebody else's subject is a decision the application is entitled to
   * make and a package is not, so it is written at the composition root and held to no
   * ownership rule. It is described with no module, which is what "not a package" has
   * looked like since the section existed.
   */
  it('lets the application write one for any subject, from the composition root', async () => {
    const app = await boot(auth({ policies: [forPages as never] }))

    expect(app.registry.section('policies')).toContainEqual({
      name: 'pages',
      actions: ['create'],
    })
  })
})
