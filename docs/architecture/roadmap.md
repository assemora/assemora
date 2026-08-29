# Packages and phases

Phases are defined by SPEC.md §107–§117. The order must not be changed (§118):
Studio and AI are clients of a stable application layer, not its designers.

| Phase | Scope | Packages |
| --- | --- | --- |
| 0 | Repository foundation | — (infrastructure, done) |
| 1 | Schema primitives and kernel | `schema`, `core` |
| 2 | Assemora Data | `data` |
| 3 | PostgreSQL | `database`, `database-postgres` |
| 4 | Resources | `resources` |
| 5 | HTTP, Schema Registry, OpenAPI, SDK | `http`, `openapi`, `sdk` |
| 6 | Authentication and authorization | `auth` |
| 7 | Pages, blocks, revisions | `pages`, `revisions`, `media` |
| 8 | Studio | `apps/studio` |
| 9 | MCP / AI | `mcp` |
| 10 | CLI, starters, DX | `cli`, `react`, `plugin`, `starters/*`, `examples/*` |

Assignments the SPEC does not state directly:

- `media` is placed in phase 7 with the content layer: the media library is needed by
  resource fields and blocks before Studio exists. §115 shows Studio displaying
  Media, so the backend must already be there.
- `plugin` and `react` are placed in phase 10: both are extension points on top of a
  stabilised core.
- `database` and `database-postgres` split at phase 3, but the adapter contract (§31)
  and the Query AST (§30) shipped in phase 2: SPEC.md §109 asks for queries that run
  against a memory adapter, which is impossible without the contract they run
  through. The Query AST lives in `database` rather than `data` because §8 points
  the dependency that way.

The `apps/`, `starters/` and `examples/` directories are created empty and filled on
their own phases. Until they contain a `package.json`, pnpm ignores them.

## Status

- **Phase 0 — complete.** `pnpm install`, `pnpm build`, `pnpm typecheck`,
  `pnpm test`, `pnpm lint` and `pnpm boundaries` all pass.
- **Phase 1 — complete.** `@assemora/schema` and `@assemora/core`. The three
  questions raised by the dependency graph review are answered: ports in `core`
  (ADR-0008), the Schema Registry in `core`, and module facets (ADR-0009).
- **Phase 2 — complete.** `@assemora/data`, plus the adapter contract and the
  in-memory adapter in `@assemora/database`. The milestone of SPEC.md §130 runs and
  is covered by type-level tests.
- **Phase 3 — complete.** `@assemora/database-postgres`. Integration tests run the
  whole stack against a real PostgreSQL and cover the list of SPEC.md §95.
- **Phase 4 — complete.** `@assemora/resources`. A resource works without Studio,
  through the commands and its own read API, which is what §111 asks for.
- **Phase 5 — complete.** `@assemora/http`, `@assemora/openapi` and `@assemora/sdk`.
  The contract of SPEC.md §98 is a test, and it compiles the generated SDK.
- **Phase 6 — complete.** `@assemora/auth`. Policies are enforced inside the command
  pipeline, so Studio, REST, the SDK, the CLI and an agent get the same answer.
- **Phase 7 — complete.** `@assemora/pages`, `@assemora/revisions`,
  `@assemora/media`. Every builder operation of §60 is a command, and every content
  mutation leaves a revision that can be restored.
- **Phase 8 — complete.** `apps/studio`. Every screen is driven by the Schema
  Registry: Studio holds no list of collections, no hand-written form and no list of
  block types, and the builder canvas runs the application's own renderer.
- **Phase 9 — complete.** `@assemora/mcp`, `@assemora/audit`, `@assemora/change-sets`.
  Every command and query is a tool, a mutation is a proposal until a person applies
  it, and the mandatory scenario of §97 runs over the protocol.
- **Phase 10 — complete.** `@assemora/cli`, `create-assemora`, `assemora`, both
  starters, both examples and the guide. `pnpm create assemora demo` writes a project
  that already has everything §124 promises, and `tests/integration/v1.test.ts`
  asserts it rather than believing it.

The `apps/`, `starters/` and `examples/` directories are no longer empty; every one
of them is a workspace package that CI compiles, which is what stops a starter or an
example from rotting quietly.

## After the phases

The phases described the framework. What follows describes what it is *for*, and it is
not a phase eleven: ADR-0027 settles that Assemora ships mechanisms and a package ships
nouns, so the work is to close the gap between what a project can write in TypeScript and
what a package can declare. `site-kits.md` is the ordered list and `site-kits-design.md` the
long form; both were written from a real site measured against the framework.

The spec also grew five sections it never had — §131 localisation, §132 taxonomy, §133
navigation, §134 forms, §135 singletons (ADR-0025). §135 and §133 are in the site-kit
plan because a package needs them; §132 and §134 are open.

**§131 localisation — the core of it is built** (ADR-0028). Languages are configured on
`assemora()`, a language is a path segment stripped before routing, `model().translatable()`
gives a model one row per language, a read is scoped to the language of the operation and
falls back to the default in one query, and `entries.translate` writes a translation
through the Command Bus like any other change. Left: Studio's language switcher and
translation status, the locale in OpenAPI and the generated SDK, and pages — §131 asks for
a slug and a block tree per locale and that is not built. A collection is not translatable
and says so; ADR-0028 records why.
