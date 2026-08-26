# Getting started

```bash
pnpm create assemora my-project
```

It asks four questions, and every one of them has a flag that answers it:

```text
Project name          my-project
Database URL          postgres://localhost:5432/my_project
Include Studio?       (Y/n)
Include Pages?        (Y/n)
Include MCP?          (Y/n)
```

`--database`, `--no-studio`, `--no-pages`, `--no-mcp`, and `--yes` answers all of
them. When stdin is not a terminal nothing is asked at all: the defaults are taken and
printed, because a scaffolder that blocks waiting for an answer nobody can type is a
scaffolder that hangs a build.

> **Today this stops one step short.** None of the `@assemora` packages are on npm
> yet, so `pnpm install` in a generated project has nothing to fetch. The command says
> so in as many words. Until the first release, run a project from a checkout of the
> framework — `starters/bare` and `examples/` in this repository are real workspace
> packages, and they are what the rest of this guide is written against.

## The first five minutes

```bash
cd my-project
pnpm install
pnpm dev
```

That is enough to see something. With no `DATABASE_URL` the project runs on an
in-memory adapter: everything works and nothing survives a restart. It announces that
on every single boot, which is the bargain — an in-memory database is honest only
while it is saying so.

The first boot seeds one administrator and prints the password it used, then tells you
where everything is:

```text
listening on http://127.0.0.1:3000
  api      http://127.0.0.1:3000/api
  studio   http://127.0.0.1:3000/studio
  site     http://127.0.0.1:3000/preview
```

When you have a PostgreSQL to point at:

```bash
cp .env.example .env      # then edit DATABASE_URL
pnpm db:generate initial  # writes database/migrations/0001_initial.sql
pnpm db:migrate           # applies it
pnpm dev
```

## What you get without configuring anything

The project ships one model and one resource. Adding a column to the model and a field
to the resource changes all of this at once:

| | |
| --- | --- |
| `pnpm db:generate` | a PostgreSQL migration for the change |
| `Article.where('published', true)` | typed querying, with the new column in `$infer` |
| `GET/POST/PATCH/DELETE /api/articles` | REST CRUD, filtered, searched and paginated |
| `GET /api/openapi.json` | an OpenAPI 3.1 document |
| `GET /api/_introspection` | the API Explorer's view of this application |
| `pnpm assemora sdk:generate` | a typed TypeScript client |
| `/studio` | the list, the form, the filters and the search |
| `POST /api/mcp` | the tools an agent introspects and calls |

## What is in the project

```text
src/
  models/article.ts       what is stored
  resources/articles.ts   what editing it is like
  blocks/                 what a block is: its fields and its form
  modules/content.ts      the module that registers them
  app.ts                  the application, un-booted
  server.ts               boot, seed, listen
app/
  blocks/                 what each block looks like: one React view each
  main.tsx                the public site
  preview.tsx             the document Studio's canvas frames
database/migrations/      generated SQL, reviewed like any other change
assemora.config.ts        how the `assemora` command finds this project
```

Nothing else is framework plumbing. A second feature is a second module beside
`src/modules/content.ts`, listed in `src/app.ts`.

## The whole application, in one call

`src/app.ts` is the only file that assembles anything:

```ts
/** A real database when there is one, and a loud fallback when there is not. */
const database = (): DatabaseAdapter => {
  const url = process.env.DATABASE_URL

  if (url !== undefined && url !== '') return postgres({ url })

  console.warn('DATABASE_URL is not set: this project is running on an in-memory database…')

  return createMemoryAdapter()
}

export const createApp = (): AssemoraApplication =>
  assemora({
    database: database(),
    modules: [auth(), pages({ blocks: [Hero, RichText] }), content()],
    project: { name: manifest.name, version: manifest.version },
    studio: true,
    mcp: true,
    frontend: { root: join(import.meta.dirname, '../app/dist') },
  })
```

The guard around `DATABASE_URL` is not ceremony: `postgres()` takes `url?: string`, and
this project compiles with `exactOptionalPropertyTypes`, so `process.env.DATABASE_URL`
cannot be handed straight to it.

Three things about that call are worth knowing before you change it.

**It returns an application that has not been booted.** Two callers need one and
neither should get the other's: `src/server.ts`, which serves it, and
`assemora.config.ts`, through which the `assemora` command boots it to describe the
*real* application rather than a parse of your source. Booting and listening are
separate calls so that seeding can happen between them.

**Policies, revisions, the audit log and change sets are not options.** Authorization
denies by default and the umbrella never opts out of it, because an application
without a history silently throws one away and an application that permits everything
is not one you can later make strict. `permitAll()` exists, and it lives in
`createApplication()` where you have to write it yourself.

**Studio is served at `/studio` on the same origin as the API.** That is what makes
the session cookie and the CSRF token first-party. It is loaded at run time from
`@assemora/studio` rather than depended on, so a project that answered "no" to Studio
does not install a React application it will never serve.

## Where to look next

- [Models](03-models.md) — the declaration everything else is derived from.
- `starters/bare/` in this repository is the project the scaffolder writes, with every
  decision commented in place.
- `examples/blog/` and `examples/company/` are the two shapes that starter leaves out:
  relations, scopes and policies in one; the block tree, nesting and a theme in the
  other.
