# My project

An [Assemora](https://github.com/assemora/assemora) application with a **Next.js**
frontend: one application layer that developers, people and AI agents all reach
through the same commands, and an App Router site that reads it.

## What this starter is for

It answers one question: *I already have a Next.js site — how does Assemora fit?*

Assemora is the application layer and the API. Next.js is the frontend. They are two
processes, and neither is embedded in the other: your pages, your routing and your
components stay yours, and the CMS is something they read over HTTP.

The other starter, `bare`, serves its own frontend with Vite and no framework. Pick
`bare` if you have no site yet and want the smallest possible one. Pick this if you
have Next.js already, or want server components, streaming, ISR and Next's routing.

## The arrangement

```text
                 http://localhost:3000            http://127.0.0.1:4000
   browser ─────▶ Next.js                          Assemora
                 ├── /            your pages ─────▶ GET /api/articles
<!-- assemora:if pages -->
                 ├── /:slug       block trees ────▶ GET /api/queries/pages.get
                 ├── /preview     the canvas ─────▶ GET /api/queries/pages.get
<!-- assemora:end -->
                 ├── /api/*   ───── rewrite ──────▶ the API
                 └── /studio/* ──── rewrite ──────▶ Studio
```

**Two processes, one browser origin.** Next.js is what a browser talks to, and
`next.config.ts` forwards `/api` and `/studio` to the application server. That is not
a stylistic choice — three things need it:

- the session cookie is `httpOnly`, `Secure` and `SameSite=Strict`, so it has to be
  set by the origin that sends it back;
- CSRF is a double-submit cookie, which a page on another origin could not read;
<!-- assemora:if pages -->
- Studio's builder canvas is an iframe pointed at `/preview` **on Studio's own
  origin**, and both ends refuse to talk to anything else. A cross-origin canvas is
  not a configuration option; it is silence.
<!-- assemora:end -->

The application server is not public. Nothing but Next.js needs to reach it.

## Run it

```bash
pnpm install
pnpm dev
```

`pnpm dev` runs both halves; `pnpm dev:api` and `pnpm dev:web` run either one alone,
which is also how a deployment runs them. Open <http://localhost:3000>.

With no `DATABASE_URL` the project runs on an in-memory database — it says so on every
boot, and everything in it disappears when the process restarts.

Because that database is throwaway, the first boot seeds it: one administrator, enough
content to see something, and the read-only token the Next.js half reads with. Both
credentials are **written into `.env`** — as `ASSEMORA_SEED_PASSWORD` and `ASSEMORA_TOKEN` — and neither is printed,
because `pnpm start` hands its output to whatever supervises it. Next.js reads `.env`
when it starts, so restart `pnpm dev:web` after a fresh seed.

When you have a PostgreSQL to point at:

```bash
cp .env.example .env      # then edit DATABASE_URL
pnpm db:generate initial  # writes database/migrations/0001_initial.sql
pnpm db:migrate           # applies it
pnpm seed                 # the first administrator and the frontend token
```

## Seeding, and why it is a separate command

`pnpm start:api` runs `src/server.ts`, and so does a deployment. A seed that ran there
unconditionally would create an administrator on the first boot of a production
database — an account nobody asked for, holding every permission, with whatever
password the starter happened to ship. So `src/server.ts` seeds *only* the in-memory
fallback, and `pnpm seed` is the deliberate act for anything else.

`pnpm seed` takes the password from `ASSEMORA_SEED_PASSWORD` and generates one into
`.env` when the variable is unset. It does nothing at all if the database already has
a user, so running it twice is safe.

## Why the frontend needs a token

A read is denied by default, like every other operation (SPEC.md §50). A visitor
arrives with no session, so a server-rendered page has to say who is asking — and it
asks as an API token that holds `pages.read` and `articles.read` and nothing else. It
lives in the Next.js process; Next only exposes a variable to the browser when its
name begins `NEXT_PUBLIC_`, so it cannot reach one.

The alternative is a public read policy, and it is worth understanding before you
reach for it: `pages.get` accepts `mode=draft`, and a policy rule cannot see a query's
input — so `policy('pages', { read: () => true })` publishes every unpublished draft
in the project along with the pages you meant.

<!-- assemora:if pages -->
`/preview` is the exception. It renders drafts, so it does **not** use that token: it
forwards the cookie of whoever is looking, and the application decides. If they may
not see the draft, neither may the canvas.
<!-- assemora:end -->

## What is in here

```text
src/                      the application — Node, no bundler, no build step
  models/article.ts       what is stored
  resources/articles.ts   what editing it is like
<!-- assemora:if pages -->
  blocks/                 what a block is: its fields and its form
<!-- assemora:end -->
  modules/content.ts      the module that registers them
  app.ts                  the application, un-booted
  seed.ts                 the first administrator, the frontend token, `pnpm seed`
  env.ts                  where a secret goes: .env, never a stream
  server.ts               boot, seed the throwaway database, listen
app/                      the Next.js App Router
<!-- assemora:if pages -->
  blocks/                 what each block looks like: one React view each
  [slug]/page.tsx         a page assembled in the builder
  preview/                what Studio's canvas frames
<!-- assemora:end -->
  lib/assemora.ts         the HTTP client the pages read through
  layout.tsx, page.tsx    ordinary Next.js
  globals.css             what this site looks like — the tokens are the theme's
database/migrations/      generated SQL, reviewed like any other change
assemora.config.ts        how the `assemora` command finds this project
next.config.ts            where the two halves become one origin
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
| `pnpm sdk:generate` | a typed TypeScript client in `app/lib/` |
<!-- assemora:if studio -->
| `/studio` | the form, the list, the filters and the search |
<!-- assemora:end -->
<!-- assemora:if mcp -->
| `POST /api/mcp` | the tools an agent introspects and calls |
<!-- assemora:end -->

## How the frontend fetches

`app/lib/assemora.ts` builds one client with `createClient` from `@assemora/sdk`,
which depends on `@assemora/schema` and nothing else. Records come back typed by the
call site until you generate the real client:

```bash
pnpm sdk:generate     # writes app/lib/sdk.ts from the Schema Registry
```

Then swap two lines in `app/lib/assemora.ts`:

```ts
import { createTypedClient } from './sdk.ts'

export const api = createTypedClient({ url, token })
```

`api.articles.list()` is then typed from the resource declaration, and the hand-written
`Article` type in `app/page.tsx` can go.

<!-- assemora:if pages -->
> **Known limitation.** For a project with pages the generated file does not compile
> today: one input schema emits an array of a union without parentheses, which
> TypeScript rejects (`TS1354`). Parenthesise that one line and the rest is correct.
> This starter therefore ships the generic client rather than the generated one.
<!-- assemora:end -->

<!-- assemora:if studio -->
## Studio

Served at `/studio`, forwarded there by Next.js so it is on the same origin as
everything else and its session cookie and CSRF protection are first-party. Sign in as
the address `pnpm dev` printed, with the password in `.env` under
`ASSEMORA_SEED_PASSWORD`.

Studio has no list of collections, no hand-written form and no list of block types: it
reads the Schema Registry, so it already knows about anything you declare.
<!-- assemora:end -->

## The theme

`app/layout.tsx` links one stylesheet this project does not contain:

```html
<link rel="stylesheet" href="/api/theme.css" />
```

It is generated from the theme document (SPEC.md §62) — the colours, the type scale,
the spacing steps, the container widths — and it arrives through the same `/api`
rewrite as everything else, so the address is relative and there is nothing to
configure. Edit it in Studio's **Design** section, or let an agent propose a change to
it: the tokens are a stored document, so nobody, human or otherwise, is ever writing
global CSS.

`app/globals.css` is what is left over: what a hero, a rich-text block and this
project's own routes look like. It reads the tokens by name — `var(--space-xl)`,
`var(--ink-soft)` — and it is unlayered while the generated stylesheet sits inside
`@layer assemora`, so whatever you write here wins without counting selectors.

<!-- assemora:if pages -->
That stylesheet is also what makes the universal design controls do anything. A block
given `spacingTop: 'xl'` in the builder renders `var(--space-xl)`, and the rules that
spend it are in the generated file rather than in a copy every project maintains.

## Pages

A page is a tree of blocks with stable ids — never a blob of HTML. `src/blocks/` says
what a block *is*; `app/blocks/` says what it looks like.

Those views carry no `'use client'`, which makes them *shared* components: React
renders them on the server for `/:slug`, so a visitor is sent HTML and downloads no
renderer, no registry and no tree — and bundles them for the browser when the builder
canvas imports them. Keep them free of hooks and browser APIs and both stay true.

`/preview` is what the canvas frames. Its server half reads the draft as the editor;
its client half (`app/preview/canvas.tsx`) is the only file here that has to run in a
browser, and it owns the three messages the builder speaks.

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

This project was created without pages, so it has no block tree, no `/preview` and no
`/:slug` route, and `src/` has no `blocks/` directory. Everything else — resources,
REST, OpenAPI, the SDK, Next.js itself — is unaffected, and `app/page.tsx` shows how a
page you write reads a resource.
<!-- assemora:end -->

## Deploying

Two services, from one repository:

```bash
pnpm build       # next build
pnpm start:api   # the application  — set DATABASE_URL, PORT
pnpm start:web   # Next.js          — set ASSEMORA_URL, ASSEMORA_TOKEN
```

Only the Next.js service needs to be reachable from the internet. The rewrites in
`next.config.ts` work in production exactly as they do in development; if you would
rather put a reverse proxy or a CDN in front of both, the arrangement is the same and
the rewrites become redundant.

## Commands

| | |
| --- | --- |
| `pnpm dev` | run both halves |
| `pnpm dev:api` / `pnpm dev:web` | run one of them |
| `pnpm build` | build the Next.js site |
| `pnpm start:api` / `pnpm start:web` | run one of them, built |
| `pnpm seed` | create the first administrator on a real database |
| `pnpm typecheck` | typecheck the whole project, both halves |
| `pnpm sdk:generate` | write the typed client from the Schema Registry |
| `pnpm db:generate [name]` | write a migration for whatever the models changed |
| `pnpm db:migrate` | apply every migration that has not run |
| `pnpm db:rollback` | undo the most recent one |
| `pnpm db:status` | what is applied and what is not |

`pnpm assemora --help` lists the rest: `routes`, `models`, `resources`, `blocks`,
`agents`, `console`, `make:*` and `api:openapi`. Every one of them boots this
project's own application and asks it questions, so they describe what actually runs.
