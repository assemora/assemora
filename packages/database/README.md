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

## Schema diffing

`diffSchema(before, after)` says what has to happen for one set of table descriptors
to become another (SPEC.md §34). It is pure, it holds no SQL and it knows no dialect:
whether a column can still hold what it held is a property of the types, so the answer
belongs beside the descriptors every adapter already shares.

```ts
// Both sides are descriptors the framework produced: the snapshot of the last
// generated schema, and the model registry as it stands now (ADR-0021).
const diff = diffSchema(snapshot.tables, declaredTables)

if (isDestructive(diff)) {
  for (const change of diff.changes) {
    if (change.destructive) console.warn(describeChange(change)) // "drops column articles.subtitle"
  }
}
```

`SchemaChange` is a discriminated union a generator exhausts with a `switch` and no
default case, so a new kind of change is a compile error everywhere it has to be
handled. Every change carries `before`, `after` or both — enough to write the up and
the down migration without reading the descriptors again — and answers the two risk
questions `isDestructive` and `mayFailOnExistingRows` ask over the whole diff.

The two questions are different ones. `isDestructive` asks whether applying the diff
may lose data no later migration can bring back; `mayFailOnExistingRows` asks whether
a table that already holds rows may refuse it — an `add column ... not null`, a
narrowing that a stored value does not fit, a unique constraint the rows already
break. A model default does not answer the second: defaults are applied by the data
layer on insert and never reach the schema (ADR-0011), so a required column arrives
with nothing to put in the rows that are already there.

**`introspect()` is not a `before`.** A diff is taken against the generated snapshot
rather than the live database (ADR-0021), and today it has to be: `introspect()`
reports `relations: []` and maps an enum column back to the `text` PostgreSQL stores
it as, so comparing it with the registry reports a foreign key added and a
`text -> enum` change for every relation and every enum column, on every run. Drift
against a real database belongs in `assemora db:status`, and needs an introspection
that reads constraints first.

## Workspace dependencies

- `@assemora/schema`
- `@assemora/core`
