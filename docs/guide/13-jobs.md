# Jobs

Some work has to happen, has to survive a restart, and must not happen inside the
request. That is a **job**, and it is the third member of a family you already know:

| | | |
| --- | --- | --- |
| **Command** | the mutation itself | must be atomic, must be authorized, must be recorded |
| **Event** | a side effect in this process | may be missed without anybody being worse off |
| **Job** | durable work somebody will do | must happen, even if this process dies now |

The line between the last two is the one worth getting right. SPEC.md §81 is explicit
that an event must never carry critical sequential logic: a failing listener must not
fail the command, so a listener is allowed to be forgotten. A job is the opposite
promise. Sending the welcome email, rebuilding the sitemap, re-encoding the video the
editor just uploaded — none of those may quietly not happen.

## Declaring one

```ts
import { job } from '@assemora/core'
import { string } from '@assemora/schema'

export const GenerateSitemap = job('sitemap.generate', {
  description: 'Rebuilds sitemap.xml from every published page and article',
  input: { reason: string().min(1) },
  retries: 3,
  handle: async ({ reason }, context) => {
    const pages = await Page.where('status', 'published').get()

    await writeFile(SITEMAP_FILE, render(pages), 'utf8')

    context.logger.info('Sitemap rebuilt', { urls: pages.length, reason })
  },
})
```

Exactly the shape `command()` and `query()` use, and it registers the same way:
`module('blog').jobs(GenerateSitemap)`. `input` is a shape of schema fields, the
handler's payload is inferred from it, and the job appears in the Schema Registry — so
`/api/_introspection` can say what this application is able to schedule.

**Calling the definition validates the payload and runs nothing.**

```ts
GenerateSitemap({ reason: 'a page was published' })   // → a JobRequest
```

That is the whole reason it is callable. A wrong payload is a `ValidationError` at the
line that wrote it, rather than a red row in a dashboard tomorrow morning.

## Dispatching

```ts
import { dispatch } from '@assemora/core'

await dispatch(GenerateSitemap({ reason: 'a page was published' }))
```

Inside a command handler, that line does **not** hand the job over. It joins a batch
the command is holding, and the batch goes to the queue in step 6 of the pipeline —
after the transaction has closed:

```text
… → transaction → handler → revision → jobs → events → audit
```

This is the whole design, and it is the thing every queue integration gets wrong at
least once. Without it:

```ts
export const PublishArticle = command('articles.publish', {
  input: { id: uuid() },
  handle: async ({ id }, context) => {
    const article = await Article.findOrFail(id)

    await article.update({ status: 'published' })
    await dispatch(GenerateSitemap({ reason: `articles.publish ${article.slug}` }))

    // Something below here throws. The transaction rolls back.
  },
})
```

…the job is already in Redis, the article is not published, and a worker on another
machine rebuilds a sitemap around a row that does not exist. Because the batch is
flushed after the commit, a command that rolls back queues nothing at all.

Two consequences fall out of the same rule:

- **A dry run dispatches nothing.** A preview is the pipeline with the transaction
  rolled back (ADR-0019), and a job cannot be un-run any more than a listener can be
  un-notified. The `Preview` says which jobs *would* have been dispatched, beside the
  events it already reported.
- **A nested command's jobs travel with its caller's.** `context.execute` opens a
  savepoint inside the outer transaction, so a nested command has not really committed
  until the outer one has.

`context.dispatch(...)` does the same thing without the `await`, beside
`context.emit(...)`. Use whichever reads better; they write to the same batch.

**Outside a command, `dispatch()` hands the job over immediately.** There is no
transaction to wait for, and deferring it would silently defer work nothing will ever
flush. An event listener is the ordinary case:

```ts
module('blog')
  .jobs(GenerateSitemap)
  // `pages.publish` belongs to @assemora/pages, so this module cannot dispatch from
  // inside it. A listener runs after that command committed, which is exactly when a
  // job may be handed over.
  .on('page.published', ({ slug }) => dispatch(GenerateSitemap({ reason: slug })))
```

## What the worker gets

A job carries the context that scheduled it, because the writes it makes are still
that person's writes:

```json
{
  "name": "sitemap.generate",
  "payload": { "reason": "articles.publish draft-a-language-for-the-engine" },
  "retries": 3,
  "requestId": "a08ceaa9-b399-4c6d-a19e-c08363a1b4e4",
  "actor": { "type": "user", "id": "bd05905f-…" },
  "dispatchedFrom": "rest"
}
```

The worker restores the **actor**, so the commands the job runs pass the same policies
the click passed and the audit log names the right person. It restores the **request
id**, so the click, the command, the job and the commands the job runs share one id in
the logs. It does *not* restore the source: a row written by a worker was not written
by the studio click that scheduled it, so the job runs as `source: 'job'` and where the
work came from survives as `dispatchedFrom`.

A job has no `revise` and no `authorize` of its own, and that is not an oversight. A
job is not a mutation; the commands it runs are, and they already carry both. **A job
that changes anything does it by executing a command** — there is no second way in.

Restoring the actor is not the same as trusting it. The queue is the first place in
Assemora where an identity is stored durably and replayed later, and the gap between
the two is however long the job sat there — for a job in the failed set, indefinitely.
So `permissionsOf` asks whether this is still an actor every time it resolves one: a
user who has been deactivated (`auth.users.update` with `active: false`) holds nothing
from that moment, and a job carrying them fails with a `ForbiddenError` rather than
writing as somebody who is no longer allowed in. The same is true of an API token that
has expired since it was used, and of an agent that has been disabled.

## The default, and what it costs

