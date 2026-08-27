# My project

An [Assemora](https://github.com/assemora/assemora) application: one application layer
that developers, people and AI agents all reach through the same commands.

## Run it

```bash
pnpm install
pnpm dev
```

That is enough. With no `DATABASE_URL` the project runs on an in-memory database — it
says so on every boot, and everything in it disappears when the process restarts.

Because that database is throwaway, the first boot seeds it: one administrator and
enough content to see something. The password is generated and written into `.env` as
`ASSEMORA_SEED_PASSWORD` — never printed, because `pnpm start` hands its output to
whatever supervises it.

<!-- assemora:if pages -->
One more command for the site: `pnpm build` writes the bundle served at `/preview`.
Until it has run once that URL is a 404, and the boot log says the bundle is missing.
<!-- assemora:end -->

When you have a PostgreSQL to point at:

```bash
cp .env.example .env      # then edit DATABASE_URL
pnpm db:generate initial  # writes database/migrations/0001_initial.sql
pnpm db:migrate           # applies it
pnpm seed                 # the first administrator — see below
pnpm dev
```

## Seeding, and why it is a separate command

`pnpm start` runs `src/server.ts`, and so does a deployment. A seed that ran there
unconditionally would create an administrator on the first boot of a production
database — an account nobody asked for, holding every permission, with whatever
password the starter happened to ship. So `src/server.ts` seeds *only* the in-memory
fallback, and `pnpm seed` is the deliberate act for anything else.

`pnpm seed` takes the password from `ASSEMORA_SEED_PASSWORD` and generates one into
`.env` when the variable is unset. It does nothing at all if the database already has
a user, so running it twice is safe.

## What is in here

```text
src/
  models/article.ts       what is stored
  resources/articles.ts   what editing it is like
<!-- assemora:if pages -->
  blocks/                 what a block is: its fields and its form
  routes.ts               the one thing a visitor may read without signing in
<!-- assemora:end -->
  modules/content.ts      the module that registers them
  app.ts                  the application, un-booted
  seed.ts                 the first administrator, and `pnpm seed`
  env.ts                  where a secret goes: .env, never a stream
  server.ts               boot, seed the throwaway database, listen
<!-- assemora:if pages -->
app/
  blocks/                 what each block looks like: one React view each
  main.tsx                the public site
  preview.tsx             the document served at /preview, for a visitor and the canvas
<!-- assemora:end -->
database/migrations/      generated SQL, reviewed like any other change
assemora.config.ts        how the `assemora` command finds this project
```

Nothing else is framework plumbing. A second feature is a second module beside
`src/modules/content.ts`, listed in `src/app.ts`.

## What the declarations already gave you

Adding a column to `src/models/article.ts` and a field to `src/resources/articles.ts`
changes all of these at once, with no further configuration:

| | |
| --- | --- |
| `pnpm db:generate` | a PostgreSQL migration for the change |
| `Article.where('published', true)` | typed querying, with the new column in `$infer` |
| `GET/POST/PATCH/DELETE /api/articles` | REST CRUD, filtered, searched and paginated |
| `GET /api/openapi.json` | an OpenAPI 3.1 document |
| `GET /api/_introspection` | the API Explorer's view, for a caller who has signed in |
| `pnpm assemora sdk:generate` | a typed TypeScript client in `src/generated/` |
<!-- assemora:if studio -->
| `/studio` | the form, the list, the filters and the search |
<!-- assemora:end -->
<!-- assemora:if mcp -->
| `POST /api/mcp` | the tools an agent introspects and calls |
<!-- assemora:end -->

<!-- assemora:if studio -->
## Studio

Served at `/studio`, on this same origin, so its session cookie and CSRF protection
work exactly as they do for anything else. Sign in as the address `pnpm dev` printed,
with the password in `.env` under `ASSEMORA_SEED_PASSWORD`.

Studio has no list of collections, no hand-written form and no list of block types: it
reads the Schema Registry, so it already knows about anything you declare.
<!-- assemora:end -->

<!-- assemora:if pages -->
## Pages

A page is a tree of blocks with stable ids — never a blob of HTML. `src/blocks/` says
what a block *is*; `app/blocks/` says what it looks like, and the builder's canvas
renders those very components, so what an editor sees is the site rather than an
imitation of it.

`pnpm build` writes that bundle, and the application serves it at `/preview`. Run
`pnpm build -- --watch` while you are working on a view.

### `/preview` is the site

Opened plainly, `/preview` renders the **published** tree of the page whose slug is
`home` — no session, no query parameter. `/preview?slug=about` is any other page.
Both read `GET /api/site/pages/:slug` from `src/routes.ts`, which is the one thing
this project serves to somebody who is not signed in.

Studio's canvas frames the same document as `/preview?page=<id>&editing=1`, and that
form reads the *draft* through `pages.get` as the signed-in editor. A draft is not
public, which is exactly why the two readers are separate — `app/main.tsx` has both,
a dozen lines apart.

Every builder operation — add, move, nest, duplicate, remove, edit, publish, undo — is
a command, so anything you can do by hand an agent can do through the same call.
<!-- assemora:end -->

<!-- assemora:if mcp -->
## Agents

`POST /api/mcp` is generated from the Schema Registry, so an agent gets a tool for
every resource, page operation and command this project declares — and nothing else.

A mutation is a **proposal**, not a write. An agent previews, a person reads the diff
and applies it, and both halves are recorded in the revision history and the audit log
(SPEC.md §75). `mcp: { mutations: 'direct' }` in `src/app.ts` is the deliberate opt-out.
<!-- assemora:end -->

<!-- assemora:if !pages -->
## No page builder

This project was created without pages, so it has no block tree and no frontend
bundle, and `src/` has no `blocks/` directory. Everything else — resources, REST,
OpenAPI, the SDK — is unaffected.
<!-- assemora:end -->

## Commands

| | |
| --- | --- |
| `pnpm dev` | run the server, restarting when a file changes |
| `pnpm start` | run the server |
| `pnpm seed` | create the first administrator on a real database |
<!-- assemora:if pages -->
| `pnpm build` | build the site bundle |
<!-- assemora:end -->
| `pnpm typecheck` | typecheck the project |
| `pnpm db:generate [name]` | write a migration for whatever the models changed |
| `pnpm db:migrate` | apply every migration that has not run |
| `pnpm db:rollback` | undo the most recent one |
| `pnpm db:status` | what is applied and what is not |

`pnpm assemora --help` lists the rest: `routes`, `models`, `resources`, `blocks`,
`agents`, `console`, `make:*`, `api:openapi` and `sdk:generate`.
