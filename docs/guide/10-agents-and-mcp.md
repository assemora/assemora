# Agents and MCP

An agent reaches Assemora over the Model Context Protocol, at `POST /api/mcp`. What it
finds there is not a hand-written integration:

```ts
const server = createMcpServer({
  registry: app.registry,
  commands: app.commands,
  queries: app.queries,
})
```

`@assemora/mcp` depends on `@assemora/schema` and `@assemora/core` and nothing else, so
it **cannot reach a database even by accident** — `pnpm boundaries` keeps it that way.
There is no business logic here, and there is no way for there to be.

## The tools are the registry

Every registered command and query becomes a tool, named `assemora.` plus its bus name.
`entries.create`, `pages.publish`, `blocks.add`, `revisions.restore` are already
registered under exactly those names, because a command name is a permission name.

So a `resource()` or a `block()` you add is a tool, with its validation and its
permissions, without anybody editing a list. A curated list would be the one place that
had to be maintained twice (ADR-0020). The registry already holds JSON Schema for every
input and the protocol takes JSON Schema, so it is handed over unchanged: no conversion,
no second schema.

A tool carries the name the bus knows beside the name the agent calls, because
stripping the prefix is not invertible — the three introspection queries are registered
as `assemora.describe`, `assemora.resources.list` and `assemora.blocks.types` already.

## `assemora.describe` is the entry point

It answers with the project, its capabilities, models, resources, pages, blocks,
commands, permissions and locales. Its purpose is that an agent can understand the
structure of a project **without reading the codebase** — and, in particular, without
anybody writing a prompt that lists the collections.

## A mutation tool proposes; it does not mutate

Calling `assemora.blocks.update` previews the command and stores a change set. The agent
gets the diff back:

```text
assemora.blocks.update  →  { status: 'pending', changes: ['hero — title changed'] }
```

Production state changes when a **person** runs `changesets.apply`. SPEC.md §75 says so
flatly, and a flag the caller sets would not be a gate.
`createMcpServer({ mutations: 'direct' })` — or `mcp: { mutations: 'direct' }` in
`assemora()` — is the deliberate opt-out, and it belongs in the project's own source
where it can be seen.

That proposal is titled with what the command says it does — the sentence in its own
`description`, which is what an editor reads on the Proposals screen.

An agent with more to say composes its own. `assemora.changesets.propose` takes a title
and a list of commands, and is the one mutating tool that is not itself wrapped in a
proposal:

```text
assemora.changesets.propose {
  title: 'Say plainly what an agent does, in the home page hero',
  commands: [{ command: 'blocks.update', input: { … } }],
}
```

Several commands in one proposal are previewed together and applied together, which is
the scenario SPEC.md §74 describes: "add a block, then set its title" is one decision for
a person to make, not two. `changesets.reject` is exempt for the same reason — refusing
is not a change to approve — while `changesets.apply` is *not*, so an agent still cannot
apply anything.

## Dry run is the real pipeline, rolled back

A dry run is the command pipeline with the transaction undone. There is no second code
path, so a preview cannot disagree with the write it predicts, and **a preview an actor
may not perform is refused exactly as the command would be** — a dry run is not a way to
find out what a forbidden command would do.

A handler that reaches outside the database says `previewable: false`, because it would
half-run and then report that nothing changed.

## Change sets

```ts
const proposal = await commands.execute('changesets.propose', {
  title: 'Make the hero more compact',
  commands: [
    { command: 'blocks.design', input: { id, blockId, design: { spacingTop: 'md' } } },
    { command: 'blocks.remove', input: { id, blockId: heroImage } },
  ],
})
```

Nothing has happened. `proposal.changes` is one readable line per change —
`hero — spacing: xl → md`.

The commands are previewed as a **sequence, in one transaction**, so the second sees
what the first did. "Add a block, then set its title" is one proposal, and previewing
the steps separately would leave the second referring to a block that had been rolled
back.

Applying re-executes the stored commands through the Command Bus **in the applier's own
context** — under the approving person's permissions and policies, not the proposer's.
It does not write the stored diff: a diff describes what would happen, and writing it
would be a second way to mutate.

Before it runs anything, apply previews the proposal again and compares the version each
entity was at when the diff was computed. If one has moved, the person approved a
description of a state that no longer exists, and it **declines**:

```ts
await commands.execute('changesets.apply', { id: proposal.id })
// { status: 'conflicted', applied: false, changed: [...] }
```

Declining is an *outcome, not an exception*. It has to be: the status is written inside
the command's transaction, and throwing would roll back the very row that records the
refusal. A caller mistake — applying something already applied, or an id that does not
exist — still throws.

The five statuses are `pending`, `applied`, `rejected`, `expired`, `conflicted`.

**Conflict detection is only as good as versioning.** `baseVersions` records a version
for each touched entity, and only entities that carry one are recorded: pages and users
do, resource rows do not. So conflict detection is complete for pages and absent for
entries until versioning is general.

## The seven checks

None of them are implemented in `@assemora/mcp`, and that is the design. A tool call is
`queries.execute`, `commands.dryRun` or `commands.execute`, so it passes what every
caller passes:

| Check | Where it happens |
| --- | --- |
| Token authentication | The application resolves the actor before the call arrives |
| Agent permissions | The Command and Query Buses, through the authorization port |
| Policy checks | The same, and again with the record in hand |
| Field permissions | `@assemora/resources`, inside the entry commands |
| Validation | The bus, as the first stage of the pipeline |
| Rate limits | `@assemora/mcp` — `rateLimit()`, per actor, in process |
| Audit | The bus, including for a preview and for a refusal |

The rate limit is the one exception, and it is a per-process counter: two instances
behind a load balancer give an agent twice its allowance.

## The audit log

```ts
createApplication({ modules: [auditModule(), blog()], audit: audit() })
```

An **audit entry** says who asked, from where, which command, whether it succeeded and
how long it took. It exists for every attempt — including the ones authorization
refused, which are the entries that matter most and which leave no revision behind. A
**revision** is a different thing: what an entity looked like before a change, and what
undo and restore are built on. It exists only when something actually changed.

Writing an entry never fails a command. The log is written after the transaction has
committed, so a failure there cannot undo anything, and turning a successful publish
into an error because logging broke would be the wrong trade every time.

The Query Bus is audited too — half the tools are reads.

## The whole scenario

`tests/integration/agent-e2e.test.ts` walks it over the protocol, and it is the shortest
honest description of what an agent does here:

```text
assemora.describe          → what is this project
assemora.blocks.types      → which blocks may I use
assemora.pages.get         → read the homepage
assemora.blocks.update     → propose a change; production does not move
changesets.apply           → a person applies it
revisions.list             → the revision names the agent, not the applier
revisions.restore          → and the page is back
```

## Where to look next

- [Authentication](08-authentication.md) — agent identities, tokens and field-level
  permissions.
- `packages/mcp/README.md` and `packages/change-sets/README.md`.
- ADR-0019 and ADR-0020 for the two decisions this page rests on.
