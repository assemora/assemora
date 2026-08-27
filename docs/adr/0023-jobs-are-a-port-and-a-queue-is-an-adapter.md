# 0023. A job is declared in core; a queue is an adapter behind a port

Status: accepted
Date: 2026-08-27

## Context

SPEC.md §82 gives the whole API in four lines:

```ts
await dispatch(
  GenerateSitemap({
    pageId,
  })
)
```

and two sentences: "The queue adapter must be separate. The first production adapter
is BullMQ."

Two questions had to be answered before any of it could be written.

**What is a job, next to a command and an event?** SPEC.md §81 already says events are
for side effects and must not carry critical sequential logic. A job is the third
thing: work that must happen, that must survive a process restart, and that must not
happen inside the request. An event is fire-and-forget in this process; a command is
the mutation itself; a job is durable work scheduled by one.

**What happens when a command dispatches a job and then rolls back?** This is the
question every queue integration gets wrong at least once. The job is already in
Redis, the transaction is not in the database, and the worker runs against a world
that never existed.

## Decision

**`job()` lives in `@assemora/core`, beside `command()` and `query()`.** It is the
third member of that family and it is declared the same way — a name, an input
schema, a handler. The Schema Registry gains a `jobs` section, so what an application
can schedule is introspectable like everything else it declares.

**A job definition is callable, and calling it does not run it.**
`GenerateSitemap({ pageId })` validates the payload and returns the thing `dispatch`
takes. That is what SPEC.md §82 writes, and it is the reason the definition is a
function carrying properties rather than a plain object — the same shape `model()`
already uses.

**The queue is a port, like authorization, transactions, revisions and audit**
(ADR-0008). Core declares `QueuePort` and never learns what Redis is. The default
implementation runs jobs in this process, awaited, rather than discarding them: a job
that vanishes in development and works in production is the worst of the possible
defaults, and the other ports discard because a missing revision is an absence while
a missing job is a lie.

**`@assemora/queue-bullmq` is the production adapter**, and it is the only package
allowed to name BullMQ or ioredis — machine-checked, like Drizzle in
`database-postgres` and Fastify in `http`. It depends on `schema` and `core` and
nothing else.

**A job dispatched inside a command is held until the command commits.** The command
pipeline already does this for events, for the same reason and with the same
mechanism: `context.dispatch` queues, and the queue is flushed in step 6 beside the
events, after the transaction has closed. A dry run flushes neither — a job cannot be
un-run any more than a listener can be un-notified (SPEC.md §73).

Dispatching outside a command hands the job over immediately, because there is no
transaction to wait for and pretending otherwise would silently defer work that
nothing will ever flush.

**A job carries the context that dispatched it.** The actor, the request id and the
source travel in the envelope, and the worker restores them — so a job's own writes
are authorized as the person whose action scheduled them, and the audit log says who.
`ContextSource` gains `'job'`, so a row written by a worker is distinguishable from
one written by the request that queued it.

**A job is not a command, and an agent cannot dispatch one.** MCP tools are generated
from the registry's commands and queries (ADR-0020); jobs are deliberately not in
that list. An agent asks for a command, and the command decides what work that
implies. A queue an agent can fill directly is a queue an agent can flood.

## Consequences

- An application with no queue registered still runs its jobs. That is the point, and
  it means a job's failure surfaces in development where it can be read.
- Because the default is synchronous, a slow job slows the request that scheduled it
  until a real adapter is registered. Said out loud in the guide rather than hidden.
- A worker is started by the application, not by the CLI. SPEC.md §77 fixes twenty-two
  commands and none of them is a worker; adding a twenty-third to that list is a
  decision this ADR does not make. The umbrella runs one in-process on request, and a
  dedicated worker process is an entry point of four lines.
- Retries belong to the adapter. Core declares how many a job asks for; what backoff
  means, and where a job goes when it has exhausted them, is the queue's business.
- Testing the BullMQ adapter needs Redis, so CI stands one up beside PostgreSQL. An
  adapter tested only against a fake is an adapter nobody has run.

## Alternatives

**Jobs as events with a durable listener** — rejected. SPEC.md §81 draws the line
deliberately: a failing listener must not fail the command, and a failing job must not
be forgotten. Collapsing them would mean one mechanism with two incompatible failure
policies.

**A `@assemora/jobs` package holding the DSL** — rejected. It would own no model and
no behaviour beyond the declaration, and `command()` and `query()` are already in
core; putting the third member elsewhere would make the family harder to find than it
is to implement.

**Dispatching straight to the queue from inside a command** — rejected outright. It
is the defect this decision exists to prevent, and it fails in the direction that
cannot be recovered: the work runs against state that was rolled back.
