/**
 * Tools, generated from the Schema Registry (SPEC.md §68, §69, §70).
 *
 * Every registered command and query becomes a tool. The names SPEC.md §69 and §70
 * list are what generation produces — `entries.create`, `pages.publish`,
 * `blocks.add`, `revisions.restore` are already registered under exactly those names,
 * because a command name is a permission name (ADR-0015).
 *
 * A hand-written list was rejected: it drifts the moment somebody adds a resource or
 * a block type, and the registry exists precisely so subsystems stop keeping their
 * own copies (ADR-0002, ADR-0020).
 */
import type { SchemaRegistry } from '@assemora/core'
import type { JsonSchema } from '@assemora/schema'

/** The MCP wire shape for a tool. Plain JSON Schema — no second schema system. */
export type ToolDescriptor = {
  readonly name: string
  readonly description: string
  readonly inputSchema: { readonly type: 'object' } & JsonSchema
  /** Whether calling it would change anything, which decides how it is handled. */
  readonly mutates: boolean
}

export const TOOL_PREFIX = 'assemora.'

/** `entries.create` becomes `assemora.entries.create`; `assemora.describe` stays. */
export const toolName = (busName: string): string =>
  busName.startsWith(TOOL_PREFIX) ? busName : `${TOOL_PREFIX}${busName}`

/** And back again, because the bus knows nothing about the prefix. */
export const busName = (tool: string): string =>
  tool.startsWith(TOOL_PREFIX) ? tool.slice(TOOL_PREFIX.length) : tool

const objectSchema = (input: unknown): { type: 'object' } & JsonSchema => {
  const schema = (input ?? {}) as JsonSchema

  // A tool's input schema must be an object at the top level; the protocol says so
  // and every command and query input already is one.
  return { ...schema, type: 'object' }
}

type Described = { readonly name: string; readonly description?: string; readonly input?: unknown }

/**
 * Every tool this application offers.
 *
 * Queries and commands are both here, and the difference is `mutates` — which is
 * what makes a mutation go through a change set rather than through the database
 * (SPEC.md §73, ADR-0019).
 */
export const toolsOf = (registry: SchemaRegistry): ToolDescriptor[] => {
  const sections = registry.describe() as Readonly<Record<string, readonly Described[]>>

  const describe = (entry: Described, mutates: boolean): ToolDescriptor => ({
    name: toolName(entry.name),
    description: entry.description ?? entry.name,
    inputSchema: objectSchema(entry.input),
    mutates,
  })

  return [
    ...(sections.queries ?? []).map((entry) => describe(entry, false)),
    ...(sections.commands ?? []).map((entry) => describe(entry, true)),
  ].sort((left, right) => left.name.localeCompare(right.name))
}
