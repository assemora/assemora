# My project

An [Assemora](https://github.com/assemora/assemora) application: one application layer
that developers, people and AI agents all reach through the same commands.

It is empty. There is no content model in here, because a starter that shipped one
would be choosing what you are building before you do. What you get instead is the
whole application, working, with nothing declared in it — and, below, how to put the
first thing in.

## Run it

```bash
pnpm install
pnpm dev
```

That is enough. With no `DATABASE_URL` the project runs on an in-memory database — it
says so on every boot, and everything in it disappears when the process restarts.

Because that database is throwaway, the first boot seeds it with the one thing that
cannot be made through the application: an administrator, since signing in is how
anything is made at all. The password is generated and written into `.env` as
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

## Make the first thing

<!-- assemora:if studio -->
### A collection, without leaving Studio

Open `/studio`, go to Collections, and make one. Name it, give it fields, save.

A collection is a resource whose definition is stored rather than compiled
(SPEC.md §37), and it is not a lesser one: it gets the Studio list and form, the
`entries.*` commands, `GET/POST/PATCH/DELETE /api/<name>`, an entry in
`/api/openapi.json` and its own MCP tools — the same set the TypeScript resource below
gets, through the same policies, revisions and audit log. Nothing restarts.

Reach for TypeScript instead when the shape needs real columns to query and index, a
relation to another model, or code of its own.

<!-- assemora:end -->
### A resource, in TypeScript

Two generators and one registration:

```bash
pnpm assemora make:model Post        # src/models/post.ts     — what is stored
pnpm assemora make:resource Post     # src/resources/posts.ts — what editing it is like
```

Then name them in `src/modules/content.ts`, which is the module `src/app.ts` already
lists:

```ts
import { module } from '@assemora/core'

import { Post } from '../models/post.ts'
import { Posts } from '../resources/posts.ts'

export const content = () => module('content').models(Post).resources(Posts)
```

On the in-memory database that is the whole of it. Against PostgreSQL, one more pair:

```bash
pnpm db:generate posts
pnpm db:migrate
```

<!-- assemora:if pages -->
### A block, for the page builder

A block type is a TypeScript declaration and Studio cannot make one — the palette is
empty until this project declares its first:

```bash
pnpm assemora make:block hero        # src/blocks/hero.ts
```

Register it in `src/app.ts`, which is what puts it in the palette and nothing else
does:

```ts
import { Hero } from './blocks/hero.ts'

pages({ blocks: [Hero] })
```

Then say what it looks like. That is a React component, it belongs to the site rather
than to the declaration, and it goes in `app/blocks/hero.tsx`:

```tsx
import type { BlockViewProps } from '@assemora/react'

export const HeroView = ({ props }: BlockViewProps<{ readonly title?: string }>) => (
  <header className="hero">
    <h1>{props.title}</h1>
  </header>
)
```

Add it to the registry in `app/main.tsx` — `createBlockRegistry({ hero: HeroView })` —
and run `pnpm build`. The builder canvas renders that very component, so what an editor
sees is the site rather than an imitation of it.

<!-- assemora:end -->
`pnpm assemora --help` lists the other generators: `make:module`, `make:command` and
`make:policy`.

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
  models/                 what is stored — `pnpm assemora make:model` writes here
  resources/              how it is edited — `make:resource`
<!-- assemora:if pages -->
  blocks/                 what a block is — `make:block`
<!-- assemora:end -->
  modules/content.ts      the module your declarations get registered on
<!-- assemora:if pages -->
  routes.ts               the one thing a visitor may read without signing in
<!-- assemora:end -->
  app.ts                  the application, un-booted
  seed.ts                 the first administrator, and `pnpm seed`
  env.ts                  where a secret goes: .env, never a stream
  server.ts               boot, seed the throwaway database, listen
<!-- assemora:if pages -->
app/
  blocks/                 what a block looks like — one React component each
  main.tsx                the public site: the block registry and what an empty one draws
  preview.tsx             the document served at /preview, for a visitor and the canvas
<!-- assemora:end -->
database/migrations/      generated SQL, reviewed like any other change
assemora.config.ts        how the `assemora` command finds this project
```

That is all of it. The empty directories are empty on purpose: SPEC.md §79 fixes that
layout, and they are where the generators write — so where a model goes is something
you can see rather than something you have to be told. Each holds a `.gitkeep`, which
is what git needs to track a directory with nothing in it; delete it once there is
something. `@assemora/data` and `@assemora/resources` are installed for the same
reason the directories are here — the first thing `assemora make:model` writes imports
one of them, and a generator whose output does not resolve is worse than no generator.

A second feature is a second module beside `src/modules/content.ts`, listed in
`src/app.ts`.

## What one declaration gives you

A resource is described once. Adding a field to it changes all of these at once, with
no further configuration:

| | |
| --- | --- |
| `pnpm db:generate` | a PostgreSQL migration for the change |
| `Post.where('published', true)` | typed querying, with the new column in `$infer` |
| `GET/POST/PATCH/DELETE /api/posts` | REST CRUD, filtered, searched and paginated |
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
A collection made in Studio lands in the same Schema Registry, so every row from the
REST paths down is true of it too, and arrives without a restart. The two it does not
get are the first two: its fields are stored as JSON rather than as columns, so there
is no migration to generate and no typed `Post.where(…)` to write against it. That is
the whole of the difference.

## Studio

Served at `/studio`, on this same origin, so its session cookie and CSRF protection
work exactly as they do for anything else. Sign in as the address `pnpm dev` printed,
with the password in `.env` under `ASSEMORA_SEED_PASSWORD`.

Studio has no list of collections, no hand-written form and no list of block types: it
reads the Schema Registry, so it already knows about anything you declare — which is
also why it has so little to show you today.
<!-- assemora:end -->

<!-- assemora:if pages -->
## Pages

A page is a tree of blocks with stable ids — never a blob of HTML. `src/blocks/` says
what a block *is*; `app/blocks/` says what it looks like, and the builder's canvas
renders those very components.

`pnpm build` writes that bundle, and the application serves it at `/preview`. Run
`pnpm build -- --watch` while you are working on a view.

### `/preview` is the site

Opened plainly, `/preview` renders the **published** tree of the page whose slug is
`home` — no session, no query parameter. `/preview?slug=about` is any other page.
Both read `GET /api/site/pages/:slug` from `src/routes.ts`, which is the one thing
this project serves to somebody who is not signed in. Until something is published
there, the page says so; `Nothing` in `app/main.tsx` is that copy, and deleting it is
one edit.

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
An empty project therefore offers an agent very little, and every declaration you add
above widens what it can do without a line of MCP being written.

A mutation is a **proposal**, not a write. An agent previews, a person reads the diff
and applies it, and both halves are recorded in the revision history and the audit log
(SPEC.md §75). `mcp: { mutations: 'direct' }` in `src/app.ts` is the deliberate opt-out.

Connecting one takes a command. An MCP session is somebody, and an anonymous one
reaches every tool with no permissions at all:

```bash
pnpm assemora agents:create "Content agent" \
  --permissions pages.read,blocks.update,changesets.propose \
  --actor <your user id> --write-mcp-json
```

That creates the identity, writes the token into `.env`, and writes the `.mcp.json` a
client reads — which holds no credential of its own, so it is safe to commit. `pnpm
assemora mcp` is what the client then starts: the same tools over stdin and stdout.

<!-- assemora:end -->

<!-- assemora:if !pages -->
## No page builder

This project was created without pages, so it has no block tree and no frontend
bundle. Everything else — resources, collections, REST, OpenAPI, the SDK — is
unaffected.
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

A worked example, if you would rather read one than start from nothing:
`pnpm create assemora my-site --template blog` scaffolds this same project with a
model, a resource, two block types and a published page already in it.
