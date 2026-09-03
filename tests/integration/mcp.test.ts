/**
 * SPEC.md §76 — what an MCP tool call must pass.
 *
 * "MCP tool execution must pass: token authentication, agent permissions, policy
 * checks, field permissions, validation, rate limits, audit."
 *
 * None of those are implemented in `@assemora/mcp`, and that is the design: a tool
 * call is a query, a dry run or a proposal on the same buses everything else uses.
 * This is the test that says so out loud — if any of the seven stopped happening,
 * MCP would be the place it showed.
 */
import { AuditLog, audit, auditModule } from '@assemora/audit'
import {
  auth,
  clearPolicies,
  createAgent,
  hashPassword,
  Permission,
  policies,
  Role,
  RolePermission,
  tokenActor,
  User,
  UserRole,
} from '@assemora/auth'
import { ChangeSet, changeSets } from '@assemora/change-sets'
import {
  clearRestorers,
  createApplication,
  createLogger,
  module,
  silentWriter,
} from '@assemora/core'
import { string as column, dataTransactions, model, useAdapter, uuid } from '@assemora/data'
import { createMemoryAdapter } from '@assemora/database'
import { connectDirectly, createMcpServer, type McpEndpoint, rateLimit } from '@assemora/mcp'
import { clearResourceRegistry, resource, text } from '@assemora/resources'
import { revisions, revisionsModule } from '@assemora/revisions'
import { beforeEach, describe, expect, it } from 'vitest'

const Article = model('articles', {
  id: uuid().primary().defaultRandom(),
  title: column(),
  internal: column().nullable(),
})

const Articles = resource(Article, {
  title: text().required(),
  // An agent may neither read nor write the editorial note.
  internal: text().agentAccess({ read: false, write: false }),
})

let app: ReturnType<typeof createApplication>
let endpoint: McpEndpoint
let agentToken: string

const rpc = (method: string, params: unknown = {}, id = 1) => ({
  jsonrpc: '2.0' as const,
  id,
  method,
  params,
})

/** Everything a real request does before the message reaches the server. */
const asAgent = async (message: unknown, token = agentToken) => {
  const actor = await tokenActor(token)

  if (actor === undefined) throw new Error('the token was not recognised')

  return app.run({ source: 'mcp', actor }, () => endpoint.handle(message))
}

const call = async (name: string, args: unknown, token = agentToken) => {
  const answered = (await asAgent(rpc('tools/call', { name, arguments: args }, 99), token)) as {
    result: { isError?: boolean; content: { text: string }[] }
  }

  return {
    failed: answered.result.isError === true,
    body: JSON.parse(answered.result.content[0]?.text ?? '{}') as Record<string, unknown>,
  }
}

beforeEach(async () => {
  clearPolicies()
  clearResourceRegistry()
  clearRestorers()
  useAdapter(createMemoryAdapter())

  const { mcp } = await import('@assemora/mcp')

  app = createApplication({
    modules: [
      auth(),
      module('blog')
        .models(Article)
        .resources(Articles as never),
      revisionsModule(),
      auditModule(),
      changeSets(),
      mcp({ project: { name: 'test' } }),
    ],
    authorization: policies(),
    transactions: dataTransactions(),
    revisions: revisions(),
    audit: audit(),
    logger: createLogger(silentWriter),
  })

  await app.boot()

  // A person, so there is something an agent should not be able to touch.
  const person = await User.create({
    email: 'ada@assemora.dev',
    name: 'Ada',
    passwordHash: await hashPassword('correct horse battery staple'),
    active: true,
    version: 1,
  })
  const role = await Role.create({ name: 'administrator', label: 'Admin', version: 1 })
  const everything = await Permission.create({ name: '*', description: null })

  await UserRole.create({ userId: person.id, roleId: role.id })
  await RolePermission.create({ roleId: role.id, permissionId: everything.id })

  const created = await createAgent({
    name: 'content-agent',
    permissions: ['assemora.*', 'articles.read', 'articles.update', 'changesets.propose'],
  })

  agentToken = created.token

  endpoint = await connectDirectly(
    createMcpServer({
      registry: app.registry,
      commands: app.commands,
      queries: app.queries,
      rateLimit: rateLimit({ max: 50, windowMs: 60_000 }),
    }),
  )

  await asAgent(
    rpc('initialize', {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'test', version: '1' },
    }),
  )
})

