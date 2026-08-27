# Commands and queries

Every state-changing operation in Assemora is a command, and there is exactly one path
a command takes:

```text
Command Bus → validation → authorization → transaction → handler → revision → events → audit → database
```

No caller may shortcut it — not Studio, not REST, not the SDK, not the CLI, not MCP.
That single sentence is what makes the rest of the system possible: policies cannot be
forgotten because nobody chooses to call them, history is not something a feature
remembers to write, and an agent's action passes exactly the checks a person's click
passes.

A command that schedules durable work adds one step to that line, between the revision
and the events: the queue is handed the batch once the transaction has closed, so a
command that rolls back queues nothing. [Jobs](13-jobs.md) is the page about it.

Reads never go through the Command Bus and never cause side effects. They go through
the **Query Bus**, which still validates and still authorizes.

## Writing a command

```ts
import { command } from '@assemora/core'
import { uuid } from '@assemora/schema'

export const PublishPost = command('posts.publish', {
  description: 'Publish post',
  input: { id: uuid() },
  handle: async ({ id }, context) => {
    const post = await Post.findOrFail(id)
    const before = post.toJSON()

    await context.authorize('posts', 'publish', before)

    await post.update({ published: true, publishedAt: new Date() })

    context.revise({ entityType: 'posts', entityId: id, before, after: post.toJSON() })
    context.emit('post.published', { postId: id })

    return { id }
  },
})
```

`input` is a shape of schema fields; the handler's argument is inferred from it, and
the bus has already validated and stripped anything outside it before the handler runs
— which is how mass assignment is prevented.

The context carries what the pipeline needs from a handler:

| | |
| --- | --- |
| `context.revise(draft)` | records a reversible change, inside the transaction |
| `context.emit(name, payload)` | queues a side effect; listeners run after the commit |
| `context.dispatch(...jobs)` | schedules durable work; the queue is handed it after the commit |
| `context.authorize(subject, action, record)` | the second authorization question |
| `context.execute(name, input)` | runs another command, on a savepoint inside this one |
| `context.preview(proposals)` | previews a sequence without performing any of it |
| `context.actor`, `context.source`, `context.requestId`, `context.logger` | who, from where |

Two options are worth knowing. `subject` states what a command acts on when its name
does not say it — `blocks.update` edits a page, so it declares `pages` and authorizes
`pages.update` rather than demanding a second permission for one act. `previewable:
false` says a handler reaches outside the database, so a dry run would half-perform it
and then report that nothing happened; the bus refuses to preview it instead.

Register it on a module: `module('blog').commands(PublishPost)`.

## A command name is a permission name

`posts.publish` is the command and `posts.publish` is the permission it requires
(ADR-0015). There is no mapping table, so there is nothing to fall out of step. A
permission is held by any wildcard above it: `posts.*` grants `posts.publish`, and `*`
grants everything.

## Authorization asks twice

A rule about a *record* cannot be answered before the record has been read, so
authorization happens at two moments and both are inside the pipeline:

1. **Before the handler** — does this actor hold `posts.publish` at all? Someone whose
   role grants it never reaches step 2.
2. **Once the row is loaded** — `context.authorize('posts', 'publish', record)` asks
   the policy about that particular record.

```ts
export const ArticlePolicy = policy('articles', {
  read: ({ actor }) => actor !== undefined,
  create: ({ actor }) => actor?.type === 'user',
  update: ({ actor, record }) => writesAs(actor, record.authorId),
  delete: ({ can }) => can('articles.delete'),
})
```

A rule may be asynchronous, which is what lets it answer a question the actor alone
cannot — "is this account the author profile named on this article?". It costs a query
on exactly the requests that need one.

Policies belong to the module that owns the subject:
`module('blog').policies(ArticlePolicy)`. `auth({ policies: [...] })` is the other
place, and is for a policy over somebody else's subject.

**Authorization denies by default.** An application with no policy provider refuses
every command rather than running unauthorized. `permitAll()` is the explicit,
deliberately blunt opt-out, and it is written in your own source where it can be seen.

## Queries

This is `@assemora/revisions`'s own query, and the comment in it is the point:

```ts
export const ListRevisions = query('revisions.list', {
  description: 'The history of one entity, newest first',
  input: {
    entityType: string(),
    entityId: string(),
    page: number().integer().optional(),
    perPage: number().integer().optional(),
  },
  handle: async ({ entityType, entityId, page, perPage }, context) => {
    // The input names what is read, so reading it is a second question: holding
    // `revisions.read` must not open the history of every entity in the application.
    await context.authorize(entityType, 'read', null)

    // …
  },
})
```

A query is declared with `query()` from `@assemora/core` and registered with
`module('blog').queries(…)`, exactly as a command is.

That `authorize` call is not decoration. A query whose *input* names what it reads has
to ask twice exactly as a command does — without it, one `revisions.read` permission
would open the history of every entity in the application. `list` and `get` both mean
`read` when a permission is resolved, for every subject.

## Running one

```ts
await app.run({ source: 'internal', actor: { type: 'user', id: admin.id } }, async () => {
  await app.commands.execute('entries.create', { resource: 'articles', data: { … } })
})
```

`run` establishes the context — `requestId`, `actor`, `source` — and it travels through
`AsyncLocalStorage` from there. Nothing threads it through function signatures. A
command run by nobody is refused rather than trusted, which is why a seed says who it
is.

Over HTTP you rarely write that: `server.mountCommands()` publishes every registered
command as `POST /api/commands/<name>` and `server.mountQueries()` publishes every
query as `GET /api/queries/<name>`. Mounting everything is safe **because** the bus
validates and authorizes first and authorization denies by default — not because the
list is curated.

## Where to look next

- [Authentication](08-authentication.md) — roles, permissions, tokens and agents,
  which is what the checks above consult.
- [Agents and MCP](10-agents-and-mcp.md) — dry run and change sets, which are this
  same pipeline with the transaction rolled back.
- [Jobs](13-jobs.md) — the durable work a command schedules, and why it waits for the
  commit.
- `packages/core/README.md` — the ports core owns and the layers above implement.
