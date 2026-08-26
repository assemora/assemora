# Architecture rules

Reference: SPEC.md §2, §8, §11–§15, §125.

- Every state-changing operation is a Command. There is exactly one mutation path:
  `Command Bus → validation → authorization → transaction → handler → revision →
  events → audit → database`. No caller may shortcut it — not Studio, not REST,
  not MCP, not the CLI.
- Reads never go through the Command Bus and never cause side effects.
- `@assemora/core` knows nothing about HTTP or the database. If core needs
  something from either, express it as an interface core owns.
- Dependency edges live in `scripts/lib/package-graph.ts`. Adding an edge is an
  architectural decision: update the policy, write an ADR, then write the code.
  `pnpm boundaries` fails the build otherwise.
- Implementation libraries have a single owning package: Drizzle and `pg` belong to
  `@assemora/database-postgres`, Fastify to `@assemora/http`, React to
  `@assemora/react`. They must not appear in any other package's dependencies.
- `@assemora/schema` stays dependency-free. Everything else is built on top of it.
- The Query AST is the stable internal contract between the data layer, database
  adapters, the policy layer and the AI query layer. Nothing may skip it and reach
  for the adapter directly.
- The Schema Registry is the single source for OpenAPI, Studio, SDK and MCP. If a
  subsystem needs schema information, it reads the registry rather than keeping its
  own copy.
- Context (`requestId`, `actor`, `source`) flows through `AsyncLocalStorage`.
  Do not thread it manually through function signatures.
