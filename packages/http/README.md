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

## Versions

```ts
server
  .version('v1', (api) => {
    api.resource(Articles)
    api.mount(search)
  })
  .version('v2', (api) => {
    api.resource(Articles, { except: ['list'] }).mount(listArticlesV2)
  })
```

answers at `/api/v1/articles` and `/api/v2/articles` (SPEC.md §47). `except` and `only`
name the generated endpoints by operation — `list`, `get`, `create`, `update`,
`delete` — so a version that changed one of them keeps the other four rather than
hand-writing all five. Naming a resource that publishes nothing, or a filter that keeps
none of its endpoints, is refused where it was written.

The callback is synchronous, and its return type says so: an `async` one would publish
nothing, because everything after its first `await` runs once the routes have been
collected. Holding on to the `api` and using it later is refused for the same reason.

A version is a path segment and nothing more: mounting inside one rewrites the route's
path *before* it is described, so the Schema Registry, OpenAPI, the API Explorer and
the generated SDK need no notion of a version — they compose `prefix + path`, and the
path now says which version it belongs to. The descriptor also records `version`, so a
reader can group without parsing a path. To a caller, a version is a base URL:
`createClient({ url: 'https://host/api/v1' })`.

`api.resource(Articles)` takes a resource structurally — a name is the whole address of
the description the registry already holds, so this package still depends on nothing
above it. A version publishes routes and resources and nothing else: commands and
queries belong to the application rather than to a shape of its REST surface, and a
version does not nest.

A version *adds* an address; it cannot take one away. `module('blog').routes(search)`
describes `/search` the moment the application is created (SPEC.md §13), and the Schema
Registry has no way to withdraw a description — so a route that should answer only under
a version is declared inside the version with `api.mount()` rather than on the module.
`api.mountRegistered()` is the other direction: everything the modules declared, also
published under this version.

`server.ready()` refuses to start when the registry describes a route the server does
not serve. That is what keeps `/api/openapi.json`, the API Explorer and the generated
SDK true by construction (SPEC.md §98, §121) — a documented address that answers 404 is
the failure those two sections exist to prevent.

An application that never calls `version()` is unaffected: `mountResources()` publishes
exactly what it always did.

## Workspace dependencies

- `@assemora/schema`
- `@assemora/core`
