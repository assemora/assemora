# `@assemora/database-postgres`

PostgreSQL adapter: Query AST translation, transactions, migrations (Drizzle inside).

**Implementation phase:** 3 — implemented.

```ts
const adapter = createPostgresAdapter({ url: process.env.DATABASE_URL })
useAdapter(adapter)

await applySchema(adapter, [User.descriptor, Post.descriptor])

const users = await User.where('active', true).with('posts').latest().take(10)
```

Drizzle and `pg` are declared here and nowhere else in the repository, which
`pnpm boundaries` enforces (SPEC.md §8, §125.1). Everything above speaks Query AST.

What the adapter guarantees, and why it is written down in ADR-0011:

- Database identifiers are snake_case; `publishedAt` is stored as `published_at`.
- Relations load in batches — one statement per relation, never one per row. The
  adapter counts statements so the integration suite can prove it (SPEC.md §89).
- Driver errors are translated into Assemora errors, and the failing statement and
  its parameter values never leave the package (SPEC.md §83, §85).
- A nested `transaction()` is a savepoint on the connection already open, so an outer
  rollback undoes the inner writes.
- Neither Drizzle nor `pg` appears in any public signature. Raw statements go through
  the named escape hatch `adapter.raw(...)`.
- `createSchemaSql` derives DDL from the model registry, including foreign keys and
  indexes. Schema *diffing* arrives with the CLI in phase 10.

## Workspace dependencies

- `@assemora/schema`
- `@assemora/core`
- `@assemora/database`
