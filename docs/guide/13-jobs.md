# Jobs

```ts
import { command, dispatch, job } from '@assemora/core'
import { string, uuid } from '@assemora/schema'

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

export const PublishArticle = command('articles.publish', {
  input: { id: uuid() },
  handle: async ({ id }, context) => {
    const article = await Article.findOrFail(id)

    await article.update({ status: 'published' })
    context.dispatch(GenerateSitemap({ reason: `articles.publish ${article.slug}` }))

    return { id, slug: article.slug }
  },
})

module('blog').commands(PublishArticle).jobs(GenerateSitemap)
```

A job is durable work that must happen, must survive a restart, and must not happen
inside the request. It is the third member of the family beside `command()` and
`query()` (SPEC.md §82).

| | | |
| --- | --- | --- |
| **Command** | the mutation itself | must be atomic, must be authorized, must be recorded |
| **Event** | a side effect in this process | may be missed without anybody being worse off |
| **Job** | durable work somebody will do | must happen, even if this process dies now |

The line between an event and a job is the one to get right. SPEC.md §81 says an
event must never carry critical sequential logic. A failing listener must not fail
the command, so a listener may be forgotten. A job is the opposite promise. The
welcome email, the sitemap, the re-encoded video: none of those may quietly not
happen.

## Declaring a job

A job is declared exactly the way a command is: a name, an input shape, a handler.

```ts
import { job } from '@assemora/core'
import { uuid } from '@assemora/schema'

export const SendWelcome = job('email.welcome', {
  // Shown in the Schema Registry and at /api/_introspection.
  description: 'Sends the welcome email once',
  // A shape of schema fields. The handler's payload is inferred from it.
  input: { userId: uuid() },
  // Attempts after a failure. Three by default. Interpreted by the queue.
  retries: 3,
  handle: async ({ userId }, context) => {
    const user = await User.findOrFail(userId)

    if (user.welcomedAt !== null) return

    await mailer.send(user.email, welcome(user))
    await context.commands.execute('users.mark-welcomed', { id: userId })
  },
})
```

It registers the same way too, and the registry then lists it under `jobs`:

```ts
module('users').commands(MarkWelcomed).jobs(SendWelcome)
```

Calling the definition validates the payload and runs nothing.

```ts
SendWelcome({ userId })         // → a JobRequest: { name, payload, retries }
SendWelcome({ userId: 'nope' }) // → throws ValidationError, here, at this line
```

A wrong payload fails where it was written, not in a dashboard tomorrow morning.
`undefined`, a function and a symbol are refused at the same place: no wire format
carries them. A `Date` is fine.

The handler receives a `JobContext`:

```ts
type JobContext = AssemoraContext & {
  readonly logger: Logger
  readonly commands: CommandBus
  readonly queries: QueryBus
  readonly events: EventBus
  readonly container: Container
}
```

There is no `revise` and no `authorize` on it. A job is not a mutation. The commands
it runs are, and they already carry both. A job that changes anything executes a
command. There is no second way in.

## Dispatching

`dispatch()` takes what a definition answered with.

```ts
import { dispatch } from '@assemora/core'

await dispatch(GenerateSitemap({ reason: 'a page was published' }))
```

Inside a command, `context.dispatch()` does the same thing without the `await`, beside
`context.emit()`. Both write to the same batch.

```ts
export const PublishPage = command('pages.publish', {
  input: { id: uuid() },
  handle: async ({ id }, context) => {
    await publish(id)

    context.emit('page.published', { id })
    context.dispatch(GenerateSitemap({ reason: `pages.publish ${id}` }))
  },
})
```

Outside a command, `dispatch()` hands the job over immediately. There is no
transaction to wait for. An event listener is the ordinary case:

```ts
module('blog')
  .jobs(GenerateSitemap)
  // `pages.publish` belongs to @assemora/pages, so this module cannot dispatch from
  // inside it. A listener runs after that command committed.
  .on('page.published', ({ slug }) => dispatch(GenerateSitemap({ reason: slug })))
```

A script that wrapped its work in `transaction()` is the exception. The dispatch
waits for that commit, by the same rule as below.

## After commit

A job dispatched inside a command waits for the outermost transaction to commit. It
does not wait for the command to return.

```text
… → transaction → handler → revision → jobs → events → audit
```

Inside a command the job joins a batch. The batch goes to the queue in step 6, after
the transaction has closed. Without that rule:

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

