# 0008. Core owns the ports for authorization, transactions, revisions and audit

Status: accepted
Date: 2026-08-26

## Context

SPEC.md §14 puts authorization, a transaction, revision collection and audit inside
the command pipeline, which lives in `@assemora/core`. SPEC.md §8 forbids `core`
from depending on `auth`, `revisions` or any database package — they all sit above
it. The dependency graph review before phase 1 flagged this as the first question
phase 1 has to answer (docs/architecture/package-graph.md).

Adding `resources → auth`, `pages → auth` and `mcp → auth` would satisfy the
pipeline but reverse the direction of §8 and make `auth` a mandatory dependency of
every content package.

## Decision

`core` declares the interfaces and the packages above it register implementations:

- `AuthorizationPort` — asked before every mutation runs.
- `TransactionPort` — wraps the handler and revision collection.
- `RevisionPort` — receives the changes a handler reported, inside the transaction.
- `AuditPort` — receives the outcome after the commit.

The checks therefore sit in the mutation path itself rather than in the callers, so
Studio, REST, the SDK, the CLI and MCP cannot each forget a different one.

**Authorization defaults to `denyAll()`.** An application with no policy provider
refuses every command and says why. The permissive port is exported as `permitAll()`
— a blunt name, so that running without authorization is a visible choice in the
configuration rather than an omission nobody notices (SPEC.md §85).

The other ports default to inert implementations, because at phase 1 there is no
database, no `@assemora/revisions` and no audit sink: `withoutTransactions()`,
`discardRevisions()`, `discardAudit()`. Their in-memory counterparts,
`collectRevisions()` and `collectAudit()`, exist for tests.

## Consequences

- `@assemora/data` implements `TransactionPort` as `dataTransactions()`, so a
  handler that writes several rows either commits all of them or none. Registering it
  is a line in the application configuration; without it the stage stays a no-op,
  which is how phase 4 first shipped until a review caught it.
- Phase 6 registers a real `AuthorizationPort` from `@assemora/auth` and phase 7 a
  real `RevisionPort` from `@assemora/revisions`. Neither changes `core`.
- A handler reports a revision through `context.revise(...)` and a side effect
  through `context.emit(...)`; the bus stamps the command, actor and request id, so
  a handler cannot forget them.
- Events are flushed only after the transaction commits, so a rolled-back command
  never notifies anyone (SPEC.md §81).
- The inert defaults are a real risk if they reach production silently. The
  deny-by-default authorization is the guard: an application that never registered
  its ports cannot execute a command at all.

## Alternatives

Direct dependencies from the content packages on `auth` — rejected: it reverses
SPEC.md §8. Checking permissions in each caller — rejected: SPEC.md §2 requires one
mutation path, and per-caller checks are how Studio and MCP drift apart.
