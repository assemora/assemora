# 0013. One Query AST, one meaning, proven by a conformance suite

Status: accepted
Date: 2026-08-26

## Context

SPEC.md §30 calls the Query AST "the internal stable contract between Assemora Data,
the database adapter, the policy layer and the AI query layer". Two adapters
implement it: the in-memory one used by unit tests and `@assemora/database-postgres`
used in production.

A review found they disagreed. `whereJson('meta', 'tags', ['history'])` matched in
memory and never matched in PostgreSQL, because one compared through `String()` and
the other through `jsonb_extract_path_text`. `like` matched case-insensitively in
memory and case-sensitively in SQL. Comparing a whole document to any object matched
every row in memory and nothing in SQL.

That is worse than a bug in one adapter. It means a test written against the memory
adapter proves nothing about production — the fast tests and the real system had
quietly stopped talking about the same thing.

## Decision

**A condition means exactly one thing, and the meaning is written down at the AST.**

- Equality on a JSON path compares values, not their string renderings: structurally
  in memory, as `jsonb` in PostgreSQL. Arrays, objects, `null`, missing keys and
  scalars all behave the same on both sides.
- `like` is case-insensitive in every adapter, because it exists to serve search.
  PostgreSQL therefore emits `ilike`. The operator's declaration says so.
- A pattern match needs a key inside the document; matching a whole document as text
  is refused rather than left to diverge.

**The rule is enforced by a conformance suite, not by care.**
`tests/integration/adapter-conformance.test.ts` seeds identical rows in both
adapters, runs the same `Condition[]` through each, and requires identical results.
Eighteen cases cover the operators, grouping, and the JSON edges that broke.

Any new operator, and any new adapter, arrives with its row in that table.

## Consequences

- A unit test written against the memory adapter is evidence about PostgreSQL again.
- The suite needs a database, so it skips when none is reachable. That is what
  `ASSEMORA_REQUIRE_POSTGRES=1` exists for: in CI it turns an unreachable database
  into a failure instead of a silent pass.
- Adding an operator now costs a conformance case as well as an implementation. That
  is the point.

## Alternatives

Documenting the divergence and letting callers avoid it — rejected: SPEC.md §30 calls
the AST a contract, and a contract two parties read differently is not one.
