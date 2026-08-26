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
import { busName, toolName, toolsOf } from './tools.js'

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
    expect(busName('assemora.entries.create')).toBe('entries.create')
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
