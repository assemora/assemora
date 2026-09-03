/**
 * `assemora mcp` — the project's MCP endpoint, over a pipe (SPEC.md §68, §76).
 *
 * The application already speaks the protocol; what it lacked was the transport every
 * client actually uses. Claude Code, Claude Desktop and Cursor start a process and talk
 * to it over stdin and stdout, and until this existed the only way in was a bespoke
 * `POST /api/mcp` that no such client knows how to reach.
 *
 * It reimplements nothing. The endpoint is the one `assemora()` built — the same
 * generated tools, the same buses, the same seven checks of SPEC.md §76 — handed over by
 * the project's own config, which is how this package drives a feature it may not import
 * (ADR-0021).
 *
 * The framing is newline-delimited JSON, which is what the MCP stdio transport specifies:
 * one message per line, and no message may contain a newline of its own. `JSON.stringify`
 * escapes them, so that holds by construction.
 */
import { createInterface } from 'node:readline'

import { ConfigurationError } from '@assemora/core'

import { loadConfig } from '../config.js'
import { detail } from '../output.js'
import { loadProject, type McpEndpoint } from '../project.js'
import { type CommandHandler, defineCommand, register } from '../registry.js'

/** The environment variable the token arrives in, because a pipe carries no headers. */
export const TOKEN_VARIABLE = 'ASSEMORA_AGENT_TOKEN'

export type McpSession = {
  /** Defaults to `process.stdin`. */
  readonly input?: NodeJS.ReadableStream
  /** Defaults to `process.stdout`. */
  readonly output?: NodeJS.WritableStream
}

/**
 * A JSON-RPC error, as a message rather than as a thrown thing.
 *
 * A transport that dies on a malformed line takes the session with it, and a client
 * that sent one bad message is owed an answer rather than a closed pipe. `-32700` is
 * parse error and `-32603` is internal error, both from the JSON-RPC 2.0 specification.
 */
const failure = (id: unknown, code: number, message: string) =>
  JSON.stringify({ jsonrpc: '2.0', id: id ?? null, error: { code, message } })

/** The id of a message that may not have parsed, for the error to be addressed to. */
const idOf = (line: string): unknown => {
  try {
    return (JSON.parse(line) as { id?: unknown }).id ?? null
  } catch {
    return null
  }
}

/**
 * Serves the endpoint until the input closes, and resolves when it has.
 *
 * Sequential on purpose. The protocol permits a client to have several requests in
 * flight, and answering them in order costs a stdio client nothing — it is one process
 * talking to one process — while concurrency here would put the ordering of two writes
 * to one pipe in the hands of whichever handler finished first.
 */
export const serveMcp = async (
  endpoint: McpEndpoint,
  token: string,
  session: McpSession = {},
): Promise<void> => {
  const input = session.input ?? process.stdin
  const output = session.output ?? process.stdout

  const lines = createInterface({ input, crlfDelay: Number.POSITIVE_INFINITY })

  for await (const line of lines) {
    const trimmed = line.trim()

    if (trimmed === '') continue

    let message: unknown

    try {
      message = JSON.parse(trimmed)
    } catch {
      output.write(`${failure(null, -32_700, 'That line is not JSON')}\n`)
      continue
    }

    try {
      const answered = await endpoint.handle(message, { token })

      // A notification is answered by not answering, and writing an empty line for one
      // is how a client comes to read a reply it never asked for.
      if (answered !== undefined) output.write(`${JSON.stringify(answered)}\n`)
    } catch (error) {
      // Reported to the client rather than thrown: a refused message is one message,
      // and the session is still good. What went wrong goes to stderr, which is not
      // the protocol's channel and is where a client shows a server's own output.
      const reason = error instanceof Error ? error.message : String(error)

      detail(reason)
      output.write(`${failure(idOf(trimmed), -32_603, reason)}\n`)
    }
  }

  input.pause()
}

const mcpCommand: CommandHandler = async ({ cwd }) => {
  // Loaded before the token is looked for, and the order is the whole point: a project
  // reads its own `.env` as it is imported — that is what makes one file serve `dev`,
  // `db:migrate` and everything else — so a token kept there is not in the environment
  // until this line has run. Asked for first, this command told a developer that
  // `ASSEMORA_AGENT_TOKEN` was unset while they were looking at it in `.env`.
  const loaded = await loadConfig(cwd)
  const project = await loadProject(loaded)

  const token = process.env[TOKEN_VARIABLE]

  if (token === undefined || token.trim() === '') {
    throw new ConfigurationError(
      `${TOKEN_VARIABLE} is not set, and an MCP session is somebody. Put it in .env, or ` +
        'run `assemora agents:create <name> --permissions … --write-mcp-json`, which ' +
        'creates the identity and writes both — an anonymous caller reaches every tool ' +
        'with no permissions at all, which is a confusing way to be refused.',
    )
  }

  if (project.mcp === undefined) {
    throw new ConfigurationError(
      `${loaded.file}: this project has no MCP endpoint. Assemble the application with ` +
        'assemora({ mcp: true }) and have the config return it whole — `app: () => ' +
        'createApp()` rather than `createApp().app`, which drops the half that speaks ' +
        'the protocol.',
    )
  }

  await serveMcp(project.mcp, token.trim())

  return 0
}

register(
  defineCommand({
    name: 'mcp',
    group: 'run',
    summary: 'serve this project to an agent over stdin and stdout',
    usage: 'assemora mcp',
    handler: mcpCommand,
  }),
)
