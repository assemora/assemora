# Agents and MCP

```bash
pnpm assemora agents:create "Content agent" \
  --permissions pages.read,pages.update,changesets.propose,assemora.* \
  --actor <your user id> --write-mcp-json
```

That creates the identity an agent connects as and writes the client configuration.
The rest of this page is what the agent finds on the other side.

## The endpoint

An agent reaches Assemora over the Model Context Protocol, and `assemora()` mounts it.

```ts
// src/app.ts
export const app = assemora({
  database: postgres({ url: process.env.DATABASE_URL ?? '' }),
  modules: [auth(), pages({ blocks }), content()],
  project: { name: 'my-site', version: '1.0.0' },
  mcp: true,
})
```

`mcp: true` expands to the defaults.

```ts
mcp: {
  path: '/mcp',                    // under the API prefix: POST /api/mcp
  mutations: 'change-set',         // an agent proposes, a person applies
  rateLimit: { max: 120, windowMs: 60_000 },
}
```

It needs `auth()` in `modules`, because the bearer token is resolved by the auth
module. It needs `changeSets: true` (the default) unless `mutations` is `'direct'`.
Both are refused at build time, naming the option to set.

Under the umbrella is one function. A project that does not use `assemora()` calls it
directly.

```ts
import { connectDirectly, createMcpServer, rateLimit } from '@assemora/mcp'

const server = createMcpServer({
  registry: app.registry,
  commands: app.commands,
  queries: app.queries,
  mutations: 'change-set',
  rateLimit: rateLimit({ max: 120, windowMs: 60_000 }),
})

const endpoint = await connectDirectly(server)
const reply = await endpoint.handle(jsonRpcMessage)
```

`@assemora/mcp` depends on `@assemora/schema` and `@assemora/core` and nothing else.
It cannot reach a database, and `pnpm boundaries` keeps it that way. There is no
business logic in it: every tool call is `queries.execute`, `commands.dryRun` or
`commands.execute`.

## Transports

There are two ways in, and both serve the same generated tools.

`assemora mcp` speaks over stdin and stdout, which is what Claude Code, Claude Desktop
and Cursor start. `--write-mcp-json` writes the file such a client reads.

```json
{
  "mcpServers": {
    "content-agent": {
      "command": "pnpm",
      "args": ["assemora", "mcp"],
      "cwd": "/path/to/my-project"
    }
  }
}
```

The token is not in it. It goes to `.env`, which the project reads as it is imported.

```dotenv
ASSEMORA_AGENT_TOKEN=<shown once by agents:create>
```

`assemora mcp` refuses to start without it. The framing is newline-delimited JSON, one
message per line. A malformed line is answered with a JSON-RPC error, not a closed
pipe.

`POST /api/mcp` is the HTTP way in, with the token as a bearer.

```http
POST /api/mcp
Authorization: Bearer <token>
Content-Type: application/json

{"jsonrpc":"2.0","id":1,"method":"initialize","params":{
  "protocolVersion":"2025-06-18","capabilities":{},
  "clientInfo":{"name":"probe","version":"1"}}}
```

`GET` and `DELETE` on the same path answer 405, not 404. This server pushes nothing.
The SDK's own client treats 405 as "no stream, carry on" and anything else as a
failure.

## The identity

An MCP session is an actor. An anonymous one reaches every tool with no permissions at
all, which is the most confusing way to be refused. So `assemora mcp` insists on a
token.

```bash
pnpm assemora agents:create <name> --permissions <a,b> \
  [--description <text>] [--actor <id>] [--write-mcp-json [path]]
```

The token is printed once. The row keeps a SHA-256 digest of it and nothing else, so
nothing can print it again. `--actor` names a user who holds `auth.agents.create`.
Without it the command is refused, because creating an agent is authorized like every
other command.

Underneath is one command on the bus. Studio's Agents tab under Users calls the same
one.

```ts
await app.commands.execute('auth.agents.create', {
  name: 'Content agent',
  description: 'Rewrites hero copy',
  permissions: ['pages.read', 'pages.update', 'changesets.propose', 'assemora.*'],
})
// { agentId, token, tokenId }
```

