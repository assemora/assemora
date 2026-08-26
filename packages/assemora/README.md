# assemora

The call SPEC.md §9 writes (ADR-0022).

```ts
// assemora.config.ts
import { auth } from '@assemora/auth'
import { postgres } from '@assemora/database-postgres'
import { media } from '@assemora/media'
import { pages } from '@assemora/pages'
import { assemora } from 'assemora'

import { blog, Hero, Section } from './src/blog.ts'

export const app = assemora({
  database: postgres({ url: process.env.DATABASE_URL }),
  modules: [auth(), pages({ blocks: [Hero, Section] }), media(), blog()],
  studio: true,
  api: true,
  mcp: true,
})

console.log(`listening on ${await app.listen()}`)
```

That is the whole configuration. What it produces:

```text
POST   /api/auth/login       POST   /api/commands/<name>   every registered command
POST   /api/auth/logout      GET    /api/queries/<name>    every registered query
GET    /api/auth/me          GET    /api/articles          every resource, CRUD
GET    /api/media/by-id/:id  GET    /api/articles/:id
GET    /api/media/*          POST   /api/articles
POST   /api/mcp              PATCH  /api/articles/:id
GET    /api/openapi.json     DELETE /api/articles/:id
GET    /api/_introspection   …and every route a module declared with .routes()
GET    /api/health           liveness (SPEC.md §88)
GET    /api/ready            readiness: 503 until the application has booted

GET    /studio, /studio/*    Studio, at the origin root
GET    /preview, /preview/*  this application's frontend, which the canvas frames
```

`auth.login` and `auth.logout` are the two commands that do *not* also appear under
`/api/commands/<name>`: they are publicly authorized, and the routes above are the
hardened way to reach them.

It is the only package allowed to depend on everything, because it is the only one
nothing depends on. A cycle through it is impossible, which is what makes the
exception to SPEC.md §8 safe rather than a hole in it — and `pnpm boundaries` fails on
any edge pointing here, so the property is checked rather than remembered.

## What it owns is the wiring, and nothing else

There is no command here, no model, no policy and no business logic. Every line either
constructs something a package below it exports, or connects two packages that are
forbidden to know about each other:

| Route | The two halves it joins |
| --- | --- |
| `/auth/login`, `/auth/logout`, `/auth/me` | `@assemora/auth` and `@assemora/http` |
| `/media/by-id/:id`, `/media/*` | `@assemora/media` and `@assemora/http` |
| `/mcp` | `@assemora/mcp` and `@assemora/http` |
| `/preview` | the application's own bundle and `@assemora/http` |
| `/health`, `/ready` | the application's lifecycle and `@assemora/http` |

None of those packages may depend on `@assemora/http` (SPEC.md §8), so somebody above
all of them has to declare the endpoints. Before this package that somebody was the
application, and every project would have carried a copy.

## The defaults are the secure ones

`authorization`, `transactions`, `revisions` and `audit` are not options. Authorization
is `policies()` — never `permitAll()`, because core denies by default and the umbrella
must not be the thing that opens the door. An application that wants the blunt answer
writes it in its own source with `createApplication()`, which stays fully supported and
is what every test in this repository does.

The rest of SPEC.md §85, in one place:

- CSRF is on. It is *optional* in `createHttpServer`, and leaving it out turns it off,
  so it is passed unconditionally here.
- CORS is registered only when `origins` names something, always as a list, never `*`.
  Every entry is checked to be `scheme://host[:port]` and nothing else: `*` is refused
  with a sentence saying why, and so is anything carrying a `;` — a CSP source list is
  terminated by one, and an origin is not a place to hide a directive.
- The content security policy is the strict one. `frame-ancestors` is `'none'` unless
  the application serves a `frontend`, and then it is `'self'` plus
  `frontend.framedBy` — the builder canvas frames `/preview`, and nothing else may
  (SPEC.md §59). `origins` says who may *call* this API and has no say in who may
  frame it: they are different permissions, and Studio is the framer.
- The session cookie is `httpOnly`, `SameSite=Strict` and `Secure`. The CSRF cookie is
  the same but readable, because the page has to echo it back in a header. `Secure`
  does not consult `NODE_ENV`: a default decided by an environment variable is not a
  default. `session: { secure: false }` is the opt-out, and it is written in the
  project's own source where it can be seen.
