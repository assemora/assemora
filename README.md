# Assemora

[![verify](https://github.com/assemora/assemora/actions/workflows/verify.yml/badge.svg)](https://github.com/assemora/assemora/actions/workflows/verify.yml)

A TypeScript framework and CMS where one application layer serves the developer
(TypeScript API), the user (Studio) and the AI agent (MCP).

> Build visually. Extend with TypeScript. Control with AI.

The full specification is [`SPEC.md`](SPEC.md) — the source of truth for product and
architecture. Decisions already taken live in [`docs/adr/`](docs/adr/).

## Status

Early, and honest about it: nothing is published to npm yet and the public API is
still free to change.

All ten phases are complete. `pnpm create assemora demo` writes a project that
already has a database schema, REST CRUD, Studio, OpenAPI, the API Explorer, a typed
SDK and an MCP server — and `tests/integration/v1.test.ts` asserts every one of those
rather than taking them on trust (SPEC.md §124).

The guide is [`docs/guide/`](docs/guide/), and `apps/docs` renders it.

| Package | What it is |
| --- | --- |
| `@assemora/schema` | The primitives every layer reads. No dependencies, ever |
| `@assemora/core` | Command Bus, Query Bus, Schema Registry, events, context |
| `@assemora/database` | The Query AST and the adapter contract |
| `@assemora/data` | `model()`, the column DSL, the query builder, relations |
| `@assemora/database-postgres` | The AST executed. Drizzle lives here and nowhere else |
| `@assemora/resources` | A model as content: fields, filters, generic CRUD |
| `@assemora/http` | `route()`, the Fastify adapter, generated endpoints |
| `@assemora/openapi` | OpenAPI 3.1 and the introspection endpoint |
| `@assemora/sdk` | The typed client, generated from the registry |
| `@assemora/auth` | Users, roles, permissions, policies, tokens, agents |
| `@assemora/pages` | Pages as block trees, and every edit as a command |
| `@assemora/revisions` | History, diff, restore, undo and redo |
| `@assemora/media` | The media library and its storage drivers |
| `@assemora/react` | The renderer a site ships, and the builder canvas runs |
| `@assemora/audit` | What happened, who did it, and how it ended |
| `@assemora/change-sets` | What an agent proposed, previewed and not yet applied |
| `@assemora/mcp` | Every command and query, as a tool, generated from the registry |
| `@assemora/plugin` | A module an npm package ships, and what the registry says it added |
| `@assemora/cli` | The `assemora` executable: generators, migrations, introspection |
| `assemora` | The umbrella: one call assembles all of the above (SPEC.md §9) |
| `create-assemora` | `pnpm create assemora my-project` |

Studio (`apps/studio`) is a client of that layer and holds no list of collections,
no hand-written form and no list of block types: it asks the Schema Registry what
exists and renders that. `apps/playground` is the reference application it is
developed against.

```ts
export const User = model('users', {
  id: uuid().primary().defaultRandom(),
  email: string().unique(),
  active: boolean().default(true),
  posts: hasMany(() => Post, { foreignKey: 'authorId' }),
})

const users = await User.where('active', true).with('posts').latest().take(10)
```

```ts
route.post('/auth/login', {
  body: { email: email(), password: string().min(8) },
  response: { token: string() },
  handler: async ({ body }) => ({ token: await login(body) }),
})
```

That one declaration validates the request, types the handler, serializes the answer,
and appears in the Schema Registry, in `/api/openapi.json`, in the API Explorer and
in the generated SDK — with no second schema anywhere.

One model declaration gives the record type, the column metadata, the query entry
point and the model's scopes. Field names, values, enums and relation names are checked at
compile time, and the builder produces a Query AST rather than touching any
adapter's query API. The same query runs against the in-memory adapter and against
PostgreSQL without changing a character.

Dependency graph review:
[`docs/architecture/package-graph.md`](docs/architecture/package-graph.md).

```ts
export default assemora({
  database: postgres({ url: process.env.DATABASE_URL }),
  modules: [auth(), pages({ blocks }), media(), blog()],
  studio: true,
  api: true,
  mcp: true,
})
```

That is the whole application file. The umbrella is the one package allowed to depend
on everything, because it is the one nothing depends on — and it holds wiring rather
than behaviour, including the routes `auth`, `media` and `mcp` are forbidden to
declare themselves.

An agent reaches the same application through MCP, and every registered command and
query is already a tool — nobody maintains a list. A mutation tool does not mutate:
it previews the command, stores a change set, and hands back the diff. Production
state changes when a person applies it.

```text
assemora.blocks.update  →  { status: 'pending', changes: ['hero — title changed'] }
```

The seven checks of SPEC.md §76 are not reimplemented for agents. A tool call is the
same bus call Studio makes, so it passes the same validation, permissions, policies,
field permissions and audit.

## Requirements

- Node.js 24 LTS
- pnpm 10

## Commands

```bash
pnpm install
pnpm verify        # boundaries + lint + build + typecheck + test + test:types
```

Individual steps: `pnpm boundaries`, `pnpm lint`, `pnpm format`, `pnpm build`,
`pnpm typecheck`, `pnpm test`, `pnpm test:types`.

`pnpm verify` is what CI runs, so a green checkout is a green pull request.

The PostgreSQL suite (`pnpm test:integration`) needs a database. It defaults to
`postgres://<user>@localhost:5432/assemora_test` and skips itself when nothing is
reachable, so a checkout without PostgreSQL still passes `pnpm verify`. Point it
elsewhere with `ASSEMORA_TEST_DATABASE_URL`. CI stands a real PostgreSQL up and sets
`ASSEMORA_REQUIRE_POSTGRES=1`, which turns an unreachable database into a failure
rather than a silent skip.

## Layout

```text
packages/     21 framework packages with fixed boundaries
apps/         studio/, playground/, docs/
starters/     bare — what `create-assemora` writes; nextjs — Assemora behind Next
examples/     blog — relations, scopes, policies; company — the block tree and a theme
docs/         guide/, architecture/, adr/, rules/
scripts/      boundary checker and hooks
```

A generated project needs one process, not two: `assemora()` serves Studio at
`/studio` beside its own API, on one origin, so the session cookie is first-party.
This repository runs them apart because Studio is rebuilt beside the playground.

Two processes are needed to look at Studio:

```bash
pnpm --filter @assemora/playground dev   # the application, on :4000
pnpm --filter @assemora/studio dev       # Studio, on :5173, proxying /api
```

The playground seeds itself on first boot and signs in with `ada@assemora.dev`.

## Package boundaries

Dependency direction is declared in `scripts/lib/package-graph.ts` and enforced by
`pnpm boundaries`. A new edge between packages requires three consistent edits
(`package.json`, `tsconfig.build.json`, the policy) and a new ADR.

## Language

Everything in this repository is written in English — code, comments, documentation
and commit messages.

## Contributing

[`CONTRIBUTING.md`](CONTRIBUTING.md) — how to get set up, and the rules a change is
held to. [`CODE_OF_CONDUCT.md`](CODE_OF_CONDUCT.md) applies everywhere the project
is discussed. Security reports go through [`SECURITY.md`](SECURITY.md), privately.

## License

[Apache-2.0](LICENSE).
