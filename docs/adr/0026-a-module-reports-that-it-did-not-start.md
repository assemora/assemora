# 0026. A module reports that it did not start; the process that serves decides what that means

Status: accepted
Date: 2026-08-28

## Context

ADR-0021 makes the CLI a client of the application: `assemora db:generate` imports the
project's `assemora.config.ts`, boots the real application and reads its registry. The
schema it then writes is the one that creates `@assemora/resources`'s own tables — so
the `collections()` boot hook, which reads `assemora_resource_definitions`, has to
tolerate that table not existing yet or the first migration of every project that
registers `collections()` is ungeneratable. That is settled, and the invariant is
written on the hook: **an application must be able to boot against a schema that is not
applied yet.**

Tolerating it is only half of an answer. Boot the same application with `assemora start`
against the same unmigrated database and the process listens, serves `/studio` with a
200, serves `/api/openapi.json` with a 200, answers `GET /api/ready` with
`200 {"status":"ready"}` — and refuses every data request with `503 SCHEMA_NOT_APPLIED`.
A Kubernetes readiness probe reads that 200 and routes production traffic at it.

`/ready` deliberately does not probe the database. The adapter contract has no portable
ping, and a readiness check that lies about what it verified is worse than one that says
what it means. But the same comment has always said `/ready` means "it has finished
booting **and its modules are running**", and a module that could not read its own table
is not running. The missing half was never a probe. It was a fact the boot had already
established and then thrown away: `@assemora/resources` computed it, kept it in a
module-level `collectionsPending()`, and nothing anywhere called it.

`@assemora/assemora` has `@assemora/resources` as a devDependency only, so the fact
cannot travel from one to the other directly. And it must not become a special case for
collections: the next boot hook that reads something will have the same problem.

## Decision

**A module says during boot that it did not start, and why. Core collects it. Whoever
booted the application decides what it means.**

Two additions, and no new package edge:

- `ModuleContext.cannotStart(reason, { remedy })` — a boot hook already has the
  context, so a module that survived something it could not work without reports it
  with one call and no plumbing. The module name is read off the context, never
  claimed by the caller.
- `Application.notStarted: readonly NotStarted[]` — `{ module, reason, remedy? }`,
  appended in the order the reports arrived. Empty is the only shape of "everything
  started".

`assemora()` composes the two halves it alone can see — `booted`, which covers what the
umbrella mounts after the hooks have run, and `app.notStarted`, which is what core
collected while they ran — and `/ready` answers 503 with the reasons until both are
satisfied. `/health` still answers 200: the process is live, and restarting it would fix
nothing.

**The boot does not throw.** Refusing to start here would take `db:generate` down with
it, which is the command this whole shape exists to keep working. Core logs
`Application booted without every module running` instead of `Application ready` —
deliberately a different string, because the second is what an operator greps for — and
`listen()` logs an error, because a process started to serve is the one caller for which
the state is fatal rather than routine.

**`reason` and `remedy` are sentences the module wrote, never a message it caught.**
They are served in the 503 body to whoever can reach the probe, and a raw driver failure
carries a host, a user and sometimes a query (SPEC.md §85).

`collectionsPending()` is deleted. The fact now reaches its consumer through core, and
one fact with two homes is how the two come to disagree.

## Consequences

- An unmigrated deployment listens and stays out of the load balancer, with the reason
  and `Run assemora db:migrate.` in the log and in the 503. Verified end to end against
  a created-but-unmigrated PostgreSQL: `/api/health` 200, `/api/ready` 503, and both
  200 after `assemora db:migrate` and a restart.
- `assemora db:generate` and `assemora db:migrate` still boot and still work against a
  database with no schema. They read `notStarted` and ignore it, which is the right
  answer for them and is the whole reason this is a report rather than a refusal.
- Every module above core gets this free. The next boot hook that reads data — a search
  index, a cache warm-up, a licence check — has somewhere to put "I am registered and I
  am not running" without teaching `@assemora/assemora` what it is.
- `Application` grew a required member, so anything that builds one by hand rather than
  through `createApplication()` has to supply it. Nothing in the repository does; the
  facade in `@assemora/assemora` forwards core's.
- A module can now be quietly wrong in a new way: reporting `cannotStart` for something
  optional would take an otherwise healthy application out of service. The seam is
  documented for the middle case — a module that cannot do its job but has nothing to
  gain from stopping the process — and a module that is genuinely optional should say
  nothing.
