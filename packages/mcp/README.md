# @assemora/mcp

The same application, spoken to by a machine (SPEC.md §68 to §76).

```ts
const server = createMcpServer({
  registry: app.registry,
  commands: app.commands,
  queries: app.queries,
})
```

There is no business logic here, and there is no way for there to be: this package
depends on `@assemora/schema` and `@assemora/core` and nothing else, so it cannot
reach a database even by accident. `pnpm boundaries` keeps it that way.

## The tools are the registry

Every registered command and query becomes a tool, named `assemora.` plus its bus
name. The list SPEC.md §69 and §70 give is what generation produces —
`entries.create`, `pages.publish`, `blocks.add`, `revisions.restore` are already
registered under exactly those names, because a command name is a permission name.

So a `resource()` or a `block()` added to an application is a tool, with its
validation and its permissions, without anybody editing a list. A curated list would
be the one place that had to be maintained twice (ADR-0020).

The registry already holds JSON Schema for every input, and the protocol takes JSON
Schema, so it is handed over unchanged. No Zod, no conversion, no second schema
between one declaration and one of its consumers.

## A mutation tool proposes; it does not mutate

Calling `assemora.entries.update` previews the command and stores a change set. The
agent gets the diff back. Production state changes when a person runs
`changesets.apply` — SPEC.md §75 says so flatly, and a flag the caller sets would not
be a gate.

`createMcpServer({ mutations: 'direct' })` runs commands instead, for an application
that has decided an agent may act alone.

## The seven checks of §76

None of them are implemented here, and that is the design. A tool call is
`queries.execute`, `commands.dryRun` or `commands.execute`, so it passes what every
caller passes:

| Check | Where it happens |
| --- | --- |
| Token authentication | The application resolves the actor before the call arrives |
| Agent permissions | The Command and Query Buses, through the authorization port |
| Policy checks | The same, and again with the record in hand |
| Field permissions | `@assemora/resources`, inside the entry commands |
| Validation | The bus, as the first stage of the pipeline |
| Rate limits | Here — `rateLimit()`, per actor, in process |
| Audit | The bus, including for a preview and for a refusal |

The rate limit is the one exception, and it is a per-process counter: two instances
behind a load balancer give an agent twice its allowance. §76 does not say where the
limit lives, and a shared store belongs with deployment.

## What it costs

`@modelcontextprotocol/sdk` brings express, hono, cors, ajv, jose, zod and
`express-rate-limit` with it — two HTTP frameworks, in a project whose rule is that
Fastify has one owning package. That was accepted in phase 0 when the SDK was
recorded as owned by this package, and `src/server.ts` is the only file in the
repository that imports it.
