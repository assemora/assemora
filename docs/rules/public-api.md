# Public API rules

Reference: SPEC.md §3, §9, §10, §126.

- The user-facing API is part of the product. Internal complexity is an acceptable
  price for a simpler public surface — never the reverse.
- A call must read without documentation: `Post.latest()`, `user.delete()`,
  `Post.with('author')`. Not `createQueryBuilder()`, not `executeFindOperation()`.
- No decorators in primary APIs. The DSL is `model()`, `resource()`, `block()`,
  `module()`, `route()`, `command()`, `policy()`.
- Generic machinery stays inside the framework. User code should never need to pass
  type arguments to `model()` or a query method.
- Types are inferred, never hand-written twice. One declaration produces the
  TypeScript type, the runtime validator, the database column, the Studio form,
  the OpenAPI schema, the SDK type and the MCP schema.
- No `any` in public or internal interfaces. Use `unknown` plus validation.
- Implementation types (Drizzle, Fastify, adapter internals) never appear in public
  signatures. Escape hatches such as `db.raw(...)` are separate, explicitly
  advanced API — never the normal path.
- When a decision is contested, use the priority order from SPEC.md §126:
  correctness → security → beautiful public API → readability → type safety →
  schema consistency → agent usability → DX → performance → internal simplicity.
