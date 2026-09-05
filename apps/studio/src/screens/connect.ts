/**
 * What a person pastes to connect an agent (SPEC.md §70).
 *
 * A token on its own is a credential with no instructions, and the owner of a site is
 * not somebody who knows where a bearer header goes. So the moment the token exists in
 * a readable form, Studio writes the two things a client actually takes: the one-line
 * command Claude Code reads, and the JSON block Claude Desktop and Cursor read. Pure
 * functions of the address, the name and the token, so a test can read what a person
 * would paste.
 *
 * The address is the application's, from the registry: the Agents settings group
 * carries `mcp.path` (`/api/mcp`), and the origin is wherever Studio is open — which is
 * the origin the API answers on, because Studio is served beside it.
 */
import type { SettingsGroupDescriptor } from '../api/introspection.ts'

/** Where an agent connects, or nothing when the application mounts no MCP endpoint. */
export const mcpAddress = (
  settings: readonly SettingsGroupDescriptor[] | undefined,
  origin: string,
): string | undefined => {
  const row = settings
    ?.find((group) => group.name === 'agents')
    ?.blocks.flatMap((block) => block.rows)
    .find((one) => one.key === 'mcp.path')

  if (row === undefined || row.kind !== 'value') return undefined

  // The value is one path, not a sentence: written once, whatever languages the label is in.
  const path = typeof row.value === 'string' ? row.value : Object.values(row.value)[0]

  return path === undefined || path === '' ? undefined : `${origin.replace(/\/+$/, '')}${path}`
}

/** `Content agent` → `content-agent`: what a client lists the connector as. */
export const connectorName = (agentName: string): string => {
  const slug = agentName
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')

  return slug === '' ? 'assemora' : slug
}

export type Connection = {
  readonly name: string
  readonly url: string
  readonly token: string
}

/** The one line Claude Code takes. `-s user` so it is the person's, in every project. */
export const claudeCodeCommand = ({ name, url, token }: Connection): string =>
  `claude mcp add --transport http -s user ${name} ${url} --header "Authorization: Bearer ${token}"`

/** The block Claude Desktop, Cursor and the like read from their own configuration. */
export const mcpJson = ({ name, url, token }: Connection): string =>
  JSON.stringify(
    {
      mcpServers: {
        [name]: { type: 'http', url, headers: { Authorization: `Bearer ${token}` } },
      },
    },
    null,
    2,
  )
