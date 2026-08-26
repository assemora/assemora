# Data layer rules

Reference: SPEC.md §16–§34, §119, §130.

- `@assemora/data` is a standalone Eloquent-style layer. Drizzle sits *below* it and
  is invisible from user code.
- The query builder is immutable: every chained call returns a new builder. A query
  object may be `PromiseLike`, but explicit terminals (`.get()`, `.first()`,
  `.paginate()`, …) must remain available.
- The builder produces a framework-neutral Query AST. It must never construct
  Drizzle queries directly.
- Field names, values, scopes and relation paths are compile-time checked.
  `User.where('unknownField', true)` and `Post.with('somethingUnknown')` must be
  TypeScript errors, and there must be a `*.test-d.ts` proving it.
- `typeof Model.$infer` yields the record type. Adding a column changes it without
  any extra declaration.
- Transactions propagate through `AsyncLocalStorage`. A developer never passes `tx`
  by hand.
- Users never edit the generated Drizzle schema. `.assemora/generated/` is internal
  and machine-owned; migrations live in `database/migrations/`.
- Hidden fields (`string().hidden()`) never reach serialized output by default.
- The data layer must not depend on PostgreSQL. Anything PostgreSQL-specific
  belongs in `@assemora/database-postgres`.
