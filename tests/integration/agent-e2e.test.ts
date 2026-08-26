/**
 * SPEC.md §97 — the mandatory MCP end-to-end scenario, and SPEC.md §122 — what an
 * agent must be able to do without reading source code.
 *
 * The two overlap almost entirely, so they are one walk here: an agent connects,
 * asks what this project is, finds the blocks it may use, reads the homepage,
 * proposes a change, watches production stay where it was, and a person applies it.
 * Then the revision that write left behind is restored, and the page is back.
 *
 * Nothing in this file reaches for a model or a table on the agent's behalf. Every
 * step is a tool call over the protocol, which is the claim being tested: the
 * scenario is reachable through MCP alone.
 */
import { audit, auditModule } from '@assemora/audit'
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
import { changeSets } from '@assemora/change-sets'
import {
  type Actor,
  clearRestorers,
  createApplication,
  createLogger,
  silentWriter,
} from '@assemora/core'
import { dataTransactions, useAdapter } from '@assemora/data'
import { createMemoryAdapter } from '@assemora/database'
import { connectDirectly, createMcpServer, type McpEndpoint, rateLimit } from '@assemora/mcp'
import { block, clearBlockRegistry, pages } from '@assemora/pages'
import { select, text } from '@assemora/resources'
import { revisions, revisionsModule } from '@assemora/revisions'
import { beforeEach, describe, expect, it } from 'vitest'

const Hero = block('hero', {
  title: text().required(),
  variant: select('centered', 'split'),
})

let app: ReturnType<typeof createApplication>
let endpoint: McpEndpoint
let agentToken: string
let person: Actor

/** A tool call, exactly as a connected agent makes it. */
const call = async (name: string, args: unknown = {}) => {
  const actor = await tokenActor(agentToken)

  if (actor === undefined) throw new Error('the token was not recognised')

  const answered = (await app.run({ source: 'mcp', actor }, () =>
    endpoint.handle({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name, arguments: args },
    }),
  )) as { result: { isError?: boolean; content: { text: string }[] } }

  if (answered.result.isError === true) {
    throw new Error(answered.result.content[0]?.text ?? 'the tool failed')
  }

  return JSON.parse(answered.result.content[0]?.text ?? '{}') as Record<string, unknown>
}

/** What a person does, from Studio. The other half of SPEC.md §75. */
const asPerson = <T>(operation: () => Promise<T>): Promise<T> =>
  app.run({ source: 'studio', actor: person }, operation)

const execute = (name: string, input: Record<string, unknown>) =>
  asPerson(() => app.commands.execute(name, input)) as Promise<Record<string, unknown>>

const read = (name: string, input: Record<string, unknown> = {}) =>
  asPerson(() => app.queries.execute(name, input)) as Promise<Record<string, unknown>>

beforeEach(async () => {
  clearPolicies()
  clearBlockRegistry()
  clearRestorers()
  useAdapter(createMemoryAdapter())

  const { mcp } = await import('@assemora/mcp')

  app = createApplication({
    modules: [
      auth(),
      pages({ blocks: [Hero] }),
      revisionsModule(),
      auditModule(),
      changeSets(),
      mcp({ project: { name: 'assemora-test', description: 'A site with one page' } }),
    ],
    authorization: policies(),
    transactions: dataTransactions(),
    revisions: revisions(),
    audit: audit(),
    logger: createLogger(silentWriter),
  })

  await app.boot()

  const editor = await User.create({
    email: 'ada@assemora.dev',
    name: 'Ada',
    passwordHash: await hashPassword('correct horse battery staple'),
    active: true,
    version: 1,
  })
  const role = await Role.create({ name: 'administrator', label: 'Admin', version: 1 })
  const everything = await Permission.create({ name: '*', description: null })

  await UserRole.create({ userId: editor.id, roleId: role.id })
  await RolePermission.create({ roleId: role.id, permissionId: everything.id })

  person = { type: 'user', id: editor.id }

  const created = await createAgent({
    name: 'content-agent',
    // A block edit is a page edit: `blocks.update` authorizes `pages.update`,
    // because that is the record it changes.
    permissions: ['assemora.*', 'pages.read', 'pages.update', 'changesets.propose'],
  })

  agentToken = created.token

  endpoint = await connectDirectly(
    createMcpServer({
      registry: app.registry,
      commands: app.commands,
      queries: app.queries,
      rateLimit: rateLimit({ max: 100, windowMs: 60_000 }),
    }),
  )

  await app.run({ source: 'mcp', actor: { type: 'agent', id: created.agentId } }, () =>
    endpoint.handle({
      jsonrpc: '2.0',
      id: 0,
      method: 'initialize',
      params: {
        protocolVersion: '2025-06-18',
        capabilities: {},
        clientInfo: { name: 'test', version: '1' },
      },
    }),
  )

  // The homepage the scenario reads, put there by a person, the way it would be.
  const home = (await execute('pages.create', { slug: 'home', title: 'Home' })) as { id: string }

  await execute('blocks.add', {
    id: home.id,
    type: 'hero',
    props: { title: 'Welcome', variant: 'centered' },
  })
})