An actor cannot grant an agent a permission it does not hold itself (SPEC.md §72). An
agent is not a way around anybody's own limits.

`assemora.*` covers the introspection queries. `pages.update` is what `blocks.update`
authorizes, because a page is the record it changes.

`assemora agents` lists the identities this application knows.

```bash
pnpm assemora agents [--actor <id>] [--page <n>] [--per-page <n>] [--json]
```

## The tools

Every registered command and query is a tool, named `assemora.` plus its bus name.

```text
tools/list →
  assemora.describe               read
  assemora.resources.list         read
  assemora.resources.describe     read
  assemora.blocks.types           read
  assemora.pages.get              read
  assemora.entries.create         mutates
  assemora.pages.publish          mutates
  assemora.blocks.update          mutates
  assemora.revisions.restore      mutates
  assemora.changesets.propose     mutates
  …
```

`entries.create`, `pages.publish`, `blocks.add` and `revisions.restore` are already
registered under those names, because a command name is a permission name. So a
`resource()` or a `block()` you add is a tool, with its validation and its
permissions. Nobody edits a list. A curated list was rejected: it would be the one
place maintained twice (ADR-0020).

The registry already holds JSON Schema for every command's input, and the protocol
takes JSON Schema. It is handed over unchanged.

```json
{
  "name": "assemora.blocks.update",
  "description": "Changes the props of a block",
  "inputSchema": {
    "type": "object",
    "properties": {
      "id": { "type": "string", "format": "uuid" },
      "expectedVersion": { "type": "integer" },
      "blockId": { "type": "string", "format": "uuid" },
      "props": {}
    },
    "required": ["id", "blockId", "props"]
  },
  "annotations": { "readOnlyHint": false }
}
```

Internally a tool carries both names.

```ts
type ToolDescriptor = {
  name: string        // what the agent calls: 'assemora.pages.get'
  bus: string         // what the bus knows:   'pages.get'
  description: string
  inputSchema: { type: 'object' } & JsonSchema
  mutates: boolean
  proposable: boolean
}
```

`bus` is carried rather than derived. Stripping the prefix is not invertible: the four
introspection queries are registered as `assemora.describe`, `assemora.resources.list`,
`assemora.resources.describe` and `assemora.blocks.types` already.

One command is not a tool. `auth.login` declares `reachableFrom: 'its own route'`,
because as a tool it would be a password oracle for any agent token.

## The transcript

A tool call is one JSON-RPC message, and the answer is text holding JSON.

```json
{ "jsonrpc": "2.0", "id": 3, "method": "tools/call",
  "params": { "name": "assemora.pages.get", "arguments": { "slug": "home", "mode": "draft" } } }
```

```json
{ "jsonrpc": "2.0", "id": 3,
  "result": { "content": [{ "type": "text", "text": "{ \"id\": \"…\", \"slug\": \"home\", \"version\": 2, \"tree\": { \"blocks\": [ … ] } }" }] } }
```

A failure is the same shape with `isError`. The text is an error an agent can act on.

```json
{ "result": { "isError": true, "content": [{ "type": "text", "text":
  "{ \"error\": { \"code\": \"FORBIDDEN\", \"message\": \"No permission and no policy allow publish on pages\" } }" }] } }
```

The codes are the application's own: `FORBIDDEN`, `VALIDATION_ERROR` with `fields`,
`CHANGE_SET_CLOSED`, `RATE_LIMITED`, `UNKNOWN_TOOL`. `String(error)` on a refusal used to
say `[object Object]`, and a test keeps it a sentence.

## `assemora.describe`

`assemora.describe` is the entry point. An agent understands a project without reading
its codebase, and nobody writes a prompt that lists the collections.

