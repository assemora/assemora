# 0019. Dry run belongs to the Command Bus, and a change set is a package

Status: accepted
Date: 2026-08-26

## Context

SPEC.md §73 requires AI mutations to be previewable by default, and draws the flow
as a pipeline: validation, authorization, dry run, change set, diff, approval,
apply. SPEC.md §75 states the guarantee that flow exists for — production state does
not change before Apply — and §74 fixes the table a change set is stored in.

SPEC.md §68 forbids MCP from carrying business logic of its own. So the question is
not *whether* preview is shared, but where it lives so that nothing reimplements it.

## Decision

**`commands.dryRun()` is a second entry point into the same pipeline.** The Command
Bus already collects, in scope and before anything commits, exactly what a preview
needs: the revisions the handler asked for, and the events it queued. A dry run runs
validation, authorization, the handler and the revision collection unchanged, and
then undoes the transaction instead of committing it.

A preview layer inside `@assemora/mcp` was rejected. It would be duplicate business
logic, which §68 forbids outright, and it would drift from the real handler the
first time a command changed. It also mistakes what a dry run is: previewability is
a property of a mutation, not of the transport that asked for one. The CLI, Studio
and an agent all want it.

**`TransactionPort.run` takes options, and `{ rollback: true }` is one of them.**
Today the only way to undo is to reject, which loses the value the operation
produced — and a preview is exactly the case where the value is the whole point. A
port that cannot undo must refuse rather than commit, because silently committing a
preview is the one outcome worse than not having previews.

**Change sets are `@assemora/change-sets`, and `@assemora/mcp` has no edge to it.**
The table of §74 needs `@assemora/data`, so it cannot live in core, and `mcp` may
not depend on `data`. It could have been owned by `mcp` — but a change set is not an
MCP concept. §75 is *Studio* UX, and Studio reaches change sets over HTTP through
`mountCommands()` and `mountQueries()` like anything else. Owning it in `mcp` would
give the one client that happens to have process access a privilege the others lack.

MCP needs no edge because MCP dispatches *names*. `changesets.apply` is a string on
the Command Bus, and the bus is in core.

**A mutation tool previews and proposes; it does not mutate.** Calling
`assemora.entries.update` runs a dry run and appends to the agent's open change set,
answering with the diff. Production state changes when `changesets.apply` runs,
normally from Studio, in a human's context and under the human's permissions.

An `apply: boolean` on every mutation tool was rejected. It puts the decision inside
the model's output, and §75 states flatly that production state does not change
before Apply. A flag the caller sets is not a gate: the first time a model emits
`apply: true` because a prompt told it to, the guarantee is gone.

**`diff()` moves down into `@assemora/schema`.** Core builds a preview's patch and
`change-sets` builds a stored one, and neither may import `@assemora/revisions`. A
second implementation would guarantee that "spacing: xl → md" eventually means one
thing on a revision screen and another on a change-set screen — over the same two
snapshots, on a screen §75 shows both on.

## Consequences

A preview runs the real handler, so a handler with an effect outside the database —
writing a file, calling another service — half-runs and then reports that nothing
changed. `media.upload` and `media.delete` are the two known today. A command
declares `previewable: false` when it cannot honestly be previewed, and nothing
verifies that declaration; it is a promise, not a check.

The ids in a preview are invented in process and are not the ids an apply will
produce. Nothing may store a preview id, and §75's screen must never show one as if
it were real.

`baseVersions` can only be collected where a snapshot carries a version. Pages and
users have one; resource rows do not, because §66's versioning landed with pages.
Conflict detection on apply is therefore complete for pages and absent for entries
until versioning is general.

An application with no transaction port loses dry run entirely, and finds out when
it calls it rather than at boot. That is the honest failure: the alternative is a
preview that silently commits.