With no queue configured, jobs run **in this process, awaited**. They are not
discarded. Every other port in core discards when nothing is registered, because a
missing revision is an absence — but a missing job is a lie, and a job that vanishes in
development and works in production is the worst of the available defaults.

The cost is stated rather than hidden, and `assemora()` says it out loud on boot when an
application declares a job and configures no queue:

- A slow job slows the request that scheduled it.
- A restart loses whatever was in flight.
- `retries` is ignored: it is a declaration addressed to a queue, and this is not one.

For development, and for a small deployment whose jobs are quick, that is a fine answer.
When it stops being one, you register an adapter and nothing in your job changes — but
the delivery guarantee does. In this process a job runs at most once and a restart
loses it; behind a real queue it runs at least once and a crash repeats it. A handler
that is idempotent is correct under both, which is the other reason to write one.

## Running a worker

```ts
import { bullQueue } from '@assemora/queue-bullmq'

const queue = bullQueue({ connection: { url: process.env.REDIS_URL ?? '' } })

export default assemora({
  …,
  jobs: { queue, worker: () => queue.work({ concurrency: 4 }) },
})
```

`worker` is a *function* on purpose. `assemora routes` boots this very application to
describe it, and a worker built when the file was imported would attach a consumer to
the production queue to answer a question about routes.

Which shape a process is belongs to its entry point, not to the application:

```ts
// src/worker.ts — a worker process, in full
import { createApp } from './app.ts'

await createApp().work()
```

`work()` boots and then starts pulling; `listen()` boots and then serves. A process
that does both calls both. `shutdown()` stops the worker after the server, then closes
the queue, and only then the modules and the database — a worker stops by refusing new
jobs and waiting for the ones already running, and those jobs execute commands.

There is no `assemora worker` command. SPEC.md §77 fixes twenty-two CLI commands and
none of them is a worker; the application starts its own.

Underneath, an adapter's worker does one thing with a payload:

```ts
import { runJob } from '@assemora/core'

await runJob(queued)   // finds the job, re-validates, restores the context, runs it
```

The payload is validated a second time there. It was checked when it was dispatched,
but between then and now it crossed a serializer and sat somewhere anything holding the
connection string can write to.

## A job runs *at least* once

This is the sentence to keep, because it is the one that decides how a handler is
written:

> **A queue delivers at least once. Write every job so that running it twice is the
> same as running it once.**

`retries` does not change that. `retries: 0` means *do not try again after a failure*
— it is not a delivery count, and no setting anywhere is one.

The duplicate does not come from a failure at all; it comes from a worker that stopped
answering. A worker holds a lock on the job it is running and renews it as it works. A
worker that is *killed* rather than stopped — `SIGKILL`, an OOM kill, a machine that
went away — renews nothing, and the job it was holding is invisible to every other
worker until that lock expires. Recovery is a periodic scan on the same interval, so
the wait is between one and two lock durations:

> **A hard-killed worker leaves its job unavailable for 30 to 60 seconds. Then another
> worker runs it again, from the beginning, whatever `retries` said.**

Which is why the sitemap job above rebuilds the whole file rather than appending to
it, and why a job that sends an email should record that it sent one:

```ts
export const SendWelcome = job('email.welcome', {
  input: { userId: uuid() },
  retries: 3,
  handle: async ({ userId }, context) => {
    const user = await User.findOrFail(userId)

    // The guard, not the send, is what makes this safe to run twice. A second
    // delivery of the same job finds the mark and does nothing.
    if (user.welcomedAt !== null) return

    await mailer.send(user.email, welcome(user))
    await context.commands.execute('users.mark-welcomed', { id: userId })
  },
})
```

The BullMQ adapter puts one lever on the wait, and none on the duplicate:

```ts
// The default is 30 000. Lower it and a crashed worker's jobs come back sooner —
// at the price that a worker which blocks its own event loop for longer than this
// has its job taken away and run twice while the first run is still going.
const worker = await queue.work({ concurrency: 4, reclaimAfterMs: 10_000 })
```

A worker that is stopped rather than killed loses nothing: `stop()` refuses new jobs
and waits for the one in flight, which is why it belongs on `SIGTERM`.

## Failure

A job that fails silently is worse than no job, so failure is loud in the place that
can act on it:

- The handler's rejection is logged at `error` with the job name, the request id and
  the duration, and then **rethrown** — the adapter is what decides whether to try
  again, and it can only decide that if the failure reaches it.
- `retries` is declared by the job and interpreted by the queue. What backoff means,
  and where a job goes once it has exhausted them, is the adapter's business. It
  bounds what happens *after a failure* and nothing else — a job that must not happen
  twice is not one that says `retries: 0`, it is one that is idempotent.
- A queue that is *unreachable* when a command tries to flush its batch is logged and
  not thrown. The transaction has already closed; turning a committed publish into an
  error because Redis is asleep reports the wrong failure to the wrong person. Outside
  a command the caller is still there, and gets the rejection.

## What an agent may do

Nothing, directly. MCP tools are generated from the registry's **commands and queries**
(ADR-0020), and jobs are deliberately not in that list. An agent asks for a command, and
the command decides what work that implies — a queue an agent can fill directly is a
queue an agent can flood.

The jobs section is still in the Schema Registry, so `/api/_introspection` lists what
an application is able to schedule. Seeing is not dispatching.

## Where to look next

- [Commands and queries](06-commands-and-queries.md) — the pipeline a job's batch is
  flushed by, and the commands a job runs.
- [Deploying](12-deploying.md) — where the worker process fits beside the server.
- `docs/adr/0023-jobs-are-a-port-and-a-queue-is-an-adapter.md` for the reasoning, and
  `packages/assemora/README.md` for the `jobs` option in full.
