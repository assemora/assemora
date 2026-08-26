# Contributing to Assemora

Thank you for looking. Assemora is early — the public API is still free to change,
and the most useful contributions right now are the ones that find where it is
wrong before it is stable.

Before anything else: [`SPEC.md`](SPEC.md) is the source of truth for product and
architecture. Decisions already taken are in [`docs/adr/`](docs/adr/), and the rules
the code is written under are in [`docs/rules/`](docs/rules/). A change that
contradicts one of those is not automatically wrong, but it needs an ADR rather than
a pull request.

## Getting set up

Node.js 24 and pnpm 10.

```bash
pnpm install
pnpm verify
```

`pnpm verify` is boundaries, lint, build, typecheck, tests and type-level tests —
the same gate CI runs, so a green checkout is a green pull request.

To look at Studio, two processes:

```bash
pnpm --filter @assemora/playground dev   # the application, on :4000
pnpm --filter @assemora/studio dev       # Studio, on :5173, proxying /api
```

The playground seeds itself on first boot and signs in with `ada@assemora.dev`.

The PostgreSQL suite needs a database and skips itself without one:

```bash
pnpm test:integration
```

Point it somewhere with `ASSEMORA_TEST_DATABASE_URL`, and set
`ASSEMORA_REQUIRE_POSTGRES=1` to turn an unreachable database into a failure rather
than a silent skip.

## The rules that are not negotiable

These are not style preferences. A change that breaks one of them will be sent back
however good the rest of it is.

**Every mutation goes through the Command Bus.** There is exactly one mutation path,
and Studio, REST, the SDK, the CLI and MCP are all callers of it. No caller gets its
own business logic and no caller skips policies. If Studio can do it, an agent must
be able to do the same thing through the same command.

**Reads go through the Query Bus.** They never cause side effects.

**Package boundaries are checked by a machine, not by review.** The allowed edges are
declared in [`scripts/lib/package-graph.ts`](scripts/lib/package-graph.ts). Adding
one is an architectural decision: write the ADR, then the code. `pnpm boundaries`
fails the build otherwise.

**Implementation libraries have a single owning package.** Drizzle and `pg` belong to
`@assemora/database-postgres`, Fastify to `@assemora/http`, React to
`@assemora/react`. None of them may appear in another package's dependencies, and
none of them may appear in a public signature.

**One schema declaration feeds everything.** Runtime validation, the database, Studio
forms, OpenAPI, the SDK and MCP all read the Schema Registry. Never write a second
schema for a subsystem.

**No `any`.** Use `unknown` and validate. Local, documented exceptions only, and the
comment has to say why.

**No decorators** in the primary APIs. The DSL is `model()`, `resource()`, `block()`,
`module()`, `route()`, `command()`, `policy()`.

**Pages are a block tree**, never an HTML blob.

**Everything in this repository is written in English** — code, comments,
identifiers, documentation, ADRs, test names and commit messages. No exceptions.

The full list is in [SPEC.md §125](SPEC.md), and the reasoning for each is in
[`docs/rules/`](docs/rules/).

## The public API is the product

Internal complexity is an acceptable price for a simpler public surface. Never the
reverse — and never change a public API merely because it makes the implementation
easier.

A call should read without documentation. `Post.latest()`, `user.delete()`,
`Post.with('author')` — not `createQueryBuilder()`, not `executeFindOperation()`.

When a decision is contested, the priority order is in SPEC.md §126: correctness,
security, a beautiful public API, readability, type safety, schema consistency,
agent usability, developer experience, performance, internal simplicity.

## What a change needs

Any public API change ships with four things:

1. runtime tests
2. type inference tests in `*.test-d.ts`
3. invalid-usage tests, asserted with `@ts-expect-error`, so a regression that makes
   bad code compile fails the suite
4. a documentation example that actually compiles

A new route must appear in the Schema Registry, `/api/openapi.json`, the API
Explorer and the generated SDK with no extra configuration. That is a contract test,
not a manual check.

Areas that need thorough coverage: the Query AST, the query builder, type inference,
relations, transactions, the Command Bus, policy enforcement, the Schema Registry,
OpenAPI generation, MCP permissions, revision restore and dynamic resources.

## Commits and pull requests

One logically complete change per commit. Never mix a refactor, a new feature and a
reformat.

Write the message for someone reading it in a year with no memory of the discussion:
what changed, and why it had to. If a decision was contested, say what the
alternative was and why it lost.

Run `pnpm verify` before you open the pull request.

## Reporting something

- A bug: [open an issue](https://github.com/assemora/assemora/issues/new/choose)
- A security vulnerability: privately, please —
  see [SECURITY.md](SECURITY.md)
- A question about direction: check SPEC.md first; if it does not answer, open an
  issue and say which section you expected to find it in

## Licence

By contributing you agree that your contribution is licensed under
[Apache-2.0](LICENSE), like the rest of the project.
