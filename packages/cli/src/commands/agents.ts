/**
 * `assemora agents:create` — an agent identity and the token that is it (SPEC.md §72).
 *
 * Until this existed there was no documented way to get one. The command was on the
 * bus and reachable through the generic `POST /api/commands/auth.agents.create`, which
 * needs an administrator session first and is written down nowhere; Studio's Agents tab
 * lists and enables; `assemora agents` lists. So the answer to "how do I connect an
 * agent" was to read the source, and everybody who found `/api/mcp` instead met a 401
 * with no route past it.
 *
 * It reimplements nothing: the identity is created by `auth.agents.create` on the
 * Command Bus, so it is validated, authorized, audited and refused exactly as it is
 * from anywhere else (ADR-0021). What this adds is the part a terminal is good at —
 * showing the token once, and writing the file a client reads.
 */
import { chmod, readFile, writeFile } from 'node:fs/promises'
import { relative, resolve } from 'node:path'

import type { Actor, ContextInit } from '@assemora/core'

import { bool, flag, type ParsedArgs } from '../args.js'
import { loadConfig } from '../config.js'
import { detail, fail, line, ok, warn } from '../output.js'
import { loadApplication } from '../project.js'
import { type CommandHandler, defineCommand, register } from '../registry.js'
import { TOKEN_VARIABLE } from './mcp.js'

const CREATE = 'auth.agents.create'

/** Where `--write-mcp-json` writes when it is given no path. */
export const MCP_CONFIG_FILE = '.mcp.json'

/** Where a project keeps its secrets, and where the token goes. */
export const ENV_FILE = '.env'

/**
 * The permissions, from a comma-separated list.
 *
 * One flag rather than a repeated one, because the parser keeps the last value of a
 * repeated flag and `--permissions a --permissions b` would silently mean `b` — a
 * narrower agent than the person asked for, which is the direction that fails quietly.
 *
 * Empty entries are dropped rather than passed on: `--permissions "pages.read,"` is a
 * trailing comma, not a request for a permission with no name.
 */
export const permissionsOf = (args: ParsedArgs): readonly string[] =>
  (flag(args, 'permissions') ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry !== '')

/**
 * The client configuration, as a client reads it — and with no credential in it.
 *
 * `pnpm assemora mcp` rather than a path: the executable is a dependency of the project
 * rather than a global one, and the package manager that put it there is the one thing
 * this file cannot know from the outside. `cwd` is written absolute, because a client
 * starts the process from wherever it happens to be.
 *
 * No `env`, deliberately. The token would make this a secret file, and it is the file
 * most likely to be committed: it is the project's client configuration, it is the same
 * for everybody working on it, and it is the sort of thing somebody adds to a
 * repository without thinking. So the token goes where this project already keeps its
 * secrets — `.env`, which is gitignored and which the project reads as it is imported —
 * and the process the client starts inherits it.
 */
export const mcpConfig = (project: string, name: string) => ({
  mcpServers: {
    [name]: {
      command: 'pnpm',
      args: ['assemora', 'mcp'],
      cwd: project,
    },
  },
})

/**
 * Writes `name=value` into a project's `.env`, replacing whatever that name said.
 *
 * Replacing rather than appending: a second agent for the same project is the ordinary
 * case, and a file that grew a line each time would end up a column of dead
 * credentials with no way to tell which one is live. Every other line is carried
 * through untouched, so a `.env` written by hand keeps its comments and its order.
 */
export const remember = async (file: string, name: string, value: string): Promise<void> => {
  const existing = await readFile(file, 'utf8').catch(() => '')

  const kept = existing
    .split('\n')
    .filter((line) => !line.startsWith(`${name}=`))
    .join('\n')
    .trimEnd()

  await writeFile(file, `${kept === '' ? '' : `${kept}\n`}${name}=${value}\n`, { mode: 0o600 })

  // `writeFile`'s mode applies only to a file it creates, so an existing `.env` keeps
  // whatever permissions it had. Narrow it either way: it holds a credential now.
  await chmod(file, 0o600)
}

