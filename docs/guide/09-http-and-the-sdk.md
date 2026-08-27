# HTTP and the SDK

## Declaring a route

```ts
route.post('/auth/login', {
  body: { email: email(), password: string().min(8) },
  response: { token: string() },
  errors: [InvalidCredentials],
  handler: async ({ body }) => ({ token: await login(body) }),
})
```

That one declaration validates the request, types the handler, serializes the answer,
and describes itself in the Schema Registry — which is what OpenAPI, the API Explorer
and the SDK are generated from. There is no second schema anywhere, and no annotation
at a call site.

`route.get`, `route.post`, `route.patch`, `route.put` and `route.delete` take the same
definition: `params`, `query`, `body`, `response`, `status`, `description`, `tags`,
`errors`, `auth` and `source`. Register them on a module:

```ts
module('blog').routes(listArticles, readArticle)
```

Describing a route and mounting it are separate acts, and registration is idempotent.

A handler never sees Fastify. What reaches it is validated input, the application
context and the actor. The adapter's own request object is available as `request` and
is deliberately typed `unknown`, so reaching for it is a decision rather than a habit.

Two narrow escape hatches exist for answers that are not a plain JSON body: `bytes(data,
type)` for binary, and `respond(body, { cookies, headers, status })` for a response that
has to set something. Neither names a server library.

**A route validates its query string; it does not convert it.** Everything in a URL is
text, so a filter is text, and anything numeric has to be read by hand.

## Generated CRUD

Every resource the registry knows gets REST CRUD, with no configuration:

```text
GET    /api/articles       list, filtered, searched, sorted, paginated
GET    /api/articles/:id   one
POST   /api/articles       create
PATCH  /api/articles/:id   update
DELETE /api/articles/:id   delete
```

`?search=`, `?sort=`, `?page=` and `?perPage=` are reserved; every other query
parameter is read as a filter, with `true`, `false`, `null` and numbers coerced from
their text — the field's own schema judges the value a moment later. Only fields the
resource declared filterable, sortable or searchable are honoured.

`@assemora/http` generates all of that **without depending on `@assemora/resources`**:
writes go to the Command Bus, reads to the Query Bus, and the route reads the resource
description out of the registry (ADR-0014). The HTTP layer serves resources without
knowing what a resource is.

## Everything else on the buses

```ts
server
  .mountRegistered()   // routes the modules declared
  .mountResources()    // generated CRUD
  .mountCommands()     // POST /api/commands/<name>
  .mountQueries()      // GET  /api/queries/<name>
```

`mountCommands()` and `mountQueries()` publish *every* registered command and query.
That is safe because the bus validates and authorizes first and authorization denies by
default — not because the list is curated. Query-string values are decoded against the
query's own declared input schema.

## OpenAPI and the API Explorer

```ts
server.mount(
  openApiRoute({ registry: app.registry, info: { title: 'Assemora', version: '1.0.0' } }),
  introspectionRoute(app.registry),
)
```

`GET /api/openapi.json` is an OpenAPI 3.1 document; `GET /api/_introspection` is
everything Studio's API Explorer shows. Neither is written by hand. A route that exists
is a route that is documented, and that is a contract test rather than a manual check.

Hidden fields are left out of both. The document is published, and secrets stay out of
what is published.

The introspection route needs a credential — it hands back the registry itself, every
model and every column of it, and the API Explorer that reads it is behind Studio's
login. `introspectionRoute(app.registry, { public: true })` is the opt-out, and under
`assemora()` it is `api: { introspection: 'public' }`.

## The SDK

```bash
assemora sdk:generate            # writes src/generated/sdk.ts
```

```ts
const api = createTypedClient({ url, token })

const posts = await api.articles.list({ filters: { status: 'published' } })
const post = await api.articles.get(id)
await api.articles.create({ title: 'Hello' })
await api.articles.update(id, { title: 'Better' })
await api.articles.delete(id)
```

The runtime is generic and the **types** are generated, so the generated file is small
and the client is not regenerated because a handler changed. `@assemora/sdk` depends on
`@assemora/schema` and nothing else, which is what keeps it safe in a browser bundle.
The generated file is compiled by a contract test, because a documentation example that
does not compile is worse than none.

Errors arrive as `SdkError`, carrying `code`, `status`, `details`, `fields` and
`requestId` — the error model of SPEC.md §83 and §84, the same one the API returns.

## Cookies, CSRF and CORS

A browser session is a `httpOnly`, `SameSite=Strict`, `Secure` cookie. A **mutating
request that arrives with cookies and no bearer credential** is a browser acting on an
ambient credential — the one case another site can provoke — so it must repeat the CSRF
cookie in a header, which a cross-site caller cannot read and therefore cannot repeat.
That check lives in `@assemora/http` and is on by default under `assemora()`.

The exemption is a `Bearer` token, not the presence of an `Authorization` header: an
actor resolver reads a bearer token and falls through to the session cookie for
anything else, so `Authorization: Basic …` beside a session cookie is still a request
authenticated by the cookie, and is still asked for its CSRF token.

CORS is registered only when you name origins, always as a list, never `*`. `origins`
says who may *call* the API; who may *frame* it is `frontend.framedBy`, and they are
deliberately different permissions.

## One honest gap

A command and a query declare an input schema but no **output** schema, so their
generated endpoints appear in OpenAPI and in the SDK with an undocumented response.
Closing it means adding `output` to `command()` and `query()` and writing one for every
existing handler. Routes are unaffected: `response` is part of `route()` and is what
serializes the answer.

## Where to look next

- [Agents and MCP](10-agents-and-mcp.md) — the third client of the same buses.
- [The CLI](11-the-cli.md) — `api:openapi` and `sdk:generate` as build steps.
- `packages/http/README.md`, `packages/openapi/README.md`, `packages/sdk/README.md`.
