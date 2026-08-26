# 0021. The CLI is a client of the application, not a second one

Status: accepted
Date: 2026-08-26

## Context

SPEC.md §77 lists twenty-two commands for the `assemora` executable, and they fall
into four unrelated jobs: run the project, scaffold files into it, move its database
forward, and tell the developer what it contains. SPEC.md §78 adds `create-assemora`
as the primary way a project starts. SPEC.md §79 fixes the generated layout, and
SPEC.md §124 makes `pnpm create assemora demo` the first line of the Definition of
Done for v1.

Three questions had to be answered before any of it could be written.

**Where does the CLI get the application?** `assemora routes`, `assemora models`,
`assemora blocks`, `assemora agents`, `assemora api:openapi` and `assemora
sdk:generate` all describe an application that the CLI did not build. The obvious
route — depend on every feature package and construct one — would give
`@assemora/cli` an edge to `auth`, `pages`, `media`, `resources`, `http` and `mcp`,
making it the one package that depends on everything and the one place a cycle could
start.

**What is `assemora.config.ts`?** SPEC.md §79 puts it in the generated project and
says nothing about what it holds.

**Where does the starter live?** `create-assemora` has to be able to write it while
published to npm, and CI has to be able to prove it still compiles.

## Decision

**The CLI imports the project's application at runtime and reads its registry.** It
never imports a feature package. `assemora.config.ts` hands back an `Application`;
the CLI boots it and asks it questions — `app.registry` for routes, models,
resources and blocks, and `app.queries.execute('auth.agents.list', …)` for the
agents. Listing agents therefore goes through the Query Bus, is authorized, and is
audited, exactly as it would be from Studio or from an agent. The CLI is one more
client of the application layer, which is the architecture SPEC.md §2 describes and
not a special case carved out for a terminal.

The dependency list of `@assemora/cli` stays as phase 0 declared it — `schema`,
`core`, `data`, `database-postgres`, `openapi`, `sdk` — plus `create-assemora`. The
first six are the packages whose *functions* it calls; every other capability
arrives as an already-constructed object through the config.

**`defineConfig` lives in `@assemora/cli`.** The config exists for the CLI and for
nothing else, and putting its type in `@assemora/core` would mean core knew what a
migrations directory is. The convention is familiar from every other tool a
developer already has in the project.

**`create-assemora` is dependency-free and unscoped.** `pnpm create assemora
my-project` resolves to the unscoped package `create-assemora`, so that is the name
it carries — the first package in the repository whose name is not
`@assemora/<directory>`, and `scripts/lib/package-graph.ts` now records that
explicitly rather than letting the checker be surprised. It runs before anything is
installed, so a dependency of its own would have to be fetched first: it writes
files and does nothing else, which is what lets it have none.

**`starters/bare` is the template, and it is a workspace package.** A starter that
does not compile is the worst possible first impression, so the one CI typechecks
and the one `create-assemora` copies are the same directory. In the workspace the
scaffolder resolves it by walking up from its own module URL; when published it
reads `templates/`, which a prepack step copies from `starters/` and which is never
edited by hand. `assemora new` calls the same function rather than growing a second
scaffolder.

**Schema diffing splits along the dialect line.** `diffSchema()` in
`@assemora/database` compares two sets of table descriptors and produces a
dialect-neutral list of changes; `migrationSql()` in `@assemora/database-postgres`
turns those into SQL. The CLI orchestrates: it reads the snapshot in
`.assemora/generated/`, diffs it against the live model registry, writes
`database/migrations/`, and updates the snapshot. Nothing about PostgreSQL reaches
the CLI, and nothing about SQL reaches `@assemora/database`.

The snapshot is what a diff is taken against, rather than the live database.
Generation is then deterministic and works offline, which is what makes a migration
reviewable in a pull request — and `assemora db:status` is where drift against a
real database is reported.

## Consequences

- An application that cannot be constructed cannot be introspected. `assemora
  routes` boots the app, which means it also opens a database connection. That is
  the honest cost of describing the real application rather than a parse of its
  source.
- `assemora agents` is subject to policies. Running it as nobody lists nothing,
  which is correct and will surprise somebody at least once.
- A destructive migration is generated with a warning attached, and applying one
  outside development requires `--force` (SPEC.md §34). The generator refuses a type
  change it cannot cast safely rather than emitting SQL that silently corrupts a
  column.
- The CLI cannot scaffold a project that uses a package it does not know about,
  because `make:*` writes source files against declared APIs. That is a template
  problem, not an architecture problem.

## Alternatives

**A CLI that parses the project's TypeScript** — rejected. It would need a second
implementation of what a model, a resource and a block are, and the Schema Registry
exists so that no subsystem keeps its own copy (ADR-0002).

**A CLI that depends on every package** — rejected. It inverts the dependency graph
of SPEC.md §8 at the one point where a cycle is most likely, and it would make the
CLI's install cost the whole framework whether or not the project uses it.

**Diffing against the live database** — rejected as the default. Generation would
require a reachable database, produce different output for two developers whose
databases had drifted, and make a migration impossible to write on a plane. It
belongs in `db:status`, where the question actually is "does the database match".

**Templates embedded as strings in `create-assemora`** — rejected. Nothing would
typecheck them, and the first broken starter would ship silently.
