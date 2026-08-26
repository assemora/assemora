# `@assemora/database`

Abstract database adapter contracts and Query AST execution.

**Implementation phase:** 3 — shipped early, in phase 2.

The Query AST (SPEC.md §30) and the adapter contract (SPEC.md §31) live here. They
are the stable boundary between the data layer, database adapters, the policy layer
and the AI query layer, and nothing in this package is specific to any engine.

```ts
const adapter = createMemoryAdapter({ users: [{ id: 'u1', active: true }] })

await adapter.execute(
  { model: 'users', operation: 'select', where: [comparison('active', '=', true)], order: [], with: [] },
  { table: usersDescriptor },
)
```

The in-memory adapter implements the same contract as `@assemora/database-postgres`,
so a query proven in a unit test runs unchanged against PostgreSQL. It is for tests
and development only — nothing it holds is durable.

## Workspace dependencies

- `@assemora/schema`
- `@assemora/core`
