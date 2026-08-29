/**
 * The MCP server (SPEC.md §68 to §76).
 *
 * What is under test is that MCP is a transport and nothing more: every guarantee an
 * agent is held to lives in the pipeline, so it holds here without this package
 * implementing any of it.
 */
import {
  command,
  createApplication,
  createLogger,
  ForbiddenError,
  module,
  permitAll,
  silentWriter,
} from '@assemora/core'
import { string } from '@assemora/schema'
import { beforeEach, describe, expect, it } from 'vitest'

import { mcp } from './module.js'
import { RateLimitedError, rateLimit } from './rate-limit.js'
import { createMcpServer } from './server.js'
import { toolName, toolsOf } from './tools.js'
import { connectDirectly } from './transport.js'

const Publish = command('pages.publish', {
  description: 'Makes the draft tree the one visitors see',
  input: { id: string() },
  handle: async ({ id }) => ({ id, published: true }),
})

let app: ReturnType<typeof createApplication>

const build = (authorization = permitAll()) => {
  app = createApplication({
    modules: [module('pages').commands(Publish), mcp()],
    authorization,
    logger: createLogger(silentWriter),
  })

  return app.boot()
}

beforeEach(async () => {
  await build()
})

describe('the tool list is the registry (SPEC.md §69, §70)', () => {
  it('offers every registered command and query, prefixed', () => {
    const names = toolsOf(app.registry).map((tool) => tool.name)

    expect(names).toContain('assemora.pages.publish')
    expect(names).toContain('assemora.describe')
    expect(names).toContain('assemora.resources.list')
    expect(names).toContain('assemora.blocks.types')
  })

  it('does not prefix what is already prefixed', () => {
    expect(toolName('entries.create')).toBe('assemora.entries.create')
    expect(toolName('assemora.describe')).toBe('assemora.describe')
  })

  it('carries the name the bus knows, because the prefix cannot be undone', () => {
    const tools = toolsOf(app.registry)

    // `assemora.describe` is registered under that whole name. Stripping the prefix
    // to get back to a bus name would invent one nobody registered.
    expect(tools.find((tool) => tool.name === 'assemora.describe')?.bus).toBe('assemora.describe')
    expect(tools.find((tool) => tool.name === 'assemora.pages.publish')?.bus).toBe('pages.publish')
  })

  it('marks a read as a read, so a client knows what is safe', () => {
    const tools = toolsOf(app.registry)

    expect(tools.find((tool) => tool.name === 'assemora.describe')?.mutates).toBe(false)
    expect(tools.find((tool) => tool.name === 'assemora.pages.publish')?.mutates).toBe(true)
  })

  it('hands over the command’s own JSON Schema, unconverted', () => {
    const publish = toolsOf(app.registry).find((tool) => tool.name === 'assemora.pages.publish')

    expect(publish?.inputSchema).toMatchObject({
      type: 'object',
      properties: { id: { type: 'string' } },
      required: ['id'],
    })
  })
})

describe('assemora.describe (SPEC.md §71)', () => {
  it('answers with every section §71 names', async () => {
    const described = (await app.run({ source: 'mcp' }, () =>
      app.queries.execute('assemora.describe', {}),
    )) as Record<string, unknown>

    // The nine of §71, plus `queries` — an agent that can only see commands would
    // not know how to read anything.
    expect(Object.keys(described).sort()).toEqual([
      'blocks',
      'capabilities',
      'commands',
      'locales',
      'models',
      'pages',
      'permissions',
      'project',
      'queries',
      'resources',
    ])
  })

  it('names the languages this deployment serves (SPEC.md §131)', async () => {
    const multilingual = createApplication({
      modules: [mcp()],
      authorization: permitAll(),
      logger: createLogger(silentWriter),
      locales: ['uk', 'en'],
      defaultLocale: 'en',
    })

    await multilingual.boot()

    const described = (await multilingual.run({ source: 'mcp' }, () =>
      multilingual.queries.execute('assemora.describe', {}),
    )) as { locales: readonly { name: string; default: boolean }[] }

    // An agent asked to translate has to know what into, and this is where it reads it.
    expect(described.locales).toEqual([
      { name: 'uk', default: false },
      { name: 'en', default: true },
    ])
  })

  it('lists what an actor could be granted, because a command name is a permission', async () => {
    const described = (await app.run({ source: 'mcp' }, () =>
      app.queries.execute('assemora.describe', {}),
    )) as { permissions: string[] }

    expect(described.permissions).toContain('pages.publish')
    expect(described.permissions).toContain('assemora.describe')
  })

  it('says what this application can do, so an agent need not guess', async () => {
    const described = (await app.run({ source: 'mcp' }, () =>
      app.queries.execute('assemora.describe', {}),
    )) as { capabilities: string[] }

    expect(described.capabilities).toEqual(['pages'])
  })
})