- Nothing revokes a report. A module that recovers later cannot take it back, and the
  remedy for every case that exists today is a restart after a migration. A retraction
  would need a rule for who may issue one, which nothing needs yet.

## Alternatives

**Make `/ready` probe the database** — rejected, and for the reason already on the
endpoint: the adapter contract has no portable ping, and inventing one would put a
`SELECT 1` on the hot path of every probe in every deployment to answer a question the
boot had already answered.

**Export `collectionsPending()` and have the umbrella read it** — rejected. It needs
`@assemora/assemora → @assemora/resources` as a real dependency, which is a package edge
and an ADR of its own (SPEC.md §8), and it answers the question exactly once: the second
module with the same problem needs a second global and a second import.

**Throw out of the boot hook when the table is missing** — rejected. It is precisely the
regression of `b38d393`: `assemora db:generate` cannot write the migration that creates
the table it could not read.

**A `ready` lifecycle phase a module must pass, or an application refuses to serve** —
rejected as a bigger thing than the problem. Core already has `boot` and `ready` phases,
and adding a verdict to them turns every hook into something that must remember to
succeed. Absence is the right default for "started".

## Amendment — a readiness refusal is not an incident

The decision above holds. What it did not settle is what a *permanent* 503 costs on the
way out.

`/api/ready` now refuses for as long as a module cannot start, and nothing revokes a
`cannotStart` report — so the condition lasts for the life of the process. Every refusal
is an `AssemoraError` with `status: 503`, `isIncident` draws its line at 500 and above,
and the HTTP layer reports whatever a handler throws. A Kubernetes `readinessProbe` at
`periodSeconds: 5` therefore sent roughly seventeen thousand identical events a day to
the `ErrorTrackingPort`, each carrying a stack from the default `logErrors` reporter,
about a fact `listen()` had already logged once. Before this ADR that was unreachable:
`/ready` was 503 only inside the boot window `listen()` awaits, so in practice never.
`ports.ts` states the harm in its own words — a tracker fed a page of refusals hides the
one 500 that mattered, and then nobody looks at it again.

**`AssemoraError` takes `expected`, and `isIncident` reads it.** A status of 500 or more
says nobody has claimed the failure was the caller's, which is what makes it a defect;
it cannot also say that the 5xx *is* the answer. `/ready` refuses with 503 because that
is what a load balancer must read, not because anything failed, so both of its throws
set the bit. It only ever withdraws the claim — below 500 nothing is an incident to
begin with — so the harmful direction, an error that wanted reporting and did not get
it, is not expressible.

The line stays where it was, and stays drawn once: the layers still ask `isIncident`,
and the answer still comes from the error model rather than from a rule any layer keeps
of its own. The body of `/api/ready` is unchanged — same status, same envelope, same
`notStarted` details.

**The access log is the second reader, and it was answering on its own.**
`requestLogLevel` drew the same "whose failure is this" line from the status alone, so
the probe that stopped reaching the tracker still wrote seventeen thousand `error` lines
a day into the log that the default reporter also writes to — the same harm one layer
down, in the file that ends up in a ticket. It asks `isIncident` too now, and an
expected 5xx takes the rung a refusal takes. Not silence: a permanently unready
application is worth seeing in an access log, and a rolling deploy's handful of lines is
worth seeing too.

**Alternatives.** *The route declares it* — `/ready` is the only place in the repository
that puts a 5xx in a route's `errors` list, so `errors: [{ status: 503 }]` would have
inferred it with no new API at all. Rejected: a route may perfectly well document
`{ code: 'UPSTREAM_UNAVAILABLE', status: 502 }`, and that is an incident. The
declaration says what a caller may receive, not whose fault it was. *A subclass
`isIncident` knows by name* — rejected: it puts a list of exempt types in core that
every later case has to be added to, which is the special case this must not become.
*Answer 503 from the handler instead of throwing* — rejected: the refusal would have to
rebuild §46's envelope by hand, and the next endpoint with a legitimate 5xx answer would
rebuild it again.

Deliberately **not** amended: `SCHEMA_NOT_APPLIED` stays an incident. It is also a 503
and also permanent, but it is raised by a *data* request rather than by a probe — an
application serving in that state answers nothing correctly, and there is no volume
argument because readiness is what keeps traffic away from it.
