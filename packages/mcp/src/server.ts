/**
 * The MCP server (SPEC.md §68, §76).
 *
 * It has no business logic. Every tool call is `queries.execute`,
 * `commands.dryRun` or `commands.execute` — so an agent passes exactly the checks a
 * person passes, and direct database access is not merely discouraged but absent:
 * this package cannot reach a database, and `pnpm boundaries` keeps it that way.
 *
 * The protocol implementation is `@modelcontextprotocol/sdk`, and this file is the
 * only thing in the repository that imports it (ADR-0020).
 */
import { type CommandBus, currentContext, type QueryBus, type SchemaRegistry } from '@assemora/core'
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'

import { type RateLimit, rateLimit } from './rate-limit.js'
import { type ToolDescriptor, toolsOf } from './tools.js'

/**
 * What a mutation tool does when an agent calls it.
 *
 * `change-set` is the default and the one SPEC.md §75 requires: the tool previews
 * and proposes, and production state changes when a person applies. `direct` runs
 * the command, and exists for an application that has decided an agent may act
 * alone.
 */
export type MutationMode = 'change-set' | 'direct'

export type McpServerOptions = {
  readonly registry: SchemaRegistry
  readonly commands: CommandBus
  readonly queries: QueryBus
  readonly name?: string
  readonly version?: string
  readonly mutations?: MutationMode
  readonly rateLimit?: RateLimit
}

/** What a tool answers with. Text, because that is what the protocol carries. */
const answer = (value: unknown) => ({
  content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }],
})

const messageOf = (error: unknown): string => {
  if (error instanceof Error) return error.message

  const message = (error as { message?: unknown }).message

  return typeof message === 'string' ? message : String(error)
}

const failure = (error: unknown) => ({
  content: [
    {
      type: 'text' as const,
      text: JSON.stringify(
        {
          error: {
            code: (error as { code?: string }).code ?? 'ERROR',
            // An agent reads this and decides what to do next, so it has to be a
            // sentence. `String(error)` on the plain objects raised here for a
            // refusal turns every one of them into "[object Object]".
            message: messageOf(error),
            ...((error as { fields?: unknown }).fields === undefined
              ? {}
              : { fields: (error as { fields?: unknown }).fields }),
          },
        },
        null,
        2,
      ),
    },
  ],
  isError: true,
})

export const createMcpServer = (options: McpServerOptions): Server => {
  const mutations = options.mutations ?? 'change-set'
  const limit = options.rateLimit ?? rateLimit()

  const server = new Server(
    { name: options.name ?? 'assemora', version: options.version ?? '0.0.0' },
    { capabilities: { tools: {} } },
  )

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: toolsOf(options.registry).map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema,
      annotations: { readOnlyHint: !tool.mutates },
    })),
  }))

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const tools = toolsOf(options.registry)
    const tool = tools.find((entry: ToolDescriptor) => entry.name === request.params.name)

    if (tool === undefined) {
      return failure({ code: 'UNKNOWN_TOOL', message: `No tool named "${request.params.name}"` })
    }

    const name = tool.bus
    const input = request.params.arguments ?? {}

    try {
      // The context — and therefore the actor — is established by whoever mounted
      // this server, before the request reaches here. That is what makes the actor's
      // permissions apply (SPEC.md §76), and it is what the ceiling counts against:
      // keyed by the tool instead, one busy agent would lock every other agent out of
      // that tool, while each agent got `tools × max` calls a minute overall.
      const actor = currentContext()?.actor

      limit.check(actor === undefined ? 'anonymous' : `${actor.type}:${actor.id}`)

      if (!tool.mutates) return answer(await options.queries.execute(name, input))

      if (mutations === 'direct') return answer(await options.commands.execute(name, input))

      // The two commands that *are* the proposal mechanism run as themselves: one
      // would wrap itself, and the other would need a proposal approved before a
      // proposal could be refused. It is also how an agent composes a proposal of its
      // own — several commands, under a name it chose — which is the scenario SPEC.md
      // §74 spells out and which was unreachable while this wrapped everything.
      //
      // Nothing is weakened. `changesets.apply` is still wrapped, so production state
      // changes when a person applies and not before (SPEC.md §75).
      if (!tool.proposable) return answer(await options.commands.execute(name, input))

      // A mutation is a proposal. Production state does not change before somebody
      // applies it (SPEC.md §75).
      return answer(
        await options.commands.execute('changesets.propose', {
          // The command's own description, which is a sentence somebody wrote about
          // what it does, rather than its name and a suffix. This title is read on the
          // Proposals screen, where `blocks.update proposed by an agent` told a person
          // nothing they could not see from the row it sat on. An agent that wants to
          // say more calls `changesets.propose` and titles it itself.
          title: tool.description,
          commands: [{ command: name, input }],
        }),
      )
    } catch (error) {
      return failure(error)
    }
  })

  return server
}