describe('introspection is authorized like anything else (SPEC.md §76)', () => {
  it('refuses an agent that may not read the project', async () => {
    await build({ authorize: async () => Promise.reject(new ForbiddenError('no')) })

    await expect(
      app.run({ source: 'mcp', actor: { type: 'agent', id: 'a' } }, () =>
        app.queries.execute('assemora.describe', {}),
      ),
    ).rejects.toBeInstanceOf(ForbiddenError)
  })

  it('refuses a resource nobody declared', async () => {
    await expect(
      app.run({ source: 'mcp' }, () =>
        app.queries.execute('assemora.resources.describe', { name: 'nowhere' }),
      ),
    ).rejects.toMatchObject({ code: 'RESOURCE_NOT_FOUND' })
  })
})

describe('rate limits (SPEC.md §76)', () => {
  it('lets a burst through and then refuses', () => {
    const limit = rateLimit({ max: 3, windowMs: 60_000 })

    limit.check('agent-1')
    limit.check('agent-1')
    limit.check('agent-1')

    expect(() => limit.check('agent-1')).toThrowError(RateLimitedError)
  })

  it('counts each caller separately', () => {
    const limit = rateLimit({ max: 1, windowMs: 60_000 })

    limit.check('agent-1')

    expect(() => limit.check('agent-2')).not.toThrow()
  })

  it('forgets calls once the window has passed', async () => {
    const limit = rateLimit({ max: 1, windowMs: 5 })

    limit.check('agent-1')
    await new Promise((resolve) => setTimeout(resolve, 10))

    expect(() => limit.check('agent-1')).not.toThrow()
  })
})

describe('speaking the protocol (SPEC.md §68)', () => {
  const rpc = (method: string, params: unknown = {}, id = 1) => ({
    jsonrpc: '2.0' as const,
    id,
    method,
    params,
  })

  it('completes the handshake and then lists its tools', async () => {
    const server = createMcpServer({
      registry: app.registry,
      commands: app.commands,
      queries: app.queries,
    })
    const endpoint = await connectDirectly(server)

    const initialized = (await endpoint.handle(
      rpc('initialize', {
        protocolVersion: '2025-06-18',
        capabilities: {},
        clientInfo: { name: 'test', version: '1' },
      }),
    )) as { result: { serverInfo: { name: string } } }

    expect(initialized.result.serverInfo.name).toBe('assemora')

    await endpoint.handle({ jsonrpc: '2.0', method: 'notifications/initialized' })

    const listed = (await endpoint.handle(rpc('tools/list', {}, 2))) as {
      result: { tools: { name: string; inputSchema: unknown }[] }
    }

    const names = listed.result.tools.map((tool) => tool.name)

    expect(names).toContain('assemora.describe')
    expect(names).toContain('assemora.pages.publish')

    await endpoint.close()
  })

  it('runs a read tool through the Query Bus', async () => {
    const server = createMcpServer({
      registry: app.registry,
      commands: app.commands,
      queries: app.queries,
    })
    const endpoint = await connectDirectly(server)

    await endpoint.handle(
      rpc('initialize', {
        protocolVersion: '2025-06-18',
        capabilities: {},
        clientInfo: { name: 'test', version: '1' },
      }),
    )

    const called = (await app.run({ source: 'mcp' }, () =>
      endpoint.handle(rpc('tools/call', { name: 'assemora.describe', arguments: {} }, 3)),
    )) as { result: { content: { text: string }[] } }

    const text = called.result.content[0]?.text ?? '{}'

    if (JSON.parse(text).error !== undefined) throw new Error(text)

    expect((JSON.parse(text) as { capabilities: string[] }).capabilities).toEqual(['pages'])

    await endpoint.close()
  })

  it('says which tool it does not know, rather than "[object Object]"', async () => {
    const endpoint = await connectDirectly(
      createMcpServer({ registry: app.registry, commands: app.commands, queries: app.queries }),
    )

    const answered = (await endpoint.handle(
      rpc('tools/call', { name: 'assemora.nothing.here', arguments: {} }, 42),
    )) as { result: { content: { text: string }[] } }

    const body = JSON.parse(answered.result.content[0]?.text ?? '{}') as {
      error: { code: string; message: string }
    }

    expect(body.error.code).toBe('UNKNOWN_TOOL')
    expect(body.error.message).toContain('assemora.nothing.here')
  })

  it('answers an unknown tool as an error rather than throwing', async () => {
    const server = createMcpServer({
      registry: app.registry,
      commands: app.commands,
      queries: app.queries,
    })
    const endpoint = await connectDirectly(server)

    await endpoint.handle(
      rpc('initialize', {
        protocolVersion: '2025-06-18',
        capabilities: {},
        clientInfo: { name: 'test', version: '1' },
      }),
    )

    const called = (await endpoint.handle(
      rpc('tools/call', { name: 'assemora.nowhere', arguments: {} }, 4),
    )) as { result: { isError?: boolean; content: { text: string }[] } }

    expect(called.result.isError).toBe(true)
    expect(called.result.content[0]?.text).toContain('UNKNOWN_TOOL')

    await endpoint.close()
  })
})

