# `@assemora/core`

Application kernel: modules, container, context, Command Bus, Event Bus, errors.

**Implementation phase:** 1 — implemented.

Core owns the single mutation path of SPEC.md §14 and knows nothing about HTTP or a
database.

```ts
const PublishPage = command('pages.publish', {
  input: { id: uuid() },
  handle: async ({ id }, context) => {
    context.revise({ entityType: 'page', entityId: id, before, after })
    context.emit('page.published', { pageId: id })
    return { id }
  },
})

const app = createApplication({
  modules: [module('pages').commands(PublishPage)],
  authorization: permitAll(), // development only — the default denies everything
})

await app.run({ source: 'mcp', actor: { type: 'agent', id: 'writer' } }, () =>
  app.commands.execute(PublishPage, { id }),
)
```

Validation, authorization, transaction, handler, revisions, events and audit happen
in that order for every caller — Studio, REST, the SDK, the CLI and MCP alike.

## Jobs

A job is the third member of the family beside `command()` and `query()`: work that
must happen, must survive a restart, and must not happen inside the request
(SPEC.md §82).

```ts
const GenerateSitemap = job('sitemap.generate', {
  description: 'Rebuilds the sitemap after a page changes',
  input: { pageId: uuid() },
  retries: 3,
  handle: async ({ pageId }, context) => {
    await context.commands.execute(RebuildSitemap, { pageId })
  },
})

const app = createApplication({
  modules: [module('pages').commands(PublishPage).jobs(GenerateSitemap)],
  authorization: permitAll(),
  // Omitted, jobs run in this process, awaited. `@assemora/queue-bullmq` is the
  // production adapter.
  queue: bullmqQueue({ connection }),
})
```

`GenerateSitemap({ pageId })` validates the payload and runs nothing, so a wrong
payload is a `ValidationError` where it was written — including a payload no queue
could carry, such as one holding `undefined`.

`await dispatch(...)` holds the job until the **outermost** transaction commits.
That is `TransactionPort.afterCommit`, and it is a transaction concept rather than a
command one: a command's own transaction may be a savepoint inside one that is still
free to undo everything it wrote, and a job that ran against that would run against
a world that never existed. So a command that rolls back queues nothing, a command
inside a `transaction()` that rolls back queues nothing, a nested command whose
caller survives its failure queues nothing, and a dry run queues nothing at all.
Events are emitted at the same moment and by the same rule.

Outside a command the job is handed over immediately, unless a `transaction()` is
open — then it waits for that one.

A worker calls `runJob(queued)`, which restores the actor and the request id of the
operation that scheduled the work and runs the job with `source: 'job'`.

Where a stage needs a layer above core, core owns the interface and the other
package registers an implementation (ADR-0008). Authorization defaults to
`denyAll()`: an application with no policy provider refuses every command instead of
running unauthorized.

## Settings

What a module wants the settings screen to say about it (ADR-0031). A group is
declarative data — a section, a label, blocks of rows that are a `value` or a `link` —
registered under the module's name in the `settings` section of the Schema Registry,
where Studio draws it and `assemora.describe` answers with it.

```ts
module('search').settings({
  name: 'search',
  section: 'platform',
  label: { en: 'Search', uk: 'Пошук' },
  icon: 'gauge',
  blocks: [
    {
      title: 'Index',
      locked: true,
      rows: [{ key: 'search.engine', kind: 'value', label: 'Engine', value: 'Meilisearch' }],
    },
  ],
})
```

A group written out is checked by `settingsGroup()` where it is written; a group given
as a function is called at boot, for a module whose values are handed to it after it
was written. A word may be a string or a map keyed by language tag — Studio picks and
never translates. There is no `input` row: a setting somebody changes is a command.

## Workspace dependencies

- `@assemora/schema`

Dependency direction is fixed in `docs/architecture/package-graph.md` and enforced by
`pnpm boundaries`.