The job would already be in Redis. The article would not be published. A worker on
another machine would rebuild a sitemap around a row that does not exist. Because the
batch is flushed after the commit, a command that rolls back queues nothing.

"After the commit" is a transaction fact, not a command fact. That is why the seam is
`TransactionPort.afterCommit`, and why events use it too:

```ts
type TransactionPort = {
  run<T>(operation: () => Promise<T>, options?: TransactionOptions): Promise<T>
  // Holds `work` until the OUTERMOST transaction commits. Drops it on rollback.
  afterCommit(work: () => Promise<void>): Promise<void>
}
```

Three cases fall out of the one rule:

```ts
// A nested command opens a savepoint. Its jobs wait for the outer commit.
await context.execute('articles.publish', { id })

// Two commands inside one transaction() wait for that commit, not their own.
await transaction(async () => {
  await commands.execute(PublishArticle, { id: first })
  await commands.execute(PublishArticle, { id: second })
})

// A dry run is the pipeline with the transaction rolled back (ADR-0019).
const preview = await commands.dryRun(PublishArticle, { id })
preview.jobs // ['sitemap.generate'], and none of them were queued
```

A job cannot be un-run any more than a listener can be un-notified.

## The envelope

A job carries the context that scheduled it, because its writes are still that
person's writes.

```ts
type QueuedJob = {
  readonly name: string
  readonly payload: unknown       // validated at dispatch, and again at run
  readonly retries: number
  readonly requestId: string      // one id from the click to the job's own commands
  readonly actor?: Actor          // restored, so the job's writes pass the same policies
  readonly dispatchedFrom: ContextSource
}
```

On the wire:

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

The worker restores the actor and the request id. It does not restore the source.
A row written by a worker was not written by the studio click that scheduled it, so
the job runs as `source: 'job'`. Where the work came from survives as
`dispatchedFrom`.

```ts
const Inspect = job('probe.context', {
  input: {},
  handle: async (_payload, context) => {
    context.source     // 'job'
    context.requestId  // the request that dispatched it
    context.actor      // the person whose click dispatched it
  },
})
```

Restoring the actor is not the same as trusting it. The queue is the first place an
identity is stored and replayed later. The gap is however long the job sat there. So
`permissionsOf` checks that the actor is still one, every time it resolves them:

```ts
await asAda(() => dispatch(RenameLater({ title: 'renamed by the job' })))
await deactivate(ADA) // auth.users.update with active: false

await expect(runJob(pushed[0])).rejects.toThrow(ForbiddenError)
```

A deactivated user holds nothing from that moment. The same is true of an API token
that expired since it was used, and of an agent that was disabled. It costs one row
read per resolution, and it is the only revocation the framework has.

## The queue adapter

BullMQ is the production adapter (ADR-0023). `@assemora/queue-bullmq` is the only
package that names BullMQ or ioredis, and `pnpm boundaries` checks it.

```ts
import { bullQueue } from '@assemora/queue-bullmq'

const queue = bullQueue({
  connection: {
    url: process.env.REDIS_URL ?? '',
    // or host, port, username, password, db, tls
  },
  queue: 'assemora',          // the list both ends agree on
  prefix: 'assemora',         // namespace for every Redis key
  logger,                     // where retries and exhaustion are reported
  retryDelayMs: 1_000,        // the first retry's delay; doubles each attempt
  timeoutMs: 5_000,           // bounds pushing and starting a worker, not stop()
})
```

Every value above is the default except `connection`. The adapter implements
`QueuePort`, which is `push` and nothing else:

```ts
type QueuePort = {
  push(jobs: readonly QueuedJob[]): Promise<void>
}
```

`work()` lives on the adapter rather than on the port. Core never pulls.

```ts
type BullQueue = QueuePort & {
  work(options?: WorkOptions): Promise<QueueWorker>
  failed(limit?: number): Promise<readonly FailedJob[]>
  close(): Promise<void>
}
```

The application takes the adapter through `jobs`:

```ts
export default assemora({
  …,
  jobs: { queue, worker: () => queue.work({ concurrency: 4 }) },
})
```

`worker` is a function on purpose. `assemora routes` imports this very file to
describe the application (ADR-0021). A worker built at import would consume
production jobs to answer a question about routes.

## The worker process

`listen()` serves and `work()` works. Which shape a process is belongs to its entry
point, not to the application.

