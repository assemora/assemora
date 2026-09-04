# Resources

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

A model says what is stored. A resource says what editing it is like: this one
declaration feeds Studio's form, REST CRUD, OpenAPI, the SDK and what an agent reads.

## Field names

Field names are checked against the model's columns at compile time. A resource
presents a model; it does not invent data.

```ts
resource(Article, {
  title: text(),
  // @ts-expect-error: `Article` has no column called `subtitle`
  subtitle: text(),
})
```

## Fields left out

A field left out is not editable. That is the whole mechanism for keeping a column
out of a form. There is no second schema saying "hide this".

```ts
// `Article` also has `internalNotes`. It is not listed, so it is not part of
// the form, the API, the SDK or the MCP tool.
export const Articles = resource(Article, {
  title: text().required(),
  body: richText(),
})
```

A read is projected to the declared, non-hidden fields. The model row behind it is
reachable through `Resource.model`, never through `list()`.

```ts
const page = await Articles.list()
page.data[0]                  // { id, title, body }

const row = await Articles.model.find(id)
row.internalNotes             // the column, from the model
```

## Field kinds

There are twenty-four kinds. One declaration per field feeds runtime validation, the
Studio form, OpenAPI, the SDK and MCP. There is never a second schema for a field.

| kind | builder | what it holds |
| --- | --- | --- |
| `text` | `text()` | one line |
| `textarea` | `textarea()` | several lines |
| `richText` | `richText()` | formatted copy |
| `markdown` | `markdown()` | markdown source, stored exactly as written |
| `code` | `code(...languages)` | a program *and* the language it is in |
| `number` | `number()` | any number |
| `integer` | `integer()` | a whole number; `number()` accepts `3.5` |
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

### Text kinds

```ts
title: text()            // one line
excerpt: textarea()      // several lines
body: richText()         // markup a rich-text editor produced
readme: markdown()       // markdown source, stored as written, rendered by nothing here
```

The kind is the only place that says which of the three a string is. A Studio
control and a renderer both need to know.

### Numbers

```ts
price: number()          // accepts 3.5
rank: integer()          // refuses 3.5
```

### Booleans

```ts
featured: toggle()       // the same field as boolean(), named the way Studio shows it
archived: boolean()
```

### Dates and times

```ts
publishedAt: datetime()  // a moment
birthday: date()         // a day
opensAt: time()          // 'HH:MM' on a 24-hour clock, as a string
```

`time()` is a string and not a `Date`. As a `Date`, half past nine is
`1970-01-01T09:30`, and that goes wrong the first time somebody applies a timezone to
it. Minutes only: every stored time is the same width, so it sorts and compares as text.

### Choices

```ts
status: select('draft', 'published')          // one of the list
tags: checkboxes('news', 'release', 'event')  // several of the list, no repeats
```

A `checkboxes` value is a set. A repeated choice is refused rather than stored. Order
is the author's, not the declaration's.

### Colours

```ts
tint: color()            // '#4a5', '#4a5f', '#4a5ed6' or '#4a5ed6ff'
```

Hex and nothing else, for the reason SPEC.md §62 already paid for: a colour that can
carry a `;` carries a stylesheet. No `rgb()`, no `hsl()`, no keywords.

### Addresses

```ts
homepage: url()          // http:// or https://
contact: email()
slug: slug('title')      // derived from `title`; Studio fills it in, and it stays editable
```

### Media

```ts
cover: media()                         // any item in the media library
photo: image()                         // media('image/*')
trailer: video()                       // media('video/*')
brochure: media('application/pdf')     // narrows what the picker offers
```

The stored value is a media id either way. `accept` is an authoring constraint, not a
validation one: what an id points at lives in another table. `describeField` publishes
the `accept` a picker offers.

### Relations

```ts
authorId: relation('authors').required()
categoryId: relation('categories')
```

`relation('authors')` names the resource on the other side. Studio offers a picker over
it, and an agent is told which collection the id belongs to. Nothing checks that the
entry exists: there is no foreign key behind one.

### Documents

```ts
settings: json<{ theme: string }>()   // the type argument is checked by nothing at runtime
```

## Kinds that look like kinds

Some things that look like kinds are not. The stored data would be identical, and the
second name would drift.

```ts
select('a', 'b')     // a radio is a select drawn differently
image()              // media('image/*')
video()              // media('video/*')
media()              // a file is media() itself
relation('users')    // a users field is a relation pointed at the users resource
```

## Modifiers

Every builder carries the same modifiers.

```ts
text().required()
text().searchable()      // free-text search covers this field
text().sortable()
select('draft', 'published').filterable()
text().hidden()          // never serialized and never shown
datetime().readOnly()    // shown, and refused on write
text().label('Title').help('Shown in listings').placeholder('…')
text().agentAccess({ write: false })   // an agent may read it, not change it
```

