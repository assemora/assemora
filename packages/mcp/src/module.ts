/**
 * The `mcp()` module (SPEC.md §68, §69).
 *
 * It registers the four introspection queries §69 names and nothing else. The rest
 * of the tools are the commands and queries the application already registered —
 * MCP does not add them, it exposes them.
 */
import { ConfigurationError, type ModuleBuilder, module, type SchemaRegistry } from '@assemora/core'

import { type McpQueryOptions, mcpQueries } from './queries.js'

export type McpModuleOptions = Omit<McpQueryOptions, 'registry'>

export const mcp = (options: McpModuleOptions = {}): ModuleBuilder => {
  // The registry arrives when the module is registered, which is after it is built.
  let held: SchemaRegistry | undefined

  const registry = (): SchemaRegistry => {
    if (held === undefined) {
      throw new ConfigurationError('The MCP module has not been registered yet')
    }

    return held
  }

  return module('mcp')
    .queries(...mcpQueries({ ...options, registry }))
    .boot((context) => {
      held = context.registry
    })
}
