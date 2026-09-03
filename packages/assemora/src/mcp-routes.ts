/**
 * Where an agent speaks to this application (SPEC.md §68, §76).
 *
 * `@assemora/mcp` may not depend on `@assemora/http`, so somebody above both has to
 * mount the endpoint — the same contract `/auth/login` and the media URLs follow
 * (ADR-0017). What this adds is the one thing a transport owes the protocol: the
 * actor.
 *
 * The bearer token is resolved by the server before the message reaches this handler,
 * and everything downstream — permissions, policies, field permissions, audit — reads
 * it from the context. That is why none of those checks appear in this file.
 */
import { resolveActor } from '@assemora/auth'
import {
  type Application,
  AssemoraError,
  type CommandBus,
  type QueryBus,
  type SchemaRegistry,
} from '@assemora/core'
import { type Route, respond, route } from '@assemora/http'
import {
  connectDirectly,
  createMcpServer,
  type McpEndpoint,
  type MutationMode,
  rateLimit,
} from '@assemora/mcp'
import { json } from '@assemora/schema'

import type { RateWindow } from './options.js'

export type McpRouteOptions = {
  /**
   * The application, for the one transport that has to establish its own context.
   *
   * A route arrives with one already: `@assemora/http` resolves the actor and opens
   * the context before a handler sees anything. A message off a pipe arrives with
   * neither, so `handle` opens its own — which is also why it is here and not in
   * `@assemora/mcp`, a package that may not know what an actor is resolved from.
   */
  readonly application: Application
  readonly registry: SchemaRegistry
  readonly commands: CommandBus
  readonly queries: QueryBus
  readonly path: string
  readonly name: string
  readonly version: string
  readonly mutations: MutationMode
  readonly rateLimit: RateWindow
}

export type MountedMcp = {
  readonly routes: readonly Route[]
  /**
   * Answers one JSON-RPC message with no HTTP under it (SPEC.md §68).
   *
   * The route is one transport and stdio is another: `assemora mcp` is what a client
   * that speaks over a pipe — Claude Code, Claude Desktop, Cursor — connects to, and
   * it has no request to carry a header. So the credential arrives as an argument and
   * everything after it is identical, because the actor is the only thing a transport
   * owes the protocol.
   *
   * `undefined` for a notification, which JSON-RPC answers by not answering.
   */
  handle(message: unknown, credential: McpCredential): Promise<unknown>
  /** Closes the endpoint, so a stopped application leaves no server connected. */
  close(): Promise<void>
}

/** What a caller with no request presents instead of an `Authorization` header. */
export type McpCredential = {
  /** An agent token, as `auth.agents.create` issued it. */
  readonly token: string
}

export const mcpRoutes = (options: McpRouteOptions): MountedMcp => {
  // One server for the process: it remembers the initialization handshake, and a
  // fresh one per request would make every client shake hands twice.
  let endpoint: McpEndpoint | undefined

  const connect = async (): Promise<McpEndpoint> => {
    endpoint ??= await connectDirectly(
      createMcpServer({
        registry: options.registry,
        commands: options.commands,
        queries: options.queries,
        name: options.name,
        version: options.version,
        mutations: options.mutations,
        rateLimit: rateLimit(options.rateLimit),
      }),
    )

    return endpoint
  }

  /**
   * The refusal both transports give, worded once.
   *
   * An anonymous caller would reach the tools with no permissions at all, which is a
   * confusing way to be refused: every tool would answer that it is not allowed, and
   * none of them would say why.
   */
  const withoutAnAgent = () =>
    new AssemoraError('UNAUTHORIZED', 'This endpoint needs an agent token', { status: 401 })

  return {
    async handle(message, credential) {
      // Resolved here because there is no server above this one to have done it. The
      // header is synthesised rather than the resolver bypassed: one function decides
      // what a credential means, and a second reading of the same string is how the
      // two transports would come to disagree about who somebody is.
      const actor = await resolveActor({ authorization: `Bearer ${credential.token}` })

      if (actor === undefined) throw withoutAnAgent()

      // `source: 'mcp'` for the reason the route sets it: the audit log tells an
      // agent's door from everybody else's, and a pipe is the same door.
      return options.application.run({ source: 'mcp', actor }, async () =>
        (await connect()).handle(message),
      )
    },

    routes: [
      route.post(options.path, {
        description: 'The MCP endpoint. One JSON-RPC message per request',
        tags: ['mcp'],
        // So the audit log can tell an agent's door from everybody else's.
        source: 'mcp',
        // The body is a JSON-RPC envelope, which the SDK validates. Declaring a shape
        // here would be a second protocol definition.
        body: {},
        response: json<unknown>(),
        status: 200,
        errors: [
          { code: 'UNAUTHORIZED', status: 401, description: 'No agent token was recognised' },
        ],
        handler: async ({ actor, request }) => {
          // The actor the server already resolved, not a second lookup: resolving the
          // token again would be one more session read on every JSON-RPC message.
          //
          // An agent identity is the point: an anonymous caller would reach the tools
          // with no permissions at all, which is a confusing way to be refused.
          if (actor === undefined) throw withoutAnAgent()

          const message = (request as { body?: unknown }).body
          const answered = await (await connect()).handle(message)

          // A notification has no reply, and JSON-RPC says to answer it with nothing.
          return respond(answered ?? null, { status: answered === undefined ? 202 : 200 })
        },
      }),
    ],

    async close() {
      await endpoint?.close()
      endpoint = undefined
    },
  }
}