```ts
// src/server.ts
import { createApp } from './app.ts'

await createApp().listen()
```

```ts
// src/worker.ts — a worker process, in full
import { createApp } from './app.ts'

await createApp().work()
```

A process that does both calls both. `work()` boots, then starts pulling. It resolves
once Redis has answered, so a worker that cannot reach the queue fails at startup.

There is no `assemora worker` command. SPEC.md §77 fixes twenty-two CLI commands and
none of them is a worker. The application starts its own.

```ts
const worker = await queue.work({
  concurrency: 4,          // jobs this worker runs at once. One by default
  reclaimAfterMs: 30_000,  // how long a silent worker keeps its job. The default
})

process.on('SIGTERM', async () => {
  await worker.stop()      // refuses new jobs, waits for the one in flight
  await app.shutdown()
})
```

`shutdown()` does that in order: the server, then the worker, then the queue, then
the modules and the database. A worker stops by refusing new jobs and finishing the
ones running, and those jobs execute commands. The other order strands one halfway.

Underneath, an adapter does one thing with a payload:

```ts
import { runJob } from '@assemora/core'

await runJob(queued) // finds the job, re-validates, restores the context, runs it
```

The payload is validated a second time there. It crossed a serializer and sat where
anything holding the connection string can write.

## Retries

A queue delivers at least once. Write every job so that running it twice is the same
as running it once.

`retries` does not change that. It is the number of attempts after a failure, read by
the adapter. `retries: 3` is four attempts. `retries: 0` means do not try again after
a failure. It is not a delivery count, and no setting anywhere is one.

```ts
export const SendWelcome = job('email.welcome', {
  input: { userId: uuid() },
  retries: 3,
  handle: async ({ userId }, context) => {
    const user = await User.findOrFail(userId)

    // The guard, not the send, is what makes this safe to run twice.
    if (user.welcomedAt !== null) return

    await mailer.send(user.email, welcome(user))
    await context.commands.execute('users.mark-welcomed', { id: userId })
  },
})
```

The duplicate comes from a worker that stopped answering, not from a failure. A worker
holds a lock on the job it runs and renews it as it works. A worker that is killed
(`SIGKILL`, an OOM kill, a machine that went away) renews nothing. Recovery is a scan
on the same interval, so the wait is one to two lock durations.

> A hard-killed worker leaves its job unavailable for 30 to 60 seconds. Then another
> worker runs it again, from the beginning, whatever `retries` said.

`reclaimAfterMs` is the one lever, and it moves the wait rather than the duplicate:

```ts
// Lower it and a crashed worker's jobs come back sooner. A worker that blocks its
// own event loop for longer than this has its job taken away and run twice.
const worker = await queue.work({ concurrency: 4, reclaimAfterMs: 10_000 })
```

Between attempts the delay doubles from `retryDelayMs`, with half of each delay
randomised. A hundred jobs that failed on one outage must not retry in one
millisecond.

## Failure

A job that fails silently is worse than no job, so a failure is loud where it can be
acted on.

The handler's rejection is logged at `error` with the job name, the request id and
the duration. Then it is rethrown. The adapter decides whether to try again, and it
can only decide that if the failure reaches it.

| What happened | Level | Message |
| --- | --- | --- |
| Failed, attempts left | `warn` | `Job failed, the queue will try again` |
| Failed, none left | `error` | `Job exhausted its retries and stays in the failed set` |
| Connection dropped | `error` | `The queue connection failed` |

An exhausted job stays in the failed set with its reason, attempt count and request
id. Read it back without naming BullMQ:

```ts
for (const failure of await queue.failed()) {
  console.error(failure.name, failure.requestId, failure.attempts, failure.reason)
}
```

A queue that is unreachable when a command flushes its batch is logged and not
thrown. The transaction has already closed. Turning a committed publish into an error
because Redis is asleep reports the wrong failure to the wrong person. Outside a
command the caller is still there, and gets the rejection:

| Code | Status | Means |
| --- | --- | --- |
| `QUEUE_UNAVAILABLE` | 503 | Not there, or not answering within `timeoutMs` |
| `QUEUE_DENIED` | 500 | The credentials were refused |
| `QUEUE_ERROR` | 500 | Redis rejected the operation |
| `UNQUEUEABLE_PAYLOAD` | 422 | The payload would not survive JSON |
| `MALFORMED_JOB` | 422 | What came back off the queue is not an envelope |

