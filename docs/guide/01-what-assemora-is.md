# What Assemora is

```ts
import { assemora } from 'assemora'
import { auth } from '@assemora/auth'
import { module } from '@assemora/core'
import { boolean, model, string, uuid } from '@assemora/data'
import { postgres } from '@assemora/database-postgres'
import { resource, text, toggle } from '@assemora/resources'

export const Article = model('articles', {
  id: uuid().primary().defaultRandom(),
  title: string(),
  published: boolean().default(false),
})

export const Articles = resource(Article, {
  title: text().required().searchable(),
  published: toggle().filterable(),
})

export default assemora({
  database: postgres({ url: process.env.DATABASE_URL ?? '' }),
  modules: [auth(), module('blog').models(Article).resources(Articles)],
  studio: true,
  mcp: true,
})
```

That is a whole application. One model and one resource, declared once, become all of
this:

| | |
| --- | --- |
| `pnpm assemora db:generate initial` | the migration that creates `articles` |
| `typeof Article.$infer` | the record type, with `published: boolean` |
| `Article.where('published', true)` | a typed query; `where('publsihed', …)` does not compile |
| `GET /api/articles?published=true` | REST, filtered, searched and paginated |
| `GET /api/openapi.json` | the OpenAPI 3.1 document |
| `pnpm assemora sdk:generate` | `api.articles.list({ filters: { published: true } })` |
| `/studio/articles` | the list, the form, the filter and the search box |
| `assemora.entries.create` | the MCP tool an agent calls, with the same schema |

Add a column and every row changes at once. There is no second description of an
article anywhere.

## The mutation path

There is exactly one way to change state, and every caller takes it:

```text
Command Bus → validation → authorization → transaction → handler → revision → events → audit → database
```

```ts
// Studio, REST, the SDK, the CLI and an agent all end up here
await app.commands.execute('entries.create', {
  resource: 'articles',
  data: { title: 'Hello', published: false },
})
```

Studio, REST, the SDK, the CLI and MCP are callers of that bus. None of them has
business logic of its own. So "can an agent do this?" has the same answer as "can this
person do this?", and nobody implements the question twice.

## The three callers

| | Developer | Editor | Agent |
| --- | --- | --- | --- |
| Reads | `Article.where('published', true)` | the Studio list | `assemora.entries.list` |
| Writes | `commands.execute('entries.create', …)` | a form | `assemora.entries.create` |
| Validation | the same schema | the same schema | the same schema |
| Authorization | permissions, then policies | the same | the same |
| History | a revision | a revision | a revision |
| What a write does | writes | writes | proposes a change set a person applies |

An agent's write is the one exception, and it is a stricter one. A mutation tool runs
the command for real inside a transaction, rolls it back, and stores the diff:

```text
assemora.blocks.update  →  { status: 'pending', changes: [{ summary: 'hero — subtitle changed', … }] }
```

Production changes when a person applies that in Studio. `mcp: { mutations: 'direct' }`
is the opt-out.

## Who it is for

- **A developer** who wants an Eloquent-shaped data layer, typed routes and a CMS,
  without a Zod schema, a Drizzle table, a form, an OpenAPI path and an MCP tool that
  all describe the same field.
- **An editor**, who gets Studio: lists, forms, media, a page builder and a revision
  history. None of it is configured. Studio reads the Schema Registry.
- **An AI agent**, which gets every command and query as a tool, and whose writes wait
  for a person.

## What it is not

It is not a headless CMS you integrate with, and not a framework with a CMS bolted on.
The application layer is the product. Studio and MCP are clients of it, built after it,
so the editor can never become the thing that defines the backend.

It is not finished. Nothing is on npm yet and the public API is free to change. What
exists runs: the framework, Studio, and an agent driving the same application over MCP.

## Where to look next

- [Getting started](02-getting-started.md): a project on your machine in five minutes.
- [`SPEC.md`](../../SPEC.md) is the product and architecture source of truth.
  [`docs/adr/`](../adr/) records the decisions already taken and why.