They chain in any order, and each returns a new builder.

```ts
title: text().label('Title').required().searchable().sortable()
```

### Hidden fields

A hidden field never reaches serialized output, OpenAPI, the SDK or an agent.

```ts
passwordHash: text().hidden()
```

The marker is a literal, not a boolean, so the record type drops the field as well.

```ts
const Users = resource(User, { email: email(), passwordHash: text().hidden() })

const page = await Users.list()
page.data[0].email          // string
// @ts-expect-error: a hidden field is not on the record type
page.data[0].passwordHash
```

### Agent access

`agentAccess` is field-level AI permission (SPEC.md §52), enforced inside the command
path. An agent cannot reach a protected field through generic CRUD.

```ts
views: integer().agentAccess({ write: false })   // an agent reads it, a person edits it
secret: text().agentAccess({ read: false })      // an agent is not shown it at all
```

The default is `{ read: true, write: true }`. A refused write names every offending
field rather than dropping them silently.

## Shaped values

`code`, `link` and `table` store a shape rather than a scalar. The shape is part of the
field, so no reader has to reinvent it.

```ts
code()   // { language: 'sql', source: 'select 1' }
link()   // { type: 'url', url: 'https://…', label?, newTab? }
         // { type: 'entry', entry: { resource: 'articles', id }, label?, newTab? }
table()  // { columns: ['Plan', 'Price'], rows: [['Free', '$0']] }
```

### Code

```ts
snippet: code()               // any language name: 'ts', 'sql', 'objective-c'
query: code('sql')            // the language is fixed
sample: code('ts', 'python')  // offered as options, like a select
```

A `code` value is stored as written. Nothing this repository ships executes it, and
nothing renders it as HTML. Its language name is checked, because it becomes
`language-<name>` in somebody's renderer.

### Links

```ts
cta: link()

// stored as one of the two:
{ type: 'url', url: 'https://example.com', label: 'Read more', newTab: true }
{ type: 'entry', entry: { resource: 'articles', id }, label: 'Read more' }
```

The `type` tag says which of the two it is. Nothing infers the variant from which key
happens to be present. The URL is checked against an allowlist at the field: `http`,
`https`, `mailto`, `tel`. Not at a renderer, because the SDK, an export, a generated
email and an agent reading over MCP all see the stored value. A `javascript:` URL that
only the page component distrusts reaches the reader nobody remembered.

### Tables

```ts
pricing: table()

// stored as:
{ columns: ['Plan', 'Price'], rows: [['Free', '$0'], ['Team', '$20']] }
```

The columns are part of the value, not the schema. An editor adds one without a
deployment. Every cell is a string. A row narrower or wider than the headings is
refused: at most 32 columns and 1000 rows.

## Groups and repeaters

`object()` takes **fields**, not schemas. An inner field carries its own label, help
text and whether it is required, so Studio draws the nested form from the same
descriptor, and the SDK prints the shape instead of `unknown`.

```ts
const author = object({
  name: text().required().label('Full name'),
  site: url(),
})

const sections = array(object({ heading: text().required(), body: richText() }))
```

```ts
export const Pages = resource(Page, {
  title: text().required(),
  author,               // a group: one document under one name
  sections,             // a repeater: an array of groups
})
```

Inside a group, the per-field modifiers are refused rather than accepted and ignored.

```ts
object({ token: text().hidden() })          // refused: hidden() is per field of a resource
object({ score: integer().sortable() })     // refused: sorting addresses a resource field
array(slug('title'))                        // refused: a slug derives from a resource field
```

The full list: `hidden()`, `readOnly()`, `agentAccess()`, `searchable()`, `sortable()`,
`filterable()` and `slug()`. None of them reach inside a value. A group is one document
under one name, so a `hidden()` field nested in one would be published in OpenAPI and
returned by every read. A flag that silently does nothing is worse than one that does
not exist.

## Reads

Reads go through the resource, and always as a page.

```ts
const page = await Articles.list({
  filters: { published: true },
  search: 'assemora',
  sort: '-createdAt',
  page: 1,
  perPage: 20,
})

const one = await Articles.find(id)   // or null
```

That list query is untrusted input. Only fields declared `filterable`, `sortable` or
`searchable` are honoured. The page size is capped by `maxPerPage`.

```ts
await Articles.list({ filters: { body: 'x' } })   // rejected: `body` is not filterable
await Articles.list({ sort: 'slug' })             // rejected: `slug` is not sortable
await Articles.list({ perPage: 10_000 })          // served as `maxPerPage`, 100 by default
```

Studio never loads a whole dataset. Pagination is not optional.

## Writes

Writes go through the Command Bus, and through nothing else.

