# `@assemora/queue-bullmq`

The queue behind `dispatch()` (SPEC.md §82).

```ts
const queue = bullQueue({
  connection: { url: process.env.REDIS_URL },
  queue: 'assemora',
})

const app = createApplication({ queue, modules, authorization })
```

That is the whole of the producer side. `dispatch(GenerateSitemap({ pageId }))` now
writes to Redis instead of running the job in the request that scheduled it, and
nothing above this line changes — the adapter implements the `QueuePort` that
`@assemora/core` declares, and core never learns what Redis is (ADR-0023).

BullMQ and ioredis are declared here and nowhere else in the repository, which
`pnpm boundaries` enforces (SPEC.md §8, §125.1). Neither appears in a signature this
package exports: no `Job`, no `Worker`, no `ConnectionOptions`.

## The worker is four lines, because core owns the hard part

```ts
const app = await createApplication({ queue, modules, authorization }).boot()
const worker = await queue.work({ concurrency: 8 })

process.on('SIGTERM', async () => {
  await worker.stop()
  await app.shutdown()
})
```

`work()` resolves once Redis has answered, so a worker that cannot reach the queue
fails at startup rather than sitting there consuming nothing. `stop()` stops taking
new jobs and waits for the one in flight — an abandoned job is re-delivered when its
lock expires and runs twice.

## At least once, and what that costs

A queue delivers **at least once**. Assemora does not pretend otherwise, and neither
should a handler: **write every job so that running it twice is the same as running it
once.**

The duplicate has nothing to do with `retries`. A worker holds a lock on the job it is
running and renews it as it works; a worker that is *killed* rather than stopped —
`SIGKILL`, an OOM kill, a machine that went away — renews nothing, and the job is
invisible to every other worker until that lock expires. Recovery is a scan on the
same interval, so the wait is between one and two lock durations:

> **A hard-killed worker leaves the job it was holding unavailable for 30 to 60
> seconds. Then another worker runs it again, from the beginning, even at
> `retries: 0`.**

`retries: 0` means *do not try again after a failure*. It is not a delivery count, and
no setting anywhere makes one.

`work({ reclaimAfterMs })` is the lever on the wait:

```ts
const worker = await queue.work({ concurrency: 8, reclaimAfterMs: 10_000 })
```

Lower it and a crashed worker's jobs come back sooner — at the price that a worker
which blocks its own event loop for longer than the value has its job taken away and
run a second time while the first is still going. Raise it and a crash costs more time
before the work is picked up. Neither end removes the duplicate; only an idempotent
handler does.

`stop()` is the case where nothing is lost: it waits for the job in flight, which is
exactly why a graceful stop is worth wiring to `SIGTERM`.

A worker process has to build the application: `runJob` finds the job by name in the
registry the application filled, and re-validates the payload against that
declaration. What is left for this package is Redis, retries and the graceful stop.

The port is `push` and nothing else. `work()` lives on the adapter rather than on the
port because core never pulls — a stage of the mutation path pushes, and a method
core would never call is not a seam (ADR-0023).

## Retries, and where an exhausted job goes

A job declares `retries`, and this adapter reads it as *how many times to try again
after a failure*: `retries: 3` is four attempts. Between them the delay doubles from
`retryDelayMs` (one second by default) with half of each delay randomised — a hundred
jobs that all failed on the same outage must not retry in the same millisecond. It
bounds failures and nothing else; a worker that died holding the job is the section
above.

Every attempt is reported through the logger, because a queue fails between requests
with nobody waiting:

| What happened | Level | Message |
| --- | --- | --- |
| Failed, attempts left | `warn` | `Job failed, the queue will try again` |
| Failed, none left | `error` | `Job exhausted its retries and stays in the failed set` |
| Connection dropped | `error` | `The queue connection failed` |

An exhausted job **stays in the queue's failed set**, with the reason, the attempt
count and the request id that scheduled it. It is not deleted and it is not aged out:
the work is gone either way, and losing the explanation as well is the failure this
package exists to prevent. Read it back without naming BullMQ:

```ts
for (const failure of await queue.failed()) {
  console.error(failure.name, failure.requestId, failure.reason)
}
```

