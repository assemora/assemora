# Assemora

A TypeScript framework and CMS where one application layer serves the developer
(TypeScript API), the user (Studio) and the AI agent (MCP).

> Build visually. Extend with TypeScript. Control with AI.

The full specification is [`SPEC.md`](SPEC.md) — the source of truth for product and
architecture. Decisions already taken live in [`docs/adr/`](docs/adr/).

## Status

Phases 0 to 5 are complete: the repository foundation, `@assemora/schema`,
`@assemora/core`, `@assemora/database`, `@assemora/data`,
`@assemora/database-postgres`, `@assemora/resources`, `@assemora/http`,
`@assemora/openapi`, `@assemora/sdk`, `@assemora/auth`, `@assemora/pages`,
`@assemora/revisions` and `@assemora/media`. Next is Studio (SPEC.md §115).

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

## Requirements

- Node.js 24 LTS
- pnpm 10

## Commands

```bash
pnpm install
pnpm verify        # boundaries + lint + build + typecheck + test
```

Individual steps: `pnpm boundaries`, `pnpm lint`, `pnpm format`, `pnpm build`,
`pnpm typecheck`, `pnpm test`, `pnpm test:types`.

The PostgreSQL suite (`pnpm test:integration`) needs a database. It defaults to
`postgres://<user>@localhost:5432/assemora_test` and skips itself when nothing is
reachable, so a checkout without PostgreSQL still passes `pnpm verify`. Point it
elsewhere with `ASSEMORA_TEST_DATABASE_URL`.

## Layout

```text
packages/     17 framework packages with fixed boundaries
apps/         Studio, playground, docs — phases 8 and 10
starters/     nextjs, bare — phase 10
examples/     blog, company — phase 10
docs/         architecture/, adr/
scripts/      boundary checker and hooks
.claude/      rules/, agents/, settings.json
```

## Package boundaries

Dependency direction is declared in `scripts/lib/package-graph.ts` and enforced by
`pnpm boundaries`. A new edge between packages requires three consistent edits
(`package.json`, `tsconfig.build.json`, the policy) and a new ADR.

## Language

Everything in this repository is written in English — code, comments, documentation
and commit messages.
