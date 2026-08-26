/**
 * `@assemora/mcp` — the same application, spoken to by a machine (SPEC.md §68).
 *
 * ```ts
 * const server = createMcpServer({
 *   registry: app.registry,
 *   commands: app.commands,
 *   queries: app.queries,
 * })
 * ```
 *
 * There is no business logic here. A tool call is a query, a dry run or a proposal
 * on the same buses Studio and REST use, so an agent passes token authentication,
 * its own permissions, policies, field permissions, validation, rate limits and
 * audit — the seven checks SPEC.md §76 requires — because those live in the
 * pipeline rather than in the transport.
 *
 * The tools are generated from the Schema Registry, so a `resource()` or a `block()`
 * added to an application is a tool without anybody editing a list (ADR-0020).
 *
 * A mutation tool proposes rather than mutates: it previews the command and stores a
 * change set, and production state changes when a person applies it (SPEC.md §75).
 */

export { type McpModuleOptions, mcp } from './module.js'
export { type McpQueryOptions, mcpQueries } from './queries.js'
export {
  type RateLimit,
  RateLimitedError,
  type RateLimitOptions,
  rateLimit,
} from './rate-limit.js'
export {
  createMcpServer,
  type McpServerOptions,
  type MutationMode,
} from './server.js'
export {
  TOOL_PREFIX,
  type ToolDescriptor,
  toolName,
  toolsOf,
} from './tools.js'
export { connectDirectly, type McpEndpoint } from './transport.js'
