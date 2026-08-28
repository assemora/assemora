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

Twenty-four of them. One declaration per field feeds runtime validation, the Studio
form, OpenAPI, the SDK and MCP — there is never a second schema for the same field.

| kind | builder | what it holds |
| --- | --- | --- |
| `text` | `text()` | one line |
| `textarea` | `textarea()` | several lines |
| `richText` | `richText()` | formatted copy |
| `markdown` | `markdown()` | markdown source, stored exactly as written |
| `code` | `code(...languages)` | a program *and* the language it is in |
| `number` | `number()` | any number |
| `integer` | `integer()` | a whole number — `number()` accepts `3.5` |
| `boolean` | `boolean()`, `toggle()` | true or false |
| `date` | `date()` | a day |
| `datetime` | `datetime()` | a moment |
| `time` | `time()` | a time of day, carrying no date nobody meant |
| `select` | `select(...values)` | one of a fixed list |
| `checkboxes` | `checkboxes(...values)` | several of a fixed list |
| `color` | `color()` | a colour, as hex in the four lengths CSS accepts |
| `json` | `json<T>()` | a document nothing validates at runtime |
| `slug` | `slug('title')` | a slug derived from another field |
| `url` | `url()` | a URL |
| `link` | `link()` | a URL **or** a reference to an entry |
| `email` | `email()` | an address |
| `media` | `media(...accept)`, `image()`, `video()` | an id from the media library |
| `relation` | `relation('authors')` | an entry of another resource |
| `table` | `table()` | rows of columns the author chose |
| `object` | `object({ … })` | a group of fields, stored as one document |
| `array` | `array(field)` | a repeater of one field |

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

Some things that look like kinds are not, because the stored data would be identical
and the second name would drift: a **radio** is a `select` drawn differently, and
**image**, **video** and **file** are a `media` narrowed by type — `image()` is
`media('image/*')`, and `describeField` publishes the `accept` its picker offers.

### The kinds that hold more than one value

`code`, `link` and `table` store a shape rather than a scalar, and the shape is part of
the field so that no reader has to reinvent it:

```ts
code()   // { language: 'sql', source: 'select 1' }
link()   // { type: 'url', url: 'https://…', label?, newTab? }
         // { type: 'entry', entry: { resource: 'articles', id }, label?, newTab? }
table()  // { columns: ['Plan', 'Price'], rows: [['Free', '$0']] }
```

A `link` carries the tag that says which of the two it is, so nothing has to infer the
variant from which key happens to be present. Its URL is checked against an allowlist —
`http`, `https`, `mailto`, `tel` — at the *field*, not at a renderer, because the SDK,
an export, a generated email and an agent reading over MCP all see the stored value, and
a `javascript:` URL that only the page component knows to distrust is one that reaches
the reader nobody remembered.

A `color` is hex and nothing else, for the reason SPEC.md §62 already paid for: a colour
that can carry a `;` carries a stylesheet. A `code` field is stored as written, executed
by nothing this repository ships, and rendered as HTML by nothing either — but its
language name is checked, because it becomes `language-<name>` in somebody's renderer.

### Groups and repeaters

`object()` takes **fields**, not schemas. That is what makes a group drawable: an inner
field carries its own label, its help text and whether it is required, so Studio builds
the nested form from the same descriptor it builds the outer one from, and the SDK
prints the shape instead of `unknown`.

```ts
const author = object({
  name: text().required().label('Full name'),
  site: url(),
})

const sections = array(object({ heading: text().required(), body: richText() }))
```

Inside a group, the modifiers a resource enforces one field at a time are refused rather
than accepted and ignored: `hidden()`, `readOnly()`, `agentAccess()`, `searchable()`,
`sortable()`, `filterable()`, and `slug()`. None of them reach *inside* a value — a group
is one document under one name — so a `hidden()` field nested in one would be published
in OpenAPI and returned by every read. A flag that silently does nothing is worse than
one that does not exist.

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

Every kind in the table above can be named in one, including `object` and `array`:

```json
{
  "name": "landing",
  "fields": [
    { "name": "tint", "kind": "color" },
    {
      "name": "sections",
      "kind": "array",
      "element": {
        "kind": "object",
        "fields": [{ "name": "heading", "kind": "text", "required": true }]
      }
    }
  ]
}
```

A group names the `fields` it holds and a repeater names the `element` one item is. Both
are bounded, because nesting is where an untrusted definition gets big: **three levels**
deep — `array(object({ … }))`, which is every content model anybody draws — and **200
fields in total**, nested ones counted. Both bounds are stated in the refusal rather than
left to be discovered, and neither is a setting: the schema an agent reads is unrolled to
that depth, and it doubles with every level added.

Its one deliberate limit: entries sort by their own columns, not by a key inside the
JSONB document.

## Where to look next

- [Commands and queries](06-commands-and-queries.md) — the pipeline `entries.*` runs
  through, and how to write one of your own.
- [HTTP and the SDK](09-http-and-the-sdk.md) — what `GET /api/articles` does with the
  declarations above.
- `examples/blog/src/resources.ts` — three resources, including a relation picker.
