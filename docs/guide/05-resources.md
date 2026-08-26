# Resources

A model says what is stored. A **resource** says what editing it is like. One
declaration is what Studio builds its forms from, what REST CRUD, OpenAPI and the SDK
are generated from, and what an agent reads to learn the shape of the project.

```ts
import { datetime, resource, richText, slug, text, toggle } from '@assemora/resources'

import { Article } from '../models/article.ts'

export const Articles = resource(
  Article,
  {
    title: text().required().searchable().sortable().label('Title'),
    /** Studio fills this in from the title, and still lets it be edited. */
    slug: slug('title').label('Slug'),
    body: richText().required().label('Body'),
    published: toggle().filterable().label('Published'),
    createdAt: datetime().readOnly().sortable().label('Created'),
  },
  { label: 'Articles', defaultSort: '-createdAt', perPage: 20 },
)
```

Field names are checked against the model's columns at compile time. A resource
presents a model; it does not invent data.

## A field left out is not editable

That is the whole mechanism for keeping a column out of a form. There is no second
schema saying "hide this" — the resource lists what a person works with, and anything
absent from the list is simply not part of the editing surface. A read is projected to
the resource's declared, non-hidden fields, and the model row behind it is reachable
through `Resource.model`, never through `list()`.

## The field kinds

`text`, `textarea`, `richText`, `number`, `boolean`, `toggle`, `select`, `date`,
`datetime`, `email`, `url`, `slug`, `media`, `relation`, `json`, `array` and `object`.
Every one of them returns a builder carrying the same modifiers:

```ts
text().required()
text().searchable()      // free-text search covers this field
text().sortable()
select('draft', 'published').filterable()
text().hidden()          // never serialized and never shown
datetime().readOnly()
text().label('Title').help('Shown in listings').placeholder('…')
text().agentAccess({ write: false })   // an agent may read it, not change it
```

`slug('title')` derives from another field. `relation('authors')` names the resource on
the other side, so Studio offers a picker over it and an agent is told which collection
the id belongs to. `agentAccess` is field-level AI permission (SPEC.md §52), enforced
inside the command path — an agent cannot reach a protected field through generic CRUD.

## Reading and writing are different doors

**Reads go through the resource**, and always as a page:

```ts
const page = await Articles.list({
  filters: { published: true },
  search: 'assemora',
  sort: '-createdAt',
  page: 1,
  perPage: 20,
})
```

That list query is treated as untrusted input. Only fields the resource declared
`filterable`, `sortable` or `searchable` are honoured, and the page size is capped by
`maxPerPage`. Studio never loads a whole dataset; pagination is not optional.

**Writes go through the Command Bus**, and through nothing else:

```ts
await app.commands.execute('entries.create', {
  resource: 'articles',
  data: { title: 'Hello', slug: 'hello', body: '…', published: true },
})

await app.commands.execute('entries.update', { resource: 'articles', id, data: { … } })
await app.commands.execute('entries.delete', { resource: 'articles', id })
```

Three generic commands, addressed by resource name, rather than a generated command set
per resource (ADR-0012). That is the shape the MCP tools of SPEC.md §70 already have,
and it means adding a resource adds no commands to maintain. The resource's write side
sits behind a symbol that is deliberately not exported, so bypassing the mutation path
is something you would have to set out to do.

## Registering it

```ts
export const content = () => module('content').models(Article).resources(Articles)
```

Listing a resource is what produces the `entries.*` commands for it, REST CRUD, an
OpenAPI path, an SDK method, a Studio screen and an MCP tool. None of that is
configured anywhere.

## Dynamic resources

A **dynamic resource** stores its definition in the database and its entries as JSONB,
so a collection can be created from Studio or by an agent without touching source code
(SPEC.md §37):

```ts
const collection = dynamicResource(definition, { id: definitionId, perPage: 20 })
```

The definition is declarative JSON validated against the field registry. An unknown
field kind is rejected, and **nothing in a definition is ever executed** — no `eval`,
no `new Function`, no executable strings (SPEC.md §86). A dynamic resource is untrusted
data that describes a form, not code somebody uploaded.

Its one deliberate limit: entries sort by their own columns, not by a key inside the
JSONB document.

## Where to look next

- [Commands and queries](06-commands-and-queries.md) — the pipeline `entries.*` runs
  through, and how to write one of your own.
- [HTTP and the SDK](09-http-and-the-sdk.md) — what `GET /api/articles` does with the
  declarations above.
- `examples/blog/src/resources.ts` — three resources, including a relation picker.