## Without a queue

With no queue configured, jobs run in this process, awaited. They are not discarded.

```ts
assemora({ database, modules: [auth(), blog()] }) // no `jobs`
```

Every other port discards when nothing is registered. A missing revision is an
absence. A missing job is a lie: work the application was told would happen and that
never did. The default is `runJobsHere` in core:

```ts
import { runJobsHere } from '@assemora/core'

// What createApplication() uses when `queue` is absent. Awaited, in order, and one
// failing job does not cancel the ones behind it.
const queue = runJobsHere((job) => runJob(job))
```

`assemora()` says the cost out loud at boot, once, and only when the application
declares a job:

```text
warn  Jobs run inside the process that schedules them
      jobs:   ["sitemap.generate"]
      effect: a restart loses what is in flight, and a slow job slows the request
      option: jobs: { queue } for a durable queue
```

- A slow job slows the request that scheduled it.
- A restart loses whatever was in flight.
- `retries` is ignored. It is addressed to a queue, and this is not one.

For development, and for a small deployment whose jobs are quick, that is a fine
answer. Registering an adapter changes nothing in a job. It changes the guarantee. In
this process a job runs at most once and a restart loses it. Behind a queue it runs
at least once and a crash repeats it. An idempotent handler is correct under both.

## Testing

A test hands the application a `QueuePort` that records, then runs what was recorded.

```ts
import { createApplication, dispatch, permitAll, runJob } from '@assemora/core'
import type { QueuedJob, QueuePort } from '@assemora/core'

const recordingQueue = (): QueuePort & { readonly pushed: QueuedJob[] } => {
  const pushed: QueuedJob[] = []

  return { pushed, push: async (jobs) => void pushed.push(...jobs) }
}

it('queues exactly one job once the transaction commits', async () => {
  const queue = recordingQueue()
  const app = createApplication({
    authorization: permitAll(),
    transactions: dataTransactions(),
    queue,
    modules: [module('blog').commands(PublishArticle).jobs(GenerateSitemap)],
  })

  await app.run({ source: 'studio', actor: { type: 'user', id: 'ada' } }, () =>
    app.commands.execute(PublishArticle, { id: ARTICLE_ID }),
  )

  expect(queue.pushed).toHaveLength(1)
  expect(queue.pushed[0]).toMatchObject({
    name: 'sitemap.generate',
    actor: { type: 'user', id: 'ada' },
    dispatchedFrom: 'studio',
  })

  // What the worker does with it, and all it does.
  await runJob(queue.pushed[0])
})
```

The in-process default needs no fake. Leave `queue` out and the job has run by the
time `dispatch()` resolves:

```ts
it('runs the job rather than discarding it', async () => {
  const seen: string[] = []

  const Remember = job('sitemap.generate', {
    input: { pageId: uuid() },
    handle: async ({ pageId }) => void seen.push(pageId),
  })

  const app = createApplication({
    authorization: permitAll(),
    modules: [module('pages').jobs(Remember)],
  })

  await app.run({ source: 'cli' }, () => dispatch(Remember({ pageId: PAGE_ID })))

  expect(seen).toEqual([PAGE_ID])
})
```

The BullMQ adapter is tested against a real Redis in
`tests/integration/queue-bullmq.test.ts`. It skips itself when nothing answers at
`ASSEMORA_TEST_REDIS_URL`; `ASSEMORA_REQUIRE_REDIS=1` turns the skip into a failure.

## Agents

An agent cannot dispatch a job. MCP tools are generated from the registry's commands
and queries (ADR-0020), and jobs are deliberately not in that list.

```json
{ "method": "tools/call", "params": { "name": "articles.publish", "arguments": { "id": "…" } } }
```

An agent asks for the command. The command decides what work that implies.

A queue an agent can fill directly is a queue an agent can flood. The `jobs` section
is still in the Schema Registry, so `/api/_introspection` lists what an application
can schedule. Seeing is not dispatching.

## Where to look next

- [Commands and queries](06-commands-and-queries.md) — the pipeline a job's batch is
  flushed by, and the commands a job runs.
- [Deploying](12-deploying.md) — where the worker process fits beside the server.
- `docs/adr/0023-jobs-are-a-port-and-a-queue-is-an-adapter.md` for the reasoning, and
  `packages/assemora/README.md` for the `jobs` option in full.