```ts
{
  project: { name: 'my-site', description: null },
  capabilities: ['content', 'pages', 'blocks', 'media', 'revisions', 'change-sets', 'audit', 'users'],
  models: [{ name: 'articles', table: { … } }, …],
  resources: [{ name: 'articles', label: 'Articles', kind: 'static', fields: [ … ] }, …],
  pages: [{ name: 'assemora_pages', … }],
  blocks: [{ name: 'hero', fields: [ … ] }, …],
  commands: [{ name: 'pages.publish', description: '…', input: { … } }, …],
  queries: [{ name: 'pages.get', … }, …],
  permissions: ['assemora.describe', 'blocks.add', 'entries.create', 'pages.publish', …],
  locales: [{ name: 'uk', default: true }, { name: 'en', default: false }],
  policies: [{ name: 'articles', actions: ['update', 'delete'], module: 'blog' }, …],
}
```

`capabilities` is derived from what is registered: `pages` appears when a `pages.*`
command exists. `permissions` is every command and query name, because a command name
is a permission name. `policies` says which subjects are decided per record, so a
refusal a permission did not predict is not a fault.

The other three introspection tools narrow it.

```text
assemora.resources.list      → [{ name: 'articles', label: 'Articles', kind: 'static' }]
assemora.resources.describe  { name: 'articles' } → one resource in full
assemora.blocks.types        → [{ name: 'hero', … }]
```

All four are queries on the Query Bus. Asking what exists is an action, so it is
authorized and audited like any other read.

## Proposals

A mutation tool proposes; it does not mutate.

```text
assemora.blocks.update { id, blockId, props: { title: 'Welcome home' } }
→ {
    id: '…',
    status: 'pending',
    changes: [{ entityType: 'pages', entityId: '…', summary: 'hero — title changed', patch: { … } }],
    expiresAt: '2026-09-05T10:00:00.000Z',
  }
```

Production has not moved. Production state changes when a person runs
`changesets.apply` (SPEC.md §75). A flag the caller sets would not be a gate.

The server wraps the call.

```ts
// what @assemora/mcp does for every mutating, proposable tool
await commands.execute('changesets.propose', {
  title: tool.description,                   // the command's own sentence
  commands: [{ command: 'blocks.update', input }],
})
```

The title is what the command says it does. That is what an editor reads on the
Proposals screen.

An agent with more to say composes its own. `assemora.changesets.propose` takes a title
and a list of commands.

```ts
assemora.changesets.propose {
  title: 'Say plainly what an agent does, in the home page hero',
  commands: [
    { command: 'blocks.add', input: { id, type: 'hero', props: { title: 'Welcome' } } },
    { command: 'blocks.update', input: { id, blockId, props: { subtitle: 'An agent wrote this' } } },
  ],
  ttlMs: 86_400_000,                          // optional; 24 hours by default
}
```

Several commands in one proposal are previewed together and applied together. "Add a
block, then set its title" is one decision for a person (SPEC.md §74).

Two commands are exempt from wrapping, and they declare it themselves.

```ts
command('changesets.propose', { proposable: false, … })   // would wrap itself
command('changesets.reject',  { proposable: false, … })   // refusing is not a change to approve
```

`changesets.apply` is not exempt, so an agent still cannot apply anything.

The opt-out is one option. It belongs in the project's own source, where it can be
seen.

```ts
assemora({ mcp: { mutations: 'direct' } })
// or
createMcpServer({ …, mutations: 'direct' })
```

## Dry run

A dry run is the command pipeline with the transaction rolled back.

```ts
const preview = await app.commands.dryRun('pages.publish', { id })
// {
//   command: 'pages.publish',
//   result: { … },                 // what the handler answered
//   changes: [{ entityType: 'pages', entityId: id, before, after, patch }],
//   events: ['page.published'],    // none of them were emitted
//   jobs: [],                      // none of them were queued
// }

const previews = await app.commands.dryRunAll([
  { command: 'blocks.add', input: { … } },
  { command: 'blocks.update', input: { … } },
])
```

There is no second code path, so a preview cannot disagree with the write it predicts.
A preview an actor may not perform is refused exactly as the command would be. A dry
run is not a way to find out what a forbidden command would do.

`dryRunAll` runs the commands in one transaction, so the second sees what the first
did, and the whole thing is undone once. Inside a command, `context.preview(commands)`
is the same thing.

A handler that reaches outside the database says so, and `dryRun` refuses it.