/** `Content agent` becomes `content-agent`, which is what a client shows in a list. */
const slug = (name: string): string =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'assemora'

const refusalHint = (actorId: string | undefined): string =>
  actorId === undefined
    ? 'Creating an agent is authorized like every other command, and no actor was named. ' +
      'Pass --actor <user id> — a user who holds auth.agents.create.'
    : `${actorId} may not create an agent, or may not grant one of those permissions: an ` +
      'actor cannot hand an agent a permission it does not hold itself (SPEC.md §72).'

const isRefusal = (error: unknown): boolean => {
  const status = (error as { status?: unknown }).status

  return typeof status === 'number' && status >= 400 && status < 500
}

const agentsCreate: CommandHandler = async ({ args, cwd }) => {
  const name = args.positionals[0]

  if (name === undefined || name.trim() === '') {
    fail('An agent needs a name. It is what a person reads in the audit log.')
    detail('assemora agents:create "Content agent" --permissions pages.read,blocks.update')

    return 2
  }

  const permissions = permissionsOf(args)

  if (permissions.length === 0) {
    fail('An agent with no permissions can reach every tool and do none of them.')
    detail('Pass --permissions, comma-separated: --permissions pages.read,blocks.update')

    return 2
  }

  const app = await loadApplication(await loadConfig(cwd))

  if (!app.commands.has(CREATE)) {
    fail(
      `This application registers no "${CREATE}", so it has no agent identities to create. ` +
        'They come with @assemora/auth (SPEC.md §72).',
    )

    return 1
  }

  const named = flag(args, 'actor')
  const actor: Actor | undefined = named === undefined ? undefined : { type: 'user', id: named }
  const context: ContextInit = { source: 'cli', ...(actor === undefined ? {} : { actor }) }
  const description = flag(args, 'description')

  let created: { readonly agentId: string; readonly token: string }

  try {
    created = (await app.run(context, () =>
      app.commands.execute(CREATE, {
        name: name.trim(),
        permissions,
        ...(description === undefined ? {} : { description }),
      }),
    )) as { agentId: string; token: string }
  } catch (error) {
    if (!isRefusal(error)) throw error

    fail(error instanceof Error ? error.message : String(error))
    detail(refusalHint(named))

    return 1
  }

  ok(
    `Created ${name.trim()} — ${permissions.length} permission${permissions.length === 1 ? '' : 's'}.`,
  )
  line()
  line(created.token)
  line()

  // Said plainly, because it is true and because the next thing somebody does is close
  // the terminal. The row stores a SHA-256 digest of it and nothing else, so there is
  // no second chance and no support call that can recover it.
  warn('That token is shown once. It is stored hashed, so nothing can print it again.')

  if (!bool(args, 'write-mcp-json')) {
    detail(`Put it in .env as ${TOKEN_VARIABLE}, or pass --write-mcp-json next time.`)

    return 0
  }

  const target = resolve(cwd, flag(args, 'write-mcp-json') ?? MCP_CONFIG_FILE)

  // Two files, and the split is the point: the credential goes where this project
  // already keeps its secrets, and the client configuration — which is the same for
  // everybody working here and is the sort of file that gets committed — holds none.
  await remember(resolve(cwd, ENV_FILE), TOKEN_VARIABLE, created.token)
  await writeFile(target, `${JSON.stringify(mcpConfig(cwd, slug(name)), null, 2)}\n`)

  line()
  ok(`Wrote ${ENV_FILE} and ${relative(cwd, target) || target}`)
  detail(`${ENV_FILE} holds the token and is the one to keep out of git.`)

  return 0
}

register(
  defineCommand({
    name: 'agents:create',
    group: 'identity',
    summary: 'create an agent identity and print its token once',
    usage:
      'assemora agents:create <name> --permissions <a,b> [--description <text>] [--actor <id>] [--write-mcp-json [path]]',
    handler: agentsCreate,
  }),
)
