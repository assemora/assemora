/**
 * Policies apply identically to every caller (SPEC.md §51, §113).
 *
 * The point of putting authorization inside the command pipeline is that Studio,
 * REST, the SDK, the CLI and an agent cannot each get a different answer. This suite
 * asks the same questions through the Command Bus and over HTTP, and expects the
 * same refusals.
 */

import {
  auth,
  clearPolicies,
  createAgent,
  createApiToken,
  hashPassword,
  Permission,
  policies,
  policy,
  Role,
  RolePermission,
  resolveActor,
  SESSION_COOKIE,
  User,
  UserRole,
} from '@assemora/auth'
import {
  createApplication,
  createLogger,
  ForbiddenError,
  module,
  silentWriter,
} from '@assemora/core'
import { dataTransactions, model, string, timestamp, useAdapter, uuid } from '@assemora/data'
import { createMemoryAdapter } from '@assemora/database'
import { clearRouteRegistry, createHttpServer, type HttpServer } from '@assemora/http'
import { clearResourceRegistry, resource, text } from '@assemora/resources'
import { beforeEach, describe, expect, it } from 'vitest'

const Article = model('articles', {
  id: uuid().primary().defaultRandom(),
  title: string(),
  authorId: uuid(),
  createdAt: timestamp().created(),
})

const Articles = resource(Article, {
  title: text().required(),
  authorId: text().required(),
})

/** SPEC.md §51, written against this repository's policy context. */
const ArticlePolicy = policy<{ authorId: string }>('articles', {
  read: () => true,
  create: ({ actor }) => actor !== undefined,
  update: ({ actor, record }) => actor?.id === record.authorId,
  delete: ({ can }) => can('articles.delete'),
})

const AUTHOR = '11111111-1111-4111-8111-111111111111'
const STRANGER = '22222222-2222-4222-8222-222222222222'

let app: ReturnType<typeof createApplication>
let server: HttpServer

const grant = async (userId: string, ...names: string[]) => {
  const role = await Role.create({ name: `role-${userId}`, label: 'Role' })
  await UserRole.create({ userId, roleId: role.id })

  for (const name of names) {
    const permission = await Permission.create({ name, description: null })
    await RolePermission.create({ roleId: role.id, permissionId: permission.id })
  }
}

const asActor = (
  actor: { type: 'user' | 'agent' | 'api'; id: string } | undefined,
  run: () => Promise<unknown>,
) => app.run({ source: 'rest', ...(actor === undefined ? {} : { actor }) }, run)

beforeEach(async () => {
  clearResourceRegistry()
  clearRouteRegistry()
  clearPolicies()
  useAdapter(createMemoryAdapter({}))

  app = createApplication({
    modules: [auth({ policies: [ArticlePolicy as never] }), module('blog').resources(Articles)],
    authorization: policies(),
    transactions: dataTransactions(),
    logger: createLogger(silentWriter),
  })

  server = createHttpServer({
    registry: app.registry,
    commands: app.commands,
    queries: app.queries,
    logger: app.logger,
    resolveActor,
  })

  server.mountResources()
  await server.ready()
})

const createArticle = (
  actor: { type: 'user' | 'agent' | 'api'; id: string } | undefined,
  authorId: string,
) =>
  asActor(actor, () =>
    app.commands.execute('entries.create', {
      resource: 'articles',
      data: { title: 'Ada writes', authorId },
    }),
  ) as Promise<{ id: string }>

describe('through the Command Bus', () => {
  it('refuses an anonymous write', async () => {
    await expect(createArticle(undefined, AUTHOR)).rejects.toThrowError(ForbiddenError)
  })

  it('allows a signed-in user, because the policy says so', async () => {
    await expect(createArticle({ type: 'user', id: AUTHOR }, AUTHOR)).resolves.toMatchObject({
      id: expect.any(String),
    })
  })

  it('lets the author update their own article and nobody else', async () => {
    const created = await createArticle({ type: 'user', id: AUTHOR }, AUTHOR)

    await expect(
      asActor({ type: 'user', id: AUTHOR }, () =>
        app.commands.execute('entries.update', {
          resource: 'articles',
          id: created.id,
          data: { title: 'Ada revises' },
        }),
      ),
    ).resolves.toBeDefined()

    await expect(
      asActor({ type: 'user', id: STRANGER }, () =>
        app.commands.execute('entries.update', {
          resource: 'articles',
          id: created.id,
          data: { title: 'Not mine' },
        }),
      ),
    ).rejects.toThrowError(ForbiddenError)
  })

  it('leaves the article untouched when the record rule refuses', async () => {
    const created = await createArticle({ type: 'user', id: AUTHOR }, AUTHOR)

    await asActor({ type: 'user', id: STRANGER }, () =>
      app.commands
        .execute('entries.update', {
          resource: 'articles',
          id: created.id,
          data: { title: 'Not mine' },
        })
        .catch(() => undefined),
    )

    expect((await Article.findOrFail(created.id)).title).toBe('Ada writes')
  })

  it('needs a held permission for delete, whoever wrote the article', async () => {
    const created = await createArticle({ type: 'user', id: AUTHOR }, AUTHOR)

    await expect(
      asActor({ type: 'user', id: AUTHOR }, () =>
        app.commands.execute('entries.delete', { resource: 'articles', id: created.id }),
      ),
    ).rejects.toThrowError(ForbiddenError)

    await grant(AUTHOR, 'articles.delete')

    await expect(
      asActor({ type: 'user', id: AUTHOR }, () =>
        app.commands.execute('entries.delete', { resource: 'articles', id: created.id }),
      ),
    ).resolves.toBeDefined()
  })

  it('reads are open here, because the policy opened them', async () => {
    await createArticle({ type: 'user', id: AUTHOR }, AUTHOR)

    await expect(
      asActor(undefined, () => app.queries.execute('entries.list', { resource: 'articles' })),
    ).resolves.toMatchObject({ total: 1 })
  })
})