```ts
await app.commands.execute('entries.create', {
  resource: 'articles',
  data: { title: 'Hello', slug: 'hello', body: '…', published: true },
})

await app.commands.execute('entries.update', { resource: 'articles', id, data: { … } })
await app.commands.execute('entries.delete', { resource: 'articles', id })
```

Three generic commands, addressed by resource name, rather than a generated set per
resource (ADR-0012). That is the shape the MCP tools of SPEC.md §70 already have, so
adding a resource adds no commands to maintain. The write side sits behind a symbol
that is not exported. Bypassing the mutation path is something you would have to set
out to do.

## Options

```ts
resource(Article, fields, {
  name: 'posts',              // defaults to the model's table name
  label: 'Posts',             // defaults to the name, humanized
  group: 'Blog',              // the heading Studio files it under
  icon: 'newspaper',          // a kebab-case name from the set Studio ships
  titleField: 'title',        // the field that names an entry in a picker or a list
  defaultSort: '-createdAt',  // `title` or `-createdAt`
  perPage: 20,
  maxPerPage: 100,
  api: { delete: false },     // SPEC.md §43: create, read, update, delete
})
```

`titleField` has to name a declared field that is not hidden. Unsaid, a picker takes
the first declared field holding text, which depends on the order the fields were
written in.

```ts
resource(Dish, { articleNumber: text(), name: text() })                        // lists read '091'
resource(Dish, { articleNumber: text(), name: text() }, { titleField: 'name' })  // lists read 'Soup'
```

An icon Studio does not know draws the document every resource drew before. A
resource with `api: { delete: false }` offers no delete in Studio, over MCP or in the
generated SDK, not only at `/api`.

## Registration

```ts
export const content = () => module('content').models(Article).resources(Articles)
```

Listing a resource produces its `entries.*` commands, REST CRUD, an OpenAPI path, an
SDK method, a Studio screen and an MCP tool. None of that is configured anywhere.

## Dynamic resources

A dynamic resource stores its definition in the database and its entries as JSONB. A
collection can be created from Studio or by an agent without touching source code
(SPEC.md §37).

```ts
import { dynamicResource, parseDynamicDefinition } from '@assemora/resources'

const collection = dynamicResource(parseDynamicDefinition(definition), {
  id: definitionId,
  perPage: 20,
})
```

The definition is declarative JSON validated against the field registry. An unknown
kind is rejected. **Nothing in a definition is ever executed**: no `eval`, no
`new Function`, no executable strings (SPEC.md §86). It is untrusted data that describes
a form, not code somebody uploaded.

```json
{
  "name": "testimonials",
  "label": "Testimonials",
  "icon": "quote",
  "fields": [
    { "name": "author", "kind": "text", "required": true, "searchable": true },
    { "name": "quote", "kind": "textarea", "required": true },
    { "name": "rating", "kind": "integer", "filterable": true, "sortable": true },
    { "name": "featured", "kind": "boolean", "filterable": true }
  ],
  "api": { "delete": false }
}
```

A field spec carries the same modifiers a builder does, as keys.

```json
{ "name": "kind", "kind": "select", "options": ["dish", "drink"], "filterable": true }
{ "name": "slug", "kind": "slug", "source": "name" }
{ "name": "category", "kind": "relation", "target": "categories" }
{ "name": "photo", "kind": "media", "accept": ["image/*"] }
{ "name": "views", "kind": "integer", "readOnly": true, "agent": { "write": false } }
```

Every kind in the table above can be named in one, including `object` and `array`.

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

A group names the `fields` it holds. A repeater names the `element` one item is.

### Nesting limits

Both are bounded, because nesting is where an untrusted definition gets big.

```ts
import { MAX_FIELDS, MAX_NESTING_DEPTH } from '@assemora/resources'

MAX_NESTING_DEPTH   // 3: array(object({ … })), which is every content model anybody draws
MAX_FIELDS          // 200 in total, nested ones counted
```

Both bounds are stated in the refusal. Neither is a setting: the schema an agent reads
is unrolled to that depth, and it doubles with every level added.

### Sorting a collection

Entries sort by their own columns, not by a key inside the JSONB document. That is the
one deliberate limit.

```json
{ "name": "score", "kind": "number", "sortable": true }
```

`collections.create` refuses that field, naming it, rather than accepting the flag and
ignoring it. `parseDynamicDefinition()` still loads a row written before the rule, so a
collection is not lost to it at boot.

```ts
await collection.list({ sort: '-createdAt' })   // a column of the entry: fine
await collection.list({ sort: '-score' })       // rejected: not a column
```

## Where to look next

- [Commands and queries](06-commands-and-queries.md): the pipeline `entries.*` runs
  through, and how to write one of your own.
- [HTTP and the SDK](09-http-and-the-sdk.md): what `GET /api/articles` does with the
  declarations above.
- `examples/blog/src/resources.ts`: three resources, including a relation picker.