```ts
command('media.upload', {
  previewable: false,   // it writes a file; a rollback would not take that back
  …
})
// dryRun → NOT_PREVIEWABLE: "media.upload" does something a transaction cannot undo
```

A route-only command is refused the same way, with `UNREACHABLE_COMMAND`. Previewing
`auth.login` would answer differently for a right and a wrong password.

## Change sets

A change set is a list of commands, the diff they would produce, and the versions the
diff was computed against. Nothing in it has happened.

```ts
const proposal = await commands.execute('changesets.propose', {
  title: 'Make the hero more compact',
  commands: [
    { command: 'blocks.design', input: { id, blockId, design: { spacingTop: 'md' } } },
    { command: 'blocks.remove', input: { id, blockId: heroImage } },
  ],
})

proposal.changes.map((change) => change.summary)
// ['hero — restyled', 'image — removed']
```

A summary is one readable line per change. A page whose tree moved becomes one line per
block. Everything else names its fields, as `articles — title: Old → New`.

Applying is a person's act.

```ts
await commands.execute('changesets.apply', { id: proposal.id })
// { id, status: 'applied', applied: true, results: [ … ] }
```

Apply re-executes the stored commands through the Command Bus in the applier's own
context. That means the approving person's permissions and policies, not the
proposer's. It does not write the stored diff. A diff describes what would happen, and
writing it would be a second way to mutate.

Before it runs anything, apply previews the proposal again and compares the version
each entity was at when the diff was computed. If one has moved, the person approved a
description of a state that no longer exists.

```ts
await commands.execute('changesets.apply', { id: proposal.id })
// { id, status: 'conflicted', applied: false, changed: ['pages:…'], results: [] }
```

Declining is an outcome, not an exception. The status is written inside the command's
transaction, and throwing would roll back the row that records the refusal. Expiry is
the same kind of outcome.

```ts
// { id, status: 'expired', applied: false, results: [] }
```

A caller mistake still throws.

```ts
await commands.execute('changesets.apply', { id: proposal.id })   // a second time
// CHANGE_SET_CLOSED (409): This change set was already applied
await commands.execute('changesets.apply', { id: unknown })
// CHANGE_SET_NOT_FOUND (404): change set … was not found
```

The five statuses.

```ts
type ChangeSetStatus = 'pending' | 'applied' | 'rejected' | 'expired' | 'conflicted'
```

Rejecting closes one without running any of it.

```ts
await commands.execute('changesets.reject', { id: proposal.id, reason: 'Wrong page' })
// { id, status: 'rejected', reason: 'Wrong page' }
```

The reads are `changesets.list` and `changesets.get`.

```ts
await queries.execute('changesets.list', { status: 'pending', page: 1, perPage: 20 })
// { data: [{ id, title, status, actorType, actorId, changes: 2, expiresAt, createdAt, appliedAt }], total, page, perPage, lastPage }

await queries.execute('changesets.get', { id })
// { id, title, status, actorType, actorId, commands: [ … ], changes: [ … ], expiresAt, createdAt, appliedAt }
```

Conflict detection is only as good as versioning. `baseVersions` records a version per
touched entity. Only entities that carry one are recorded.

```ts
baseVersions: { 'pages:6f1c…': 3, 'users:a02d…': 1 }
// pages and users carry a version; resource rows do not
```

So conflict detection is complete for pages and absent for entries, until versioning
is general.

## Field permissions

A resource field says what an agent may do with it, and the check runs inside the
entry commands.

```ts
export const Articles = resource(Article, {
  title: text().required(),
  featured: toggle().agentAccess({ write: false }),
  notes: text().agentAccess({ read: false }),
})
```

An agent writing `featured` is refused. The refusal names every offending field.

```text
assemora.entries.update { resource: 'articles', id, data: { featured: true, title: 'New' } }
→ { error: { code: 'FORBIDDEN',
             message: 'An agent may not write "featured" on "articles"' } }
```

Refused rather than dropped. Silently writing the rest would let the agent believe it
set a field it did not. The diff a person approves would then describe something other
than what happens.