describe('an agent gets the same answers (SPEC.md §51, §76)', () => {
  it('is refused what it has no permission for, and allowed what it has', async () => {
    const writer = await createAgent({ name: 'writer', permissions: [] })
    const editor = await createAgent({ name: 'editor', permissions: ['articles.delete'] })
    const created = await createArticle({ type: 'user', id: AUTHOR }, AUTHOR)

    await expect(
      asActor({ type: 'agent', id: writer.agentId }, () =>
        app.commands.execute('entries.delete', { resource: 'articles', id: created.id }),
      ),
    ).rejects.toThrowError(ForbiddenError)

    await expect(
      asActor({ type: 'agent', id: editor.agentId }, () =>
        app.commands.execute('entries.delete', { resource: 'articles', id: created.id }),
      ),
    ).resolves.toBeDefined()
  })
})

describe('over HTTP, with real credentials', () => {
  const signUp = async (id: string) => {
    await User.create({
      id,
      email: `${id}@x.io`,
      name: 'Somebody',
      passwordHash: await hashPassword('correct horse battery staple'),
      active: true,
    })
  }

  it('refuses an unauthenticated write with 403', async () => {
    const response = await server.inject({
      method: 'POST',
      url: '/api/articles',
      payload: { title: 'Ada writes', authorId: AUTHOR },
    })

    expect(response.statusCode).toBe(403)
    expect(response.json()).toMatchObject({ error: { code: 'FORBIDDEN' } })
  })

  it('accepts the same write from a session cookie', async () => {
    await signUp(AUTHOR)

    const signedIn = (await asActor(undefined, () =>
      app.commands.execute('auth.login', {
        email: `${AUTHOR}@x.io`,
        password: 'correct horse battery staple',
      }),
    )) as { token: string }

    const response = await server.inject({
      method: 'POST',
      url: '/api/articles',
      payload: { title: 'Ada writes', authorId: AUTHOR },
      headers: { cookie: `${SESSION_COOKIE}=${signedIn.token}` },
    })

    expect(response.statusCode).toBe(201)
  })

  it('accepts a bearer token that carries the permission, and refuses one that does not', async () => {
    const created = await createArticle({ type: 'user', id: AUTHOR }, AUTHOR)
    const allowed = await createApiToken({ name: 'editor', permissions: ['articles.delete'] })
    const denied = await createApiToken({ name: 'reader', permissions: ['articles.read'] })

    // `delete` is permission-gated by the policy, so the two tokens differ here in a
    // way that `create` — which the policy opens to anyone signed in — would not show.
    const refused = await server.inject({
      method: 'DELETE',
      url: `/api/articles/${created.id}`,
      headers: { authorization: `Bearer ${denied.token}` },
    })
    const ok = await server.inject({
      method: 'DELETE',
      url: `/api/articles/${created.id}`,
      headers: { authorization: `Bearer ${allowed.token}` },
    })

    expect(refused.statusCode).toBe(403)
    expect(ok.statusCode).toBe(200)
  })

  it('lets any authenticated caller create, because that is what the policy says', async () => {
    const token = await createApiToken({ name: 'ci', permissions: [] })

    const response = await server.inject({
      method: 'POST',
      url: '/api/articles',
      payload: { title: 'From CI', authorId: AUTHOR },
      headers: { authorization: `Bearer ${token.token}` },
    })

    expect(response.statusCode).toBe(201)
  })
})

describe('signing in (SPEC.md §49)', () => {
  it('answers the same way for a wrong password and an unknown email', async () => {
    await User.create({
      id: AUTHOR,
      email: 'ada@x.io',
      name: 'Ada',
      passwordHash: await hashPassword('correct horse battery staple'),
      active: true,
    })

    const wrongPassword = await asActor(undefined, () =>
      app.commands.execute('auth.login', { email: 'ada@x.io', password: 'nope' }),
    ).catch((error: unknown) => error)

    const unknownEmail = await asActor(undefined, () =>
      app.commands.execute('auth.login', { email: 'nobody@x.io', password: 'nope' }),
    ).catch((error: unknown) => error)

    expect(wrongPassword).toMatchObject({ code: 'INVALID_CREDENTIALS', status: 401 })
    expect(unknownEmail).toMatchObject({ code: 'INVALID_CREDENTIALS', status: 401 })
    expect((wrongPassword as Error).message).toBe((unknownEmail as Error).message)
  })

  it('is open to anyone, because the auth policy says so', async () => {
    await expect(
      asActor(undefined, () =>
        app.commands.execute('auth.login', { email: 'nobody@x.io', password: 'x' }),
      ),
    ).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS' })
  })

  it('refuses to create a user without the permission', async () => {
    await expect(
      asActor({ type: 'user', id: STRANGER }, () =>
        app.commands.execute('auth.users.create', {
          email: 'new@x.io',
          name: 'New',
          password: 'correct horse battery staple',
        }),
      ),
    ).rejects.toThrowError(ForbiddenError)
  })

  it('allows it once the permission is held', async () => {
    await grant(STRANGER, 'auth.users.create')

    await expect(
      asActor({ type: 'user', id: STRANGER }, () =>
        app.commands.execute('auth.users.create', {
          email: 'new@x.io',
          name: 'New',
          password: 'correct horse battery staple',
        }),
      ),
    ).resolves.toMatchObject({ id: expect.any(String) })
  })
})
