/**
 * `assemora agents:create` (SPEC.md §72, §77).
 *
 * What is checked here is the part that belongs to a terminal: how the permissions are
 * read off the invocation, and what goes into the file a client reads. Creating the
 * identity is `auth.agents.create` on the Command Bus and is tested where it lives —
 * this command adds no rule of its own and could not.
 */
import { describe, expect, it } from 'vitest'

import { parseArgs } from '../args.js'
import { MCP_CONFIG_FILE, mcpConfig, permissionsOf } from './agents.js'

const invoked = (...argv: string[]) => parseArgs(['agents:create', 'Content agent', ...argv])

describe('the permissions an invocation asks for', () => {
  it('reads a comma-separated list', () => {
    expect(permissionsOf(invoked('--permissions', 'pages.read,blocks.update'))).toEqual([
      'pages.read',
      'blocks.update',
    ])
  })

  it('reads the equals spelling too, because both get typed', () => {
    expect(permissionsOf(invoked('--permissions=pages.read'))).toEqual(['pages.read'])
  })

  it('forgives the spaces somebody quoted', () => {
    expect(permissionsOf(invoked('--permissions', 'pages.read, blocks.update'))).toEqual([
      'pages.read',
      'blocks.update',
    ])
  })

  it('drops a trailing comma rather than asking for a permission with no name', () => {
    expect(permissionsOf(invoked('--permissions', 'pages.read,'))).toEqual(['pages.read'])
  })

  it('is empty when the flag is absent, which the command refuses', () => {
    // An agent with no permissions reaches every tool and can do none of them, which
    // is the most confusing way to be refused.
    expect(permissionsOf(invoked())).toEqual([])
  })

  it('is empty when the flag was written with no value', () => {
    expect(permissionsOf(invoked('--permissions'))).toEqual([])
  })
})

describe('the file a client reads', () => {
  const written = mcpConfig('/work/my-project', 'content-agent')

  it('names the server after the agent, so a client can tell two apart', () => {
    expect(Object.keys(written.mcpServers)).toEqual(['content-agent'])
  })

  it('starts the project’s own executable, through its package manager', () => {
    // The binary is a dependency rather than a global one, so the bare name is not on
    // anybody's path; and a client starts the process from wherever it happens to be,
    // which is why the directory is absolute.
    expect(written.mcpServers['content-agent']).toMatchObject({
      command: 'pnpm',
      args: ['assemora', 'mcp'],
      cwd: '/work/my-project',
    })
  })

  /**
   * The whole reason the token is not here.
   *
   * This file is the project's client configuration: the same for everybody working on
   * it, and the sort of thing somebody adds to a repository without thinking. So it
   * holds no credential, and the token goes to `.env` — gitignored, and read by the
   * project as it is imported, which is what puts it in the environment of the process
   * a client starts.
   */
  it('carries no credential at all', () => {
    expect(JSON.stringify(written)).not.toContain('TOKEN')
    expect(written.mcpServers['content-agent']).not.toHaveProperty('env')
  })

  it('is JSON a client can parse, holding nothing else', () => {
    expect(JSON.parse(JSON.stringify(written))).toEqual(written)
  })

  it('goes to .mcp.json unless a path says otherwise', () => {
    expect(MCP_CONFIG_FILE).toBe('.mcp.json')
  })
})
