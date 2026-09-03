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
import type { CommandReach, SchemaRegistry } from '@assemora/core'
import type { JsonSchema } from '@assemora/schema'

/** The MCP wire shape for a tool. Plain JSON Schema — no second schema system. */
export type ToolDescriptor = {
  /** What the agent calls it. */
  readonly name: string
  /**
   * What the bus calls it, carried rather than derived.
   *
   * Deriving it would mean inverting `toolName`, and that inverse does not exist:
   * the introspection queries are registered as `assemora.describe` already, so
   * stripping the prefix would turn a real name into one nobody registered.
   */
  readonly bus: string
  readonly description: string
  readonly inputSchema: { readonly type: 'object' } & JsonSchema
  /** Whether calling it would change anything, which decides how it is handled. */
  readonly mutates: boolean
  /**
   * Whether a mutation of this tool becomes a proposal (SPEC.md §75, ADR-0019).
   *
   * True for every mutating tool but the two that *are* the proposal mechanism. It is
   * read off the command's own declaration rather than decided here: a package that
   * generates a tool for every command must not also keep a list of the special ones
   * (ADR-0020).
   */
  readonly proposable: boolean
}

export const TOOL_PREFIX = 'assemora.'

/** `entries.create` becomes `assemora.entries.create`; `assemora.describe` stays. */
export const toolName = (busName: string): string =>
  busName.startsWith(TOOL_PREFIX) ? busName : `${TOOL_PREFIX}${busName}`

const objectSchema = (input: unknown): { type: 'object' } & JsonSchema => {
  const schema = (input ?? {}) as JsonSchema

  // A tool's input schema must be an object at the top level; the protocol says so
  // and every command and query input already is one.
  return { ...schema, type: 'object' }
}

type Described = {
  readonly name: string
  readonly description?: string
  readonly input?: unknown
  readonly reachableFrom?: CommandReach
  readonly proposable?: boolean
}

/**
 * A command that said a route written for it is the only way in (SPEC.md §85).
 *
 * Generating a tool for every command is safe because the bus authorizes first and
 * authorization denies by default — every command except a publicly authorized one.
 * `auth.login` is that case: agent permissions never gate it, so as a tool it is a
 * password oracle for any agent token, and under `mutations: 'direct'` it answers
 * with a live user session. The declaration is what keeps it off this list, rather
 * than a list of names this package would have to maintain.
 */
const routeOnly = (entry: Described): boolean => entry.reachableFrom === 'its own route'

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
    bus: entry.name,
    description: entry.description ?? entry.name,
    inputSchema: objectSchema(entry.input),
    mutates,
    // Absent means yes, the way the descriptor carries it: the field is written only
    // when it restricts something.
    proposable: mutates && entry.proposable !== false,
  })

  return [
    ...(sections.queries ?? []).map((entry) => describe(entry, false)),
    ...(sections.commands ?? [])
      .filter((entry) => !routeOnly(entry))
      .map((entry) => describe(entry, true)),
  ].sort((left, right) => left.name.localeCompare(right.name))
}
