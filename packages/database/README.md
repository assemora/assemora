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

Every relation kind is loaded in batches, `belongsToMany` included: one pass over the
join table and one over the target, however many rows are being loaded for, and the
same again per nested hop. `adapter.diagnostics.scanCount()` counts those passes — one
per table, the way `statementCount()` counts statements on the PostgreSQL adapter — so
an N+1 fails a test rather than waiting for a review (SPEC.md §89). What the two
adapters have to agree the load *means* is settled in
`tests/integration/adapter-conformance.test.ts` (ADR-0013).

A `belongsToMany` arrives ordered by the target's key, ascending, in both adapters. A
join table has no order of its own, so without a stated one the same query answers with
the same rows in different orders and `user.roles[0]` means one thing in a unit test and
another in production. Every other kind carries whatever order its rows came back in;
`order` in the Query AST sorts the rows a query selects, not the rows hanging off them.

## Join tables

`belongsToMany` is the one relation that stores nothing on either table it links: the
pairs live in a third table no model declares (SPEC.md §23). The data layer writes to
it, the DDL creates it and the diff has to notice it arriving — so it is derived once,
here, as an ordinary `TableDescriptor`.

```ts
joinTableDescriptor(User.descriptor, roles, Role.descriptor)
// name:            'roles_users'
// columns:         roleId, userId — both required, neither unique on its own
// uniqueTogether:  [['roleId', 'userId']]
// relations:       a belongsTo per side, so the table is created with real foreign keys
```

The name comes from `through` when the relation declares one, and from the two table
names, sorted, when it does not. The columns are derived the way a `hasMany` foreign
key is — `users` gives `userId` — and `foreignPivotKey` / `relatedPivotKey` name them
where that does not fit. Everything is sorted before it is written down, so both
declarations of a mutual relation describe the *same* table, down to the order of the
columns: `users.roles` and `roles.users` are one join table, not two that disagree.

A relation whose target is its own table has to name both columns, because `userId`
twice is not a link; it is refused with an error that says so.

`withJoinTables(tables)` is the schema those tables really have — the declared ones
plus a join table per `belongsToMany`. It is idempotent, so expanding an expanded
schema adds nothing.

A model declared for a table a relation derives is **refused**, with an error naming
the relation and the table. Only the DDL would ever read such a model: the pivot verbs
of SPEC.md §24 write the two derived columns and nothing else, so a pivot carrying a
surrogate key or a `joinedAt` is a table `attach` cannot fill, and one carrying exactly
the two keys is a second descriptor for a name the adapter already builds. A pivot with
columns of its own is a model like any other — declare it with two `belongsTo`
relations and address it as an ordinary table, rather than pointing `through` at it.

```ts
// Refused: `assemora_user_roles` is derived, and `grantedAt` is a column no verb writes.
roles: belongsToMany(() => Role, { through: 'assemora_user_roles' })
```

`pivotAddress(owner, relation, row)` is how the data layer addresses the table for one
row. It answers with the join table, the two column names and the owner's key value —
enough to write the pivot verbs of SPEC.md §24 as ordinary Query AST, with no
operation and no adapter method of their own.

```ts
const pivot = pivotAddress(User.descriptor, roles, user.toJSON(), Role.descriptor)

// attach
await adapter.execute(
  {
    ...emptyQuery(pivot.table.name, 'insert'),
    data: { [pivot.ownerColumn]: pivot.ownerValue, [pivot.relatedColumn]: roleId },
  },
  { table: pivot.table },
)

// detach
await adapter.execute(
  {
    ...emptyQuery(pivot.table.name, 'delete'),
    where: [
      comparison(pivot.ownerColumn, '=', pivot.ownerValue),
      comparison(pivot.relatedColumn, '=', roleId),
    ],
  },
  { table: pivot.table },
)
```

A join table has no key of its own — the pair is its identity — so its `primaryKey` is
empty and `uniqueTogether` carries the constraint. That is the one thing a generator
has to read that a model table never sets.

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

Both sides are expanded with `withJoinTables` first, so a model that gains a
`belongsToMany` gains a table in the diff and one that loses it loses the table —
`db:generate` writes the join table without knowing what a join table is. The
expansion is idempotent, so a snapshot that already holds one still compares clean.

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
