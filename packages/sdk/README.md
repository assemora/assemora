# `@assemora/sdk`

Type-safe HTTP client, generated from the Schema Registry.

**Implementation phase:** 5 — implemented.

```ts
const api = createTypedClient({ url, token })

const posts = await api.articles.list({ filters: { status: 'published' } })
const post = await api.articles.get(id)
await api.articles.create({ title: 'Hello' })
```

The runtime is generic and the types are generated, so a resource or a route that
exists is one the SDK can already call (SPEC.md §48, §121). The generated file is
compiled by the contract test, because §92 asks that an example actually compile.

This package depends on `@assemora/schema` and on nothing else, which is what keeps
it safe in a browser bundle. Errors arrive as `SdkError`, carrying the code, status
and field errors of SPEC.md §83 and §84.

## Workspace dependencies

- `@assemora/schema`