describe('a command reachable only from its own route is not a tool (SPEC.md §85)', () => {
  const rpc = (method: string, params: unknown = {}, id = 1) => ({
    jsonrpc: '2.0' as const,
    id,
    method,
    params,
  })

  /**
   * The shape of the problem, in one declaration.
   *
   * `auth.login` is publicly authorized — it has to be, since the caller is nobody
   * yet — so agent permissions never gate it. As a generated tool it is a password
   * oracle for any agent token, and under `mutations: 'direct'` it hands that agent
   * a live user session.
   */
  const SignIn = command('auth.login', {
    description: 'Exchanges an email and a password for a session',
    reachableFrom: 'its own route',
    input: { email: string(), password: string() },
    handle: async () => ({ token: 'ses_secret' }),
  })

  beforeEach(async () => {
    app = createApplication({
      modules: [module('pages').commands(Publish), module('auth').commands(SignIn), mcp()],
      authorization: permitAll(),
      logger: createLogger(silentWriter),
    })

    await app.boot()
  })

  const speak = async (mutations?: 'direct') => {
    const endpoint = await connectDirectly(
      createMcpServer({
        registry: app.registry,
        commands: app.commands,
        queries: app.queries,
        ...(mutations === undefined ? {} : { mutations }),
      }),
    )

    await endpoint.handle(
      rpc('initialize', {
        protocolVersion: '2025-06-18',
        capabilities: {},
        clientInfo: { name: 'test', version: '1' },
      }),
    )

    return endpoint
  }

  it('leaves it out of the generated tool list', () => {
    const names = toolsOf(app.registry).map((tool) => tool.name)

    expect(names).toContain('assemora.pages.publish')
    expect(names).not.toContain('assemora.auth.login')
  })

  it('does not offer it over the protocol', async () => {
    const endpoint = await speak()

    const listed = (await endpoint.handle(rpc('tools/list', {}, 2))) as {
      result: { tools: { name: string }[] }
    }

    expect(listed.result.tools.map((tool) => tool.name)).not.toContain('assemora.auth.login')

    await endpoint.close()
  })

  it('refuses a call to it by name, so guessing the name is not a way in', async () => {
    const endpoint = await speak()

    const called = (await app.run({ source: 'mcp' }, () =>
      endpoint.handle(
        rpc(
          'tools/call',
          { name: 'assemora.auth.login', arguments: { email: 'ada@x.io', password: 'guess' } },
          3,
        ),
      ),
    )) as { result: { isError?: boolean; content: { text: string }[] } }

    expect(called.result.isError).toBe(true)
    expect(called.result.content[0]?.text).toContain('UNKNOWN_TOOL')

    // The oracle is what the refusal closes: a tool that answered differently for a
    // right and a wrong password would be one, whether it proposed or performed.
    expect(called.result.content[0]?.text).not.toContain('ses_secret')

    await endpoint.close()
  })

  it('is refused under `mutations: direct` too, where the answer would be a session', async () => {
    const endpoint = await speak('direct')

    const called = (await app.run({ source: 'mcp' }, () =>
      endpoint.handle(
        rpc(
          'tools/call',
          { name: 'assemora.auth.login', arguments: { email: 'ada@x.io', password: 'right' } },
          4,
        ),
      ),
    )) as { result: { isError?: boolean; content: { text: string }[] } }

    expect(called.result.isError).toBe(true)
    expect(called.result.content[0]?.text).not.toContain('ses_secret')

    await endpoint.close()
  })
})

describe('the ceiling counts agents, not tools (SPEC.md §76)', () => {
  it('gives each actor its own allowance rather than one shared per tool', () => {
    const limit = rateLimit({ max: 2, windowMs: 60_000 })

    limit.check('agent:one')
    limit.check('agent:one')

    expect(() => limit.check('agent:one')).toThrow(/Too many calls/)
    // The second agent is untouched by the first one's noise.
    expect(() => limit.check('agent:two')).not.toThrow()
  })

  it('spends one allowance across every tool an actor calls', async () => {
    const limited = await connectDirectly(
      createMcpServer({
        registry: app.registry,
        commands: app.commands,
        queries: app.queries,
        rateLimit: rateLimit({ max: 2, windowMs: 60_000 }),
      }),
    )

    const call = async (name: string) => {
      const answered = (await app.run({ source: 'mcp', actor: { type: 'agent', id: 'one' } }, () =>
        limited.handle({
          jsonrpc: '2.0',
          id: 7,
          method: 'tools/call',
          params: { name, arguments: {} },
        }),
      )) as { result: { content: { text: string }[] } }

      return (JSON.parse(answered.result.content[0]?.text ?? '{}') as { error?: { code: string } })
        .error?.code
    }

    expect(await call('assemora.describe')).toBeUndefined()
    expect(await call('assemora.resources.list')).toBeUndefined()
    // Two different tools, one actor: the third call is over the ceiling.
    expect(await call('assemora.blocks.types')).toBe('RATE_LIMITED')
  })
})