- The media URLs pass the same policy the library does. `GET /api/media/*` runs
  `media.get` on the Query Bus before it fetches a byte, so a `policy('media', …)` an
  application writes covers the files as well as the listing (SPEC.md §51).
- `auth.login` and `auth.logout` are not published under `/api/commands/<name>`.
  Mounting every command is safe because the bus authorizes first and authorization
  denies by default; these two are publicly authorized, so a generic endpoint would be
  a second door on to a session — one handing the token back as readable JSON, minting
  no CSRF token, and letting the caller choose the IP address recorded against it.
- Rate limits: 600 requests a minute, and 120 MCP tool calls a minute. Both are
  per-process counters; two instances behind a load balancer give twice the allowance.
  The MCP ceiling is enforced inside `@assemora/mcp`; the HTTP one is passed to
  `createHttpServer` and is **not currently enforced** — `@assemora/http` registers
  `@fastify/rate-limit` from a promise nothing awaits before routes are added, and the
  plugin only attaches to routes defined after it has loaded. That is a defect of the
  package that owns Fastify, and it is the one line of this list an application cannot
  rely on yet.
- An MCP mutation is a proposal. `mcp: { mutations: 'direct' }` is the deliberate
  opt-out, and it belongs in the project's source rather than in a default.

## A module that is not listed gets no routes

The umbrella adds three modules a developer should not have to list — `revisions`,
`audit`, `changesets` — because without them an application silently throws its history
away and an agent's first write is an unknown command. It adds `mcp()` when `mcp` is
switched on, since that switch is what asks for it.

It adds nothing else. There is no login route without `auth()`, and no media URLs
without `media()`; `studio: true` or `mcp: true` without `auth()` is refused where it
was written, with a sentence saying what to add. A module the application listed itself
always wins, so `auth({ policies: [...] })` is never replaced by a bare `auth()`.

A configuration that cannot work is refused by `assemora()` itself rather than at the
first request: `media()` with nowhere to put the bytes, `media: { root }` with
`api: false` — its URLs would point at routes nobody mounted — Studio and the frontend
asked for at the same path, an MCP proposal with change sets switched off, and an
origin that is not one.

## Studio is loaded, not depended on

`studio: true` imports `@assemora/studio/assets` at run time. A hard dependency would
put a React single-page application into the install of every project that answered
"no" to SPEC.md §78's third question, and Studio lives in `apps/` where the boundary
checker does not reach — an edge it could not police is an edge it should not have. A
project that asks for Studio without installing it gets one sentence naming the package
to add.

The bundle is published with `/studio/` baked into its asset URLs, which is why
`studio: { path }` exists but is almost always the wrong knob to reach for.

## `app`, and `listen()`

```ts
const app = assemora({ … })

app.app       // the Application, un-booted
app.server    // the HttpServer, or undefined when api: false
await app.boot()      // boots once, and mounts what needs a filesystem
await app.listen()    // boots, then serves; answers with the address
await app.shutdown()  // server, then modules, then the database
```

Nothing in `assemora()` is asynchronous, and it returns with the Schema Registry
already complete. That is what lets `export default assemora({…})` be a top-level
statement, and what lets `assemora routes` describe an application without opening a
socket: `assemora.config.ts` hands the CLI `app.app`, which the CLI boots itself
(ADR-0021). `boot()` is separate from `listen()` so that seeding happens between them.

`app.app` carries this handle's lifecycle: `app.app.boot()` *is* `app.boot()`, and so
is the one `listen()` calls. Core refuses a second boot, so two independent boots would
mean the CLI's succeeded and `listen()`'s failed — with Studio and the preview, which
are mounted by this package, missing from the application that did boot. One boot, two
callers. `shutdown()` is the same: every step is attempted even if one throws, because
the database is the last of them and a pool nobody closed outlives its process.

## What it costs

Installing `assemora` installs the framework. A project that wants less keeps
constructing its application by hand.

The other cost is memory: a new package with an HTTP surface has to be remembered here
too, or a generated project silently will not have it. That was accepted in ADR-0022 in
exchange for SPEC.md §9.