Completed jobs are the opposite case — a receipt, not a record, since the audit log
already holds what the job's commands did (SPEC.md §67). They are kept for a day, and
at most a thousand of them, so Redis does not grow without a bound nobody set.

Nothing is treated as unretryable, deliberately. BullMQ can fail a job on the first
attempt, and it is tempting to do that for a payload the application refuses — but
during a rolling deploy an old worker legitimately does not know a new job's name yet,
and dead-lettering that would destroy real work to save three cheap attempts.

## What a payload may contain

A payload crosses a queue as JSON, so it may hold strings, finite numbers, booleans,
`null`, arrays, plain objects — and dates.

Dates are the one exception, and they are exact rather than lossy: a `Date` is written
as its ISO string, which is what `timestamp().toJsonSchema()` already declares a
timestamp to be on the wire, and `runJob` re-parses the payload against the job's own
input schema on arrival — so a handler that declared `timestamp()` is handed the
`Date` it declared.

Everything else is refused when the job is pushed, naming the value and its path:

```
"sitemap.generate" cannot be queued: it carries a Map at payload.settings.seen.
```

`undefined`, `NaN`, `Infinity`, a `BigInt`, a function, a `Map`, a `Set`, a class
instance and a cycle are all refused. Each of them either vanishes or comes back as
something else, and discovering that in a worker at three in the morning is the
scenario the check exists to remove.

One seam is worth knowing: a job dispatched **inside a command** is held until the
transaction commits, and by then the caller has gone — so core logs a push failure
rather than throwing it, and an unqueueable payload there is an `error` line, not a
rejected command. Dispatching outside a command rejects at the call.

## The envelope

```ts
{ name, payload, retries, requestId, actor?, dispatchedFrom }
```

The actor and the request id survive Redis, so the job's own commands are authorized
as the person whose action scheduled them and the audit log says who. The source does
not: a worker runs with `source: 'job'`, because a row it writes was not written by
the studio click that scheduled it, and `dispatchedFrom` is what remains of where the
work came from.

Coming back out the envelope is untrusted input like any other — anything holding the
connection string can write to that list — so it is parsed against a declared shape
before a handler sees it, and a job that is not one fails as `MALFORMED_JOB` with the
offending fields named.

## Errors

A failure to reach the queue is an `AssemoraError` with a code a caller can act on:

| Code | Status | Means |
| --- | --- | --- |
| `QUEUE_UNAVAILABLE` | 503 | Not there, or not answering within `timeoutMs`. Try again |
| `QUEUE_DENIED` | 500 | The credentials were refused. Fix the deployment |
| `QUEUE_ERROR` | 500 | Redis rejected the operation |
| `UNQUEUEABLE_PAYLOAD` | 422 | The payload would not survive JSON |
| `MALFORMED_JOB` | 422 | What came back off the queue is not an envelope |

The connection string never appears in any of them. ioredis quotes the URL it was
given in some connection errors, so every message and every cause is put through a
redactor built from the adapter's own configuration — knowing the exact secret is
what makes that precise rather than hopeful (SPEC.md §85).

`timeoutMs` (five seconds by default) bounds pushing and starting a worker, because
ioredis will otherwise queue a command against a dead connection indefinitely and a
request would hang instead of failing. It deliberately does not bound `stop()`. A
timed-out push may still land — nothing un-sends a command already on the wire — which
is one more reason a job has to be idempotent: a queue delivers at least once.

## Tested against a real Redis

`tests/integration/queue-bullmq.test.ts` pushes a job, runs a worker, and asserts it
ran with the actor, the request id and the source the envelope promised; makes one
fail and asserts it retried exactly as often as it asked and then stopped; and stops a
worker mid-job to prove the job finished. An adapter tested only against a fake is an
adapter nobody has run.

`src/queue.test.ts` covers the three things that live *inside* `work()`, where no
caller can see them: that a forged envelope written straight to Redis is refused
before any handler sees it, that a worker which cannot reach Redis fails at startup
instead of consuming nothing, and — by taking a worker's lock away under it — that a
`retries: 0` job really is delivered twice.

It skips itself when nothing is reachable at `ASSEMORA_TEST_REDIS_URL`, and
`ASSEMORA_REQUIRE_REDIS=1` turns that skip into a failure.

## Workspace dependencies

- `@assemora/schema`
- `@assemora/core`
