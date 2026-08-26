# 0003. Drizzle is an internal implementation detail

Status: accepted
Date: 2026-08-26

## Context

Drizzle offers a mature PostgreSQL layer and migration generation. The temptation is
to expose it and skip writing a data layer. But then the product's public API is
defined by someone else's library: its types leak into signatures, its schema
becomes the source of truth, and replacing or upgrading it breaks user code.

## Decision

Drizzle is used only inside `@assemora/database-postgres`. The Assemora public API
never exposes Drizzle types (SPEC.md §6, §10, §32, §125.1, §125.2). Ownership is
enforced mechanically: `scripts/lib/package-graph.ts` permits the `drizzle-orm`
dependency in exactly one package and `pnpm boundaries` verifies it.

## Consequences

- Users never edit the Drizzle schema; it is generated into `.assemora/generated/`
  and treated as internal (SPEC.md §34).
- The `db.raw(...)` escape hatch exists but is advanced API, never the normal path.
- The cost is a data layer of our own, Query AST translation and tests for it.

## Alternatives

Drizzle as the public API — rejected: it contradicts §3.1 and makes adapter
replacement impossible.