describe('1. token authentication', () => {
  it('resolves an agent token to an agent actor', async () => {
    expect(await tokenActor(agentToken)).toEqual({ type: 'agent', id: expect.any(String) })
  })

  it('resolves nothing for a token nobody issued', async () => {
    expect(await tokenActor('agt_invented')).toBeUndefined()
  })
})

describe('2. agent permissions', () => {
  it('allows what the agent holds', async () => {
    const answered = await call('assemora.describe', {})

    expect(answered.failed).toBe(false)
  })

  it('refuses what it does not', async () => {
    const answered = await call('assemora.auth.users.list', {})

    expect(answered.failed).toBe(true)
    expect(answered.body).toMatchObject({ error: { code: 'FORBIDDEN' } })
  })
})

describe('3. policy checks', () => {
  it('refuses a mutation the agent has no permission for, at proposal time', async () => {
    const answered = await call('assemora.entries.delete', {
      resource: 'articles',
      id: crypto.randomUUID(),
    })

    expect(answered.failed).toBe(true)
    expect(answered.body).toMatchObject({ error: { code: 'FORBIDDEN' } })
  })
})

describe('4. field permissions (SPEC.md §52)', () => {
  it('refuses a write to a field the agent may not write', async () => {
    const article = await Article.create({ title: 'One', internal: 'For editors' })

    const answered = await call('assemora.entries.update', {
      resource: 'articles',
      id: article.id,
      data: { internal: 'the agent should not manage this' },
    })

    expect(answered.failed).toBe(true)
    expect(answered.body).toMatchObject({ error: { code: 'FORBIDDEN' } })
    expect((await Article.findOrFail(article.id)).internal).toBe('For editors')
  })

  it('drops a field the agent may not read', async () => {
    await Article.create({ title: 'One', internal: 'For editors' })

    const answered = await call('assemora.entries.list', { resource: 'articles' })
    const listed = answered.body as { data: Record<string, unknown>[] }

    expect(listed.data[0]).toHaveProperty('title')
    expect(listed.data[0]).not.toHaveProperty('internal')
  })
})

describe('5. validation', () => {
  it('refuses input the command’s own schema rejects', async () => {
    const answered = await call('assemora.entries.update', {
      resource: 'articles',
      id: 'not-a-uuid',
    })

    expect(answered.failed).toBe(true)
    expect(answered.body).toMatchObject({ error: { code: 'VALIDATION_ERROR' } })
  })
})

describe('6. rate limits', () => {
  it('refuses once an agent has called too often', async () => {
    endpoint = await connectDirectly(
      createMcpServer({
        registry: app.registry,
        commands: app.commands,
        queries: app.queries,
        rateLimit: rateLimit({ max: 1, windowMs: 60_000 }),
      }),
    )

    await asAgent(
      rpc('initialize', {
        protocolVersion: '2025-06-18',
        capabilities: {},
        clientInfo: { name: 'test', version: '1' },
      }),
    )

    await call('assemora.describe', {})

    expect((await call('assemora.describe', {})).body).toMatchObject({
      error: { code: 'RATE_LIMITED' },
    })
  })
})

describe('7. audit', () => {
  it('records what the agent did, and that it came through MCP', async () => {
    await call('assemora.describe', {})

    const entry = await AuditLog.where('action', 'assemora.describe').firstOrFail()

    expect(entry).toMatchObject({ actorType: 'agent', source: 'mcp' })
  })

  it('records what it was refused, which is the entry that matters', async () => {
    await call('assemora.auth.users.list', {})

    expect((await AuditLog.where('action', 'auth.users.list').firstOrFail()).metadata.outcome).toBe(
      'failed',
    )
  })
})