A read projects to what the agent may see, so `notes` is absent from
`assemora.entries.get`. Revisions still record the whole row, because history is not a
reader. Only an agent is narrowed; a person editing the same field in Studio is
governed by permissions and policies.

## The seven checks

None of them are implemented in `@assemora/mcp`, and that is the design.

| Check | Where it happens |
| --- | --- |
| Token authentication | The application resolves the actor before the call arrives |
| Agent permissions | The Command and Query Buses, through the authorization port |
| Policy checks | The same, and again with the record in hand |
| Field permissions | `@assemora/resources`, inside the entry commands |
| Validation | The bus, as the first stage of the pipeline |
| Rate limits | `@assemora/mcp`, `rateLimit()`, per actor, in process |
| Audit | The bus, including for a preview and for a refusal |

The rate limit is the one exception, and it is a per-process counter.

```ts
rateLimit({ max: 120, windowMs: 60_000 })   // the default: 120 calls a minute per actor
// on the 121st call → RATE_LIMITED: Too many calls. Try again in 42s
```

It is keyed by actor, not by tool. Two instances behind a load balancer give an agent
twice its allowance.

## The audit log

An audit entry says who asked, from where, which command, whether it succeeded and how
long it took.

```ts
createApplication({ modules: [auditModule(), blog()], audit: audit() })
// assemora() does this for you; `audit: false` switches it off
```

```ts
await queries.execute('audit.list', { source: 'mcp', perPage: 50 })
// {
//   data: [{
//     id, actorType: 'agent', actorId, source: 'mcp',
//     action: 'changesets.propose', kind: 'command',
//     entityType, entityId, requestId,
//     outcome: 'succeeded', durationMs: 18,
//     metadata: { revisions: 1, events: 1, jobs: 0 },
//     createdAt,
//   }, …],
//   total, page, perPage, lastPage,
// }
```

An entry exists for every attempt, including the ones authorization refused. Those are
the entries that matter most, and they leave no revision behind. `audit({ failures:
false })` is how to stop recording them. A preview is recorded as `outcome:
'previewed'`.

A revision is a different thing. It is what an entity looked like before a change, and
what undo and restore are built on. It exists only when something actually changed.

Writing an entry never fails a command. The log is written after the transaction has
committed, so a failure there cannot undo anything. It is caught and logged rather than
thrown.

```ts
try {
  await options.audit.record({ action, kind: 'command', source, requestId, actor, outcome, durationMs })
} catch (error) {
  options.logger.error('The audit log could not be written', { command, requestId, reason })
}
```

The Query Bus is audited too. Half the tools are reads, and `kind: 'query'` separates
them.

## The whole scenario

`tests/integration/agent-e2e.test.ts` walks it over the protocol, and it is the
shortest honest description of what an agent does here.

```text
assemora.describe          → { project: { name: 'assemora-test' }, commands: [ …, 'pages.publish' ] }
assemora.blocks.types      → [{ name: 'hero' }]
assemora.pages.get         { slug: 'home', mode: 'draft' }
                           → { id, version, tree: { blocks: [{ id, type: 'hero', props: { title: 'Welcome' } }] } }
assemora.blocks.update     { id, blockId, props: { title: 'Welcome home' } }
                           → { status: 'pending', changes: [{ summary: 'hero — title changed' }] }
pages.get                  → title is still 'Welcome'; production did not move
changesets.apply           { id }              a person, from Studio
                           → { status: 'applied' }
revisions.list             { entityType: 'pages', entityId }
                           → data[0].command === 'blocks.update'
pages.publish              { id }
revisions.restore          { id: revisionId, to: 'before' }
pages.get                  → title is 'Welcome' again
```

The trail it leaves names the agent for the proposal and the person for the write.

```text
audit.list →
  { action: 'changesets.propose', actorType: 'agent', source: 'mcp' }
  { action: 'blocks.update',      actorType: 'user',  source: 'studio' }
```

## Where to look next

- [Authentication](08-authentication.md): agent identities, tokens and field-level
  permissions.
- `packages/mcp/README.md` and `packages/change-sets/README.md`.
- ADR-0019 and ADR-0020 for the two decisions this page rests on.
