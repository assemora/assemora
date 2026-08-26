# Package dependency graph — review before phase 1

SPEC.md §129 requires a short review of the dependency graph before phase 1 begins.
The machine-readable graph lives in `scripts/lib/package-graph.ts`; the check is
`pnpm boundaries`.

## The implemented graph

```text
schema
  ├── core
  │     ├── database ──── data ──┬── resources ──── pages
  │     │                        ├── auth
  │     │                        ├── media
  │     │                        └── revisions
  │     ├── database-postgres (implements database)
  │     ├── http ──── openapi
  │     └── plugin
  ├── sdk
  └── react

audit        → core, data
change-sets  → core, data
mcp          → core
sdk          → schema
cli          → core, data, database-postgres, openapi, sdk, create-assemora

create-assemora — nothing at all
```

`mcp` reaches only `core`: a tool call is a bus call, and the package cannot touch a
database even by accident (ADR-0020). `cli` is the same idea from the other end — it
imports the *application* at runtime through `assemora.config.ts` and asks its
registry and its buses, so it needs no edge to `auth`, `pages`, `media` or `http`
(ADR-0021). `create-assemora` runs through `pnpm create` before anything is
installed, which is why it has no dependencies and why it is the one package whose
published name is not `@assemora/<directory>`.

The direction matches SPEC.md §8. There are no cycles, which `findCycles` verifies
by walking the graph.

## Deliberate constraints

**`schema` depends on nothing, including external packages.** It is the foundation
every other layer reads, client packages (`sdk`, `react`) included. A dependency
here would immediately land in every bundle, so the ban is machine-checked.

**`sdk` and `react` depend on `schema` only.** Both end up in browser builds of user
applications. If `react` started depending on `pages`, it would drag the entire
server layer in through `pages → resources → data → database → core`. Hence a
consequence for phase 7: **block tree and block schema types must live in
`@assemora/schema`, not in `@assemora/pages`.** `pages` owns behaviour — drafts,
publishing, commands; `schema` owns the shape of the data. That is the only way to
satisfy SPEC.md §57 ("do not import React into Core/Page Schema packages") in both
directions.

**Implementation libraries have a single owner.** `drizzle-orm` and `pg` belong to
`database-postgres`, `fastify` to `http`, `react` to `react`. This is a direct
mechanical check of constraints §125.1 and §125.2.

## Three questions the graph does not answer yet

These are not phase 0 defects but decisions that will have to be made on their own
phases. They are recorded here so they do not surface by surprise.

### 1. Policies are needed before the `auth` package exists

SPEC.md §113 requires every CRUD command to pass policies, and §76 requires the same
of MCP tools. Yet `resources` does not depend on `auth`, and neither does `mcp`.

The right answer is almost certainly **dependency inversion**: the Command Bus in
`core` declares an authorization port (an interface that answers "check this actor
against this action and entity"), and `auth` registers an implementation when its
module boots. Then `resources`, `pages` and `mcp` get permission checks without
knowing `auth` exists — and cannot bypass them, because the check sits in the
mutation path itself.

The alternative — adding `resources → auth`, `pages → auth`, `mcp → auth` — makes
`auth` a mandatory dependency of the content packages and contradicts §8.

**This is decided in phase 1**, when the Command Bus is written, not in phase 6. It
shapes `core`.

### 2. Revisions are collected in `core` but live in `revisions`

SPEC.md §14 places revision collection inside the command pipeline, that is, in
`core`. The `revisions` package sits above `data`. The same inversion applies:
`core` declares a port ("record before/after/patch for this command"), `revisions`
implements it and adds listing, comparison and restore.

Without this, either `core` starts depending on `data` (forbidden by §8), or
revisions have to be collected by hand in every handler — and §3.6 ("any content
mutation must be reversible") stops being a guarantee of the path.

### 3. REST CRUD originates in `resources` while routes live in `http`

`http` depends only on `schema` and `core`, and `resources` knows nothing about
`http`. So CRUD route generation (§43) cannot be a direct call from one package into
the other.

The Schema Registry is the link: `resources` registers descriptions, `http` reads
the registry and mounts routes, `openapi` reads the same registry. Hence a
requirement for phase 1: **the Schema Registry lives in `core` and stores
descriptors typed through `schema` only.** If the registry ever needs to import
types from `resources` or `pages`, the dependency direction is broken.

## Changing the graph

Any new edge between packages requires three consistent edits:

1. `dependencies` in the package's `package.json`;
2. `references` in its `tsconfig.build.json`;
3. an entry in `allowedDependencies` in `scripts/lib/package-graph.ts`.

A disagreement between the first two is caught by the `tsconfig-references` rule, and
an undeclared edge by `allowed-dependency`. The checker also reads every `.ts` file
under a package's `src` and requires each `@assemora/*` import to be allowed and
declared, because a workspace hoists packages into a shared `node_modules` and an
undeclared import would otherwise resolve in silence. Changing the list of allowed
edges is an architectural decision and requires an ADR (SPEC.md §105).
