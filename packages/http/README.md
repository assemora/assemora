# `@assemora/http`

HTTP layer and route DSL (Fastify inside, never exposed).

**Implementation phase:** 5 — implemented.

```ts
route.post('/auth/login', {
  body: { email: email(), password: string().min(8) },
  response: { token: string() },
  errors: [InvalidCredentials],
  handler: async ({ body }) => ({ token: await login(body) }),
})
```

One declaration validates the request, types the handler, serializes the answer and
describes itself in the Schema Registry — which is what OpenAPI, the API Explorer and
the SDK are generated from (SPEC.md §41, §121).

A handler never sees Fastify. What reaches it is validated input, the application
context and the actor; the adapter's own request object is available as `request` and
is deliberately typed `unknown` (SPEC.md §40).

REST CRUD is generated for every resource the registry knows, without this package
depending on `@assemora/resources`: writes go to the Command Bus and reads to the
Query Bus (ADR-0014).

## Workspace dependencies

- `@assemora/schema`
- `@assemora/core`