describe('and the guarantee all seven exist for (SPEC.md §75)', () => {
  it('a mutation tool proposes, and production state does not move', async () => {
    const article = await Article.create({ title: 'Before', internal: null })

    const answered = await call('assemora.entries.update', {
      resource: 'articles',
      id: article.id,
      data: { title: 'After' },
    })

    expect(answered.failed).toBe(false)
    expect(answered.body).toMatchObject({ status: 'pending' })

    // The whole point.
    expect((await Article.findOrFail(article.id)).title).toBe('Before')
  })

  it('and applying it, as a person, is what changes anything', async () => {
    const article = await Article.create({ title: 'Before', internal: null })

    const proposed = await call('assemora.entries.update', {
      resource: 'articles',
      id: article.id,
      data: { title: 'After' },
    })

    const person = await User.where('email', 'ada@assemora.dev').firstOrFail()

    await app.run({ source: 'studio', actor: { type: 'user', id: person.id } }, () =>
      app.commands.execute('changesets.apply', { id: proposed.body.id }),
    )

    expect((await Article.findOrFail(article.id)).title).toBe('After')

    // The write is recorded as the person's, because apply runs in their context.
    const written = await AuditLog.where('action', 'entries.update').firstOrFail()

    expect(written).toMatchObject({ actorType: 'user', source: 'studio' })
  })
})

/**
 * An agent naming its own proposal (SPEC.md §74).
 *
 * §74 spells out one scenario — "add a block, then set its title" as a single
 * proposal — and it was unreachable. Every mutating tool was wrapped in
 * `changesets.propose`, and that command mutates, so it wrapped itself: an agent could
 * only ever propose one command at a time, each under a title this package wrote.
 * The Proposals screen showed rows called `blocks.update proposed by an agent`, which
 * told a person nothing the row did not already say.
 */
describe('a proposal an agent composed itself', () => {
  it('takes several commands and the agent’s own words', async () => {
    const first = await Article.create({ title: 'One', internal: null })
    const second = await Article.create({ title: 'Two', internal: null })

    const answered = await call('assemora.changesets.propose', {
      title: 'Rename both articles for the launch',
      commands: [
        {
          command: 'entries.update',
          input: { resource: 'articles', id: first.id, data: { title: 'First' } },
        },
        {
          command: 'entries.update',
          input: { resource: 'articles', id: second.id, data: { title: 'Second' } },
        },
      ],
    })

    expect(answered.failed).toBe(false)
    expect(answered.body).toMatchObject({ status: 'pending' })

    const stored = await ChangeSet.findOrFail(answered.body.id)

    expect(stored.title).toBe('Rename both articles for the launch')

    // Still a proposal: two commands change nothing until a person applies them.
    expect((await Article.findOrFail(first.id)).title).toBe('One')
    expect((await Article.findOrFail(second.id)).title).toBe('Two')
  })

  it('is not itself wrapped in a second proposal', async () => {
    const article = await Article.create({ title: 'Before', internal: null })

    const answered = await call('assemora.changesets.propose', {
      title: 'One change, named',
      commands: [
        {
          command: 'entries.update',
          input: { resource: 'articles', id: article.id, data: { title: 'After' } },
        },
      ],
    })

    // Wrapped, this would be a proposal *of* a proposal: the stored title would be
    // the sentence about `changesets.propose`, and the agent's own would be buried one
    // level down inside the commands, where nobody reads it.
    expect((await ChangeSet.findOrFail(answered.body.id)).title).toBe('One change, named')
  })

  it('titles a convenience call with what the command says it does', async () => {
    const article = await Article.create({ title: 'Before', internal: null })

    const answered = await call('assemora.entries.update', {
      resource: 'articles',
      id: article.id,
      data: { title: 'After' },
    })

    // A sentence somebody wrote about the command, rather than its name and a suffix.
    const stored = await ChangeSet.findOrFail(answered.body.id)

    expect(stored.title).not.toContain('proposed by an agent')
    expect(stored.title).toBeTruthy()
  })
})
