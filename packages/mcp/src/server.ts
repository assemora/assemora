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
import type { CommandBus, QueryBus, SchemaRegistry } from '@assemora/core'
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

const failure = (error: unknown) => ({
  content: [
    {
      type: 'text' as const,
      text: JSON.stringify(
        {
          error: {
            code: (error as { code?: string }).code ?? 'ERROR',
            message: error instanceof Error ? error.message : String(error),
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
      // permissions apply (SPEC.md §76).
      limit.check(name)

      if (!tool.mutates) return answer(await options.queries.execute(name, input))

      if (mutations === 'direct') return answer(await options.commands.execute(name, input))

      // A mutation is a proposal. Production state does not change before somebody
      // applies it (SPEC.md §75).
      return answer(
        await options.commands.execute('changesets.propose', {
          title: `${name} proposed by an agent`,
          commands: [{ command: name, input }],
        }),
      )
    } catch (error) {
      return failure(error)
    }
  })

  return server
}
