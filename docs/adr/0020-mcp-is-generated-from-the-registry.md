# 0020. MCP tools are generated, and `@assemora/mcp` depends on almost nothing

Status: accepted
Date: 2026-08-26

## Context

SPEC.md §69 and §70 list about eighteen MCP tools by name. SPEC.md §68 says the
server must use the Schema Registry and the Command Bus and must not carry business
logic of its own. SPEC.md §71 makes `assemora.describe` the key AI endpoint: an
agent must understand a project without reading its code.

## Decision

**Every registered command and query becomes a tool.** The names §69 and §70 list
turn out to be what generation produces: `entries.list`, `entries.create`,
`pages.publish`, `blocks.add`, `revisions.restore` and the rest are already
registered under exactly those names, because a command name is a permission name
and has been since ADR-0015.

A hand-written list was rejected. It drifts the moment somebody adds a resource, a
block type or a command — and the registry exists precisely so that subsystems stop
keeping their own copies (ADR-0002). A curated list would be the one place that had
to be maintained twice, and it would silently omit whatever an application added.

**`@assemora/mcp` depends on `schema` and `core`, and nothing else.** The edges to
`resources` and `pages` are removed. A tool call is `queries.execute(name, input)`
or `commands.dryRun(name, input)`; the package needs the buses and the registry, and
neither lives above core. The consequence is that the four introspection queries
read registry entries as data rather than as typed descriptors, which is correct for
a passthrough and would be wrong if MCP ever started interpreting them.

**The registry's JSON Schema goes to the SDK unchanged.** The low-level `Server`
class takes JSON Schema directly on `tools/list`. The high-level `McpServer` accepts
Zod only — `registerTool` throws at runtime on a plain JSON Schema object, not
merely at compile time — so using it would mean converting every registry schema to
Zod, or writing Zod by hand per tool. Either route puts a second schema system
between one declaration and one of its consumers, which is the thing this project
exists to avoid.

`@assemora/schema` narrows `object(...).toJsonSchema()` to `ObjectJsonSchema` so
this happens without a cast.

**An agent writing a field it may not write refuses the whole command**, naming
every offending field at once. Silently dropping the forbidden keys was rejected and
is the dangerous option: the agent believes it wrote a field it did not, and the
revision — and therefore the change-set diff a human approves under §75 — would
describe something other than what was asked for. Approval has to be over what
actually happens.

The check triggers on `actor.type === 'agent'`, not on `source === 'mcp'`. An agent
is an agent whichever door it came through.

## Consequences

`@modelcontextprotocol/sdk` brings express, hono, cors, ajv, jose, `zod` and
`express-rate-limit` into the dependency tree — two HTTP frameworks, in a project
whose rule is that Fastify has one owning package. That was accepted in phase 0,
when the SDK was recorded in `implementationLibraries` as owned by `mcp`, and it is
the price of speaking the protocol from its own implementation rather than ours. It
stays confined: `pnpm boundaries` fails if the SDK appears in any other package, and
one facade file is the only thing in the repository that imports it.

Zod arrives as a hard dependency of the SDK and a peer. Nothing in Assemora uses it,
and nothing should: a schema declared in Zod is a schema the Schema Registry cannot
see.

The per-agent rate limit §76 requires is in process. Two instances behind a load
balancer give an agent twice its allowance. §76 does not say where the limit lives,
and a shared store is out of scope until deployment.

`@assemora/mcp` cannot mount an HTTP route — it may not depend on `@assemora/http` —
so the application does, the same contract `/auth/login` and the media URLs already
follow (ADR-0017).
