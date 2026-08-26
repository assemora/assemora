# Testing rules

Reference: SPEC.md §92–§98.

- Every package has unit tests. Test the mechanism, not the placeholder.
- Any public API change ships with: runtime tests, type inference tests, invalid
  usage type tests, and a documentation example that actually compiles.
- Type-level tests live in `*.test-d.ts` and run via `pnpm test:types`. Invalid
  usage is asserted with `@ts-expect-error`, so a regression that makes bad code
  compile fails the suite.
- Areas that require thorough coverage: Query AST, query builder, type inference,
  relations, transactions, Command Bus, policy enforcement, Schema Registry,
  OpenAPI generation, MCP permissions, revision restore, dynamic resources.
- PostgreSQL integration tests run against an isolated test database and cover
  CRUD, transactions, rollback, relations, JSONB, migrations, soft deletes and
  concurrency.
- A new route must appear in the Schema Registry, `/api/openapi.json`, the API
  Explorer and the generated SDK with no extra configuration — that is a contract
  test, not a manual check.
- N+1 relation queries are caught by tests and logs, not by code review.
