# 0011. How the PostgreSQL adapter behaves

Status: accepted
Date: 2026-08-26

## Context

Phase 3 (SPEC.md §110) turns the Query AST into real SQL. Four questions had to be
answered while doing it, and each one is visible from outside the package even
though Drizzle itself is not.

## Decision

**Identifiers are snake_case in the database.** A field named `publishedAt` becomes
the column `published_at`. The mapping lives in one function and is applied when the
Drizzle table is built, so the AST keeps addressing Assemora field names and nothing
above the adapter learns about it. SPEC.md's own system tables (§38, §53, §63, §64)
are written in snake_case, so this follows the specification rather than inventing a
convention.

**Relations load in batches, never one query per row.** After the parents are
fetched, each declared relation costs exactly one further statement, keyed by an
`in (...)` over the collected keys. The adapter counts its statements, and the
integration suite asserts that loading two users with their posts takes two
statements — which is how SPEC.md §89 wants N+1 caught: by a test, not by review.

**Driver errors are translated, and the statement never escapes.** A raw Drizzle
error carries the failing SQL and every parameter value in its message — an email, a
token, a password hash. That is exactly what SPEC.md §85 forbids in logs and what
§83 says must have a stable shape instead. The adapter maps SQLSTATE codes onto
Assemora errors (`UNIQUE_VIOLATION`, `FOREIGN_KEY_VIOLATION`, `NOT_NULL_VIOLATION`,
`CHECK_VIOLATION`, `INVALID_VALUE`, `SERIALIZATION_FAILURE`) and keeps only the
constraint, table and column names, which are safe and are what makes a failure
actionable.

A failure is recognised as the driver's own only when a five-character SQLSTATE
appears in its cause chain. Inside `transaction()`, anything else is the caller's own
error and is rethrown untouched — the first version relabelled application errors as
`DATABASE_ERROR`, and an integration test caught it.

**A nested transaction is a savepoint, not a second transaction.** `transaction()`
reuses the connection that is already open and asks it for a nested transaction,
which PostgreSQL implements as a savepoint. The first version always started from the
pool, so an inner `transaction()` ran on its own connection and committed
independently — an outer rollback left its writes behind, and the atomicity of
SPEC.md §33 was quietly gone. An integration test now holds that shut in both
directions: an outer rollback discards the inner writes, and an inner failure leaves
the outer ones intact.

**DDL comes from the model registry; diffing does not, yet.** `createSchemaSql`
builds a complete schema for a fresh database, including foreign keys derived from
`belongsTo` relations and indexes for declared columns and every foreign key. The
migration runner applies ordered migrations in their own transactions and records
them in `assemora_migrations`. Generating the *difference* between two schema
versions is what `assemora db:generate` does, and it lands with the CLI in phase 10
(SPEC.md §34, §77).

**Neither Drizzle nor `pg` appears in a public signature.** The translation helpers
are not exported from the package entry point, and the connection pool lives in a
side table rather than on the adapter type. What a caller gets instead is `raw()` —
a named, obviously advanced escape hatch for DDL and for the rare thing the Query AST
cannot express (SPEC.md §10) — plus `applySchema` and `dropSchema`, so building a
schema is supported rather than left to a loop over strings. Test instrumentation
sits under `diagnostics`, apart from the ordinary surface.

**The adapter refuses what would otherwise be lost.** Drizzle drops a value whose
column it does not know, so a typo or a stale descriptor became data that was never
written; unknown keys are now rejected. Tables are cached by descriptor identity
rather than by name, because two descriptors sharing a name used to resolve to
whichever was built first. `search_path` is pinned on the connection, so an
unqualified name cannot be pointed elsewhere by a role setting. The pool has an
`error` listener: without one, a connection dropped by a restarting server is an
unhandled event that terminates the process.

**Migrations hold an advisory lock**, so two deploys starting together cannot both
apply the same pending list, and a rollback that fails no longer masks the failure
that caused it. `introspect()` reports real types, primary keys, uniqueness and
`camelCase` names, in the same vocabulary a declared descriptor uses.

## Consequences

- Column defaults are not written into the DDL: the data layer fills them
  (`defaultRandom`, `created`, `updated`, `default`). A row inserted by hand in
  `psql` therefore does not get them. When the CLI starts generating diffs, defaults
  should move into the schema as well.
- The generated schema has no down-migration; `dropSchemaSql` exists for tests.
- Drizzle's column builders cannot be threaded generically, so the package holds one
  narrow structural view of them (`ColumnBuilderLike`) instead of `any`. It is the
  only place in the repository that mentions Drizzle at all.

  An earlier version of this ADR claimed that view forced a cast at every builder.
  A review measured it and the claim was wrong: the casts existed only because the
  view named two modifiers — `defaultNow` and `defaultRandom` — that nothing calls.
  Naming only what the module actually uses removes all fourteen of them, and the
  one that remains is the `pgTable` call itself, documented at the line.

## Alternatives

Keeping camelCase identifiers quoted in SQL — rejected against the specification's
own table definitions. Drizzle's relational query API for eager loading — rejected:
it needs a second, Drizzle-shaped relation declaration, which would make Drizzle a
source of truth (ADR-0003).