describe('the mandatory scenario (SPEC.md §97, §122)', () => {
  it('walks it end to end, over the protocol', async () => {
    // → assemora.describe
    const project = (await call('assemora.describe')) as {
      project: { name: string }
      blocks: { name: string }[]
      commands: { name: string }[]
    }

    expect(project.project.name).toBe('assemora-test')
    expect(project.commands.map((entry) => entry.name)).toContain('pages.publish')

    // → discovers the blocks it may use, without being told they exist
    const types = (await call('assemora.blocks.types')) as unknown as { name: string }[]

    expect(types.map((entry) => entry.name)).toEqual(['hero'])

    // → reads the homepage
    const page = (await call('assemora.pages.get', { slug: 'home', mode: 'draft' })) as {
      id: string
      version: number
      tree: { blocks: { id: string; type: string; props: { title: string } }[] }
    }

    expect(page.tree.blocks[0]?.props.title).toBe('Welcome')

    // → proposes a Block mutation, and receives a Change Set with a diff
    const proposal = (await call('assemora.blocks.update', {
      id: page.id,
      blockId: page.tree.blocks[0]?.id,
      props: { title: 'Welcome home' },
    })) as { id: string; status: string; changes: { summary: string }[] }

    expect(proposal.status).toBe('pending')
    expect(proposal.changes.map((change) => change.summary)).toEqual(['hero — title changed'])

    // → and production has not moved
    const untouched = (await read('pages.get', { slug: 'home', mode: 'draft' })) as {
      tree: { blocks: { props: { title: string } }[] }
    }

    expect(untouched.tree.blocks[0]?.props.title).toBe('Welcome')

    // → applies the Change Set, which is a person's act
    const applied = (await execute('changesets.apply', { id: proposal.id })) as { status: string }

    expect(applied.status).toBe('applied')

    const changed = (await read('pages.get', { slug: 'home', mode: 'draft' })) as {
      tree: { blocks: { props: { title: string } }[] }
    }

    expect(changed.tree.blocks[0]?.props.title).toBe('Welcome home')

    // → a revision appears, and it is the agent's write, not the person's apply
    const history = (await read('revisions.list', {
      entityType: 'pages',
      entityId: page.id,
    })) as { data: { id: string; command: string }[] }

    expect(history.data[0]?.command).toBe('blocks.update')

    // → publishing is something the agent can ask for too
    await execute('pages.publish', { id: page.id })

    const published = (await read('pages.get', { slug: 'home' })) as {
      status: string
      tree: { blocks: { props: { title: string } }[] }
    }

    expect(published.status).toBe('published')
    expect(published.tree.blocks[0]?.props.title).toBe('Welcome home')

    // → restore that revision's `before`, and the original page is back
    const restoredId = history.data[0]?.id ?? ''

    await execute('revisions.restore', { id: restoredId, to: 'before' })

    const restored = (await read('pages.get', { slug: 'home', mode: 'draft' })) as {
      tree: { blocks: { props: { title: string } }[] }
    }

    expect(restored.tree.blocks[0]?.props.title).toBe('Welcome')
  })

  it('leaves a trail naming the agent for the proposal and the person for the write', async () => {
    const page = (await call('assemora.pages.get', { slug: 'home', mode: 'draft' })) as {
      id: string
      tree: { blocks: { id: string }[] }
    }

    const proposal = (await call('assemora.blocks.update', {
      id: page.id,
      blockId: page.tree.blocks[0]?.id,
      props: { title: 'Welcome home' },
    })) as { id: string }

    await execute('changesets.apply', { id: proposal.id })

    const log = (await read('audit.list', { perPage: 100 })) as {
      data: { action: string; actorType: string | null; source: string }[]
    }

    const proposed = log.data.find((entry) => entry.action === 'changesets.propose')
    const written = log.data.find((entry) => entry.action === 'blocks.update')

    expect(proposed?.actorType).toBe('agent')
    expect(proposed?.source).toBe('mcp')
    expect(written?.actorType).toBe('user')
    expect(written?.source).toBe('studio')
  })
})
