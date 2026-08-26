# `@assemora/resources`

Resource layer: static and dynamic resources, fields, CRUD commands.

**Implementation phase:** 4 — implemented.

A resource is how a model appears as content. One declaration is what Studio builds
its forms from, what OpenAPI and the SDK are generated from, and what an agent reads
to learn the shape of the project (SPEC.md §35, §120).

```ts
export const Articles = resource(Article, {
  title: text().required().searchable().sortable(),
  slug: slug('title'),
  content: richText(),
  cover: media(),
  status: select('draft', 'published').filterable(),
})

export default module('blog').models(Article).resources(Articles)
```

Field names are checked against the model's columns at compile time: a resource
presents a model, it does not invent data.

Reads go through the resource — `Articles.list({ filters, search, sort, page })`.
Writes go through `entries.create`, `entries.update` and `entries.delete` on the
Command Bus, and through nothing else (SPEC.md §2). A list query is treated as
untrusted input: only fields the resource declared filterable, sortable or
searchable are honoured, and the page size is capped.

A **dynamic resource** stores its definition in the database and its entries as
JSONB, so a collection can be created from Studio or by an agent without touching
source code (SPEC.md §37). The definition is declarative data validated against the
field registry — an unknown field kind is rejected, and nothing in a definition is
ever executed (SPEC.md §86).

## Workspace dependencies

- `@assemora/schema`
- `@assemora/core`
- `@assemora/data`
