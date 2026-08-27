# `@assemora/openapi`

OpenAPI 3.1 generation from the Schema Registry.

**Implementation phase:** 5 — implemented.

```ts
server.mount(
  openApiRoute({ registry: app.registry, info: { title: 'Assemora', version: '1.0.0' } }),
  introspectionRoute(app.registry),
)
```

`GET /api/openapi.json` is the document of SPEC.md §44; `GET /api/_introspection` is
everything the API Explorer of §45 shows. Neither is written by hand and neither is
annotated at a call site: a route that exists is a route that is documented.

Hidden fields are left out of the document. It is published, and SPEC.md §85 keeps
secrets out of what is published.

The introspection route requires a credential; the OpenAPI document does not. The
difference is what they answer with: the document describes the API a caller may use,
with the hidden fields already gone, while the snapshot is the registry itself — every
model, every column of the auth schema, every command and query, including the ones
this caller could never reach. An application whose description is meant to be open
says so:

```ts
introspectionRoute(app.registry, { public: true })
```

## Workspace dependencies

- `@assemora/schema`
- `@assemora/core`
- `@assemora/http`
