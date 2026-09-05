/**
 * What a person pastes to connect an agent — read as they would read it.
 */
import { describe, expect, it } from 'vitest'

import type { SettingsGroupDescriptor } from '../api/introspection.ts'
import { claudeCodeCommand, connectorName, mcpAddress, mcpJson } from './connect.ts'

const AGENTS: SettingsGroupDescriptor = {
  name: 'agents',
  section: 'platform',
  label: 'Agents',
  blocks: [
    {
      title: 'Endpoint',
      rows: [
        { key: 'mcp.path', kind: 'value', label: { en: 'MCP address' }, value: '/api/mcp' },
        { key: 'mcp.mutations', kind: 'value', label: 'Mode', value: { en: 'Proposals' } },
      ],
    },
  ],
}

describe('the address an agent connects to', () => {
  it('is the origin Studio is open on plus the path the registry states', () => {
    expect(mcpAddress([AGENTS], 'https://papacotta.com.ua')).toBe(
      'https://papacotta.com.ua/api/mcp',
    )
    expect(mcpAddress([AGENTS], 'http://localhost:4100/')).toBe('http://localhost:4100/api/mcp')
  })

  it('is nothing when the application mounts no endpoint, rather than a guessed path', () => {
    expect(mcpAddress([], 'https://papacotta.com.ua')).toBeUndefined()
    expect(mcpAddress(undefined, 'https://papacotta.com.ua')).toBeUndefined()
  })
})

describe('what is pasted', () => {
  it('names the connector after the agent, as a word a client accepts', () => {
    expect(connectorName('Content agent')).toBe('content-agent')
    expect(connectorName('Папа Котта')).toBe('assemora')
    expect(connectorName('  Kitchen  (night) ')).toBe('kitchen-night')
  })

  it('writes the one line Claude Code takes, with the token in the bearer header', () => {
    expect(
      claudeCodeCommand({
        name: 'papacotta',
        url: 'https://papacotta.com.ua/api/mcp',
        token: 'abc',
      }),
    ).toBe(
      'claude mcp add --transport http -s user papacotta https://papacotta.com.ua/api/mcp --header "Authorization: Bearer abc"',
    )
  })

  it('writes the block every other client reads, and it parses', () => {
    const text = mcpJson({ name: 'papacotta', url: 'https://x/api/mcp', token: 'abc' })

    expect(JSON.parse(text)).toEqual({
      mcpServers: {
        papacotta: {
          type: 'http',
          url: 'https://x/api/mcp',
          headers: { Authorization: 'Bearer abc' },
        },
      },
    })
  })
})
