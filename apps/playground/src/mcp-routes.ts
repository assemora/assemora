/**
 * Where an agent speaks to this application (SPEC.md §68, §76).
 *
 * `@assemora/mcp` may not depend on `@assemora/http`, so the application mounts the
 * endpoint — the same contract `/auth/login` and the media URLs already follow
 * (ADR-0017). What it adds is the one thing a transport owes the protocol: the actor.
 *
 * The bearer token is resolved before the message reaches the server, and everything
 * downstream — permissions, policies, field permissions, audit — reads it from the
 * context. That is why none of those checks appear in this file.
 */
import { resolveActor } from '@assemora/auth'
import { AssemoraError, type CommandBus, type QueryBus, type SchemaRegistry } from '@assemora/core'
import { type Route, respond, route } from '@assemora/http'
import { connectDirectly, createMcpServer, type McpEndpoint, rateLimit } from '@assemora/mcp'
import { json } from '@assemora/schema'

export type McpRouteOptions = {
  readonly registry: SchemaRegistry
  readonly commands: CommandBus
  readonly queries: QueryBus
}

export const mcpRoutes = (options: McpRouteOptions): Route[] => {
  // One server for the process: it remembers the initialization handshake, and a
  // fresh one per request would make every client shake hands twice.
  let endpoint: McpEndpoint | undefined

  const connect = async (): Promise<McpEndpoint> => {
    endpoint ??= await connectDirectly(
      createMcpServer({
        registry: options.registry,
        commands: options.commands,
        queries: options.queries,
        name: 'assemora-playground',
        version: '0.0.0',
        // The default, spelled out: an agent proposes and a person applies
        // (SPEC.md §75).
        mutations: 'change-set',
        rateLimit: rateLimit({ max: 120, windowMs: 60_000 }),
      }),
    )

    return endpoint
  }

  return [
    route.post('/mcp', {
      description: 'The MCP endpoint. One JSON-RPC message per request',
      tags: ['mcp'],
      // So the audit log can tell an agent's door from everybody else's.
      source: 'mcp',
      // The body is a JSON-RPC envelope, which the SDK validates. Declaring a shape
      // here would be a second protocol definition.
      body: {},
      response: json<unknown>(),
      status: 200,
      errors: [{ code: 'UNAUTHORIZED', status: 401, description: 'No agent token was recognised' }],
      handler: async ({ headers, request }) => {
        const actor = await resolveActor(headers)

        // An agent identity is the point: an anonymous caller would reach the tools
        // with no permissions at all, which is a confusing way to be refused.
        if (actor === undefined) {
          throw new AssemoraError('UNAUTHORIZED', 'This endpoint needs an agent token', {
            status: 401,
          })
        }

        const message = (request as { body?: unknown }).body
        const answered = await (await connect()).handle(message)

        // A notification has no reply, and JSON-RPC says to answer it with nothing.
        return respond(answered ?? null, { status: answered === undefined ? 202 : 200 })
      },
    }),
  ]
}
