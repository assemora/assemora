# Deploying

```bash
pnpm assemora db:generate --check   # fails when a model change has no migration
pnpm assemora build                 # typecheck, then regenerate OpenAPI and the SDK
pnpm assemora db:migrate            # on the target, before any process serves
pnpm assemora start
```

Four steps, in that order. The rest of this page is what each one relies on.

## The database

PostgreSQL, named by `DATABASE_URL`.

```ts
import { postgres } from '@assemora/database-postgres'

assemora({
  database: postgres({
    url: process.env.DATABASE_URL ?? '',
    schema: 'public', // the default
    pool: { max: 10, idleTimeoutMs: 30_000, connectionTimeoutMs: 5_000 },
  }),
})
```

The pool numbers are yours; `schema` is the only one with a default. Drizzle and `pg`
live inside that package and nowhere else.

## Migrations

Migrations are files you have already reviewed.

```bash
assemora db:generate <name>   # in development, committed with the change
assemora db:migrate           # on deploy
assemora db:status            # which migrations are applied
```

```bash
assemora db:generate --check                        # CI: a model change with no migration fails
NODE_ENV=production assemora db:migrate --force     # a migration that destroys stored data
NODE_ENV=production assemora db:rollback --force    # any rollback
```

Outside development, a destructive migration needs `--force`. So does any rollback.
`NODE_ENV` is the only signal the CLI has. Anything that is not `development` or `test`
is treated as production.

The application does not migrate itself on boot. `applySchema()` in
`@assemora/database-postgres` is what the test suites use. A deployment runs
`db:migrate` as its own step, ahead of the processes that serve traffic.

## Storage

The media library needs somewhere to put bytes, and a deployment says where.

```ts
assemora({ database, modules: [media()] })
// warn  Uploaded files are stored on this process’s own disk
//       root: <project>/storage/media
//       option: media: { root } for another directory, media: { storage } for a bucket
```

That directory is a working development answer. A container replaces it on the next
deploy.

```ts
assemora({ media: { root: './storage/media' } })   // the local driver
assemora({ media: { storage: s3Storage({ … }) } }) // a driver you built
```

```ts
useStorage(localStorage({ root: './storage/media' }))   // outside assemora()
```

Both drivers implement the same interface, and neither names a vendor in a signature.

```ts
import { s3Storage } from '@assemora/media'

const storage = s3Storage({
  bucket: 'assets',
  region: 'auto', // part of the signature; R2 uses `auto`
  endpoint: 'https://<account>.r2.cloudflarestorage.com',
  accessKeyId: process.env.S3_KEY ?? '',
  secretAccessKey: process.env.S3_SECRET ?? '',
  // sessionToken: temporary credentials carry one
  addressing: 'path', // the default; 'virtual-hosted' for AWS S3
  publicUrl: 'https://cdn.example.com', // a CDN or a public bucket
  signedUrlExpiresIn: 3600, // seconds; one hour by default
  logger, // where a refused request is explained
})
```

The S3 driver talks to anything that speaks S3: AWS, Cloudflare R2, MinIO, Backblaze
B2, DigitalOcean Spaces. It uses `fetch` and signs with SigV4 from `node:crypto`. There
is no vendor SDK behind it.

Four things about it are decisions rather than defaults.

Addressing is stated, never inferred from the endpoint.

```ts
addressing: 'path'            // the default; every S3-compatible service understands it
addressing: 'virtual-hosted'  // AWS S3
```

Without `publicUrl`, `url(path)` is a presigned GET URL, and it expires.

```ts
signedUrlExpiresIn: 3600     // the default: one hour
signedUrlExpiresIn: 604_800  // the ceiling: seven days
```

Studio and the REST layer ask as they render, so they are fine. Anything that persists a
URL should use `publicUrl`, or keep the path and ask again.

A refused request is a 502, never the bucket's own status.

```json
{ "error": { "code": "STORAGE_REQUEST_FAILED", "message": "S3 put failed", "details": { "operation": "put" } } }
```

A 403 from S3 means this deployment's credentials are wrong. Repeating it would tell an
authorized caller they are forbidden. The bucket, key, status and S3 error code go to
`logger.error` instead.

An upload claiming `image/svg+xml` or `text/html` is stored as a download.

```text
Content-Type: application/octet-stream
Content-Disposition: attachment
```

An SVG scripts whatever origin renders it. A CDN in front of a bucket is normally a
subdomain of the application. The local driver narrows the type as it serves; the S3
driver narrows on the way in, because an object store answers for itself.

## Security defaults

Under `assemora()`, SPEC.md §85 is configured in one place, and you mostly do not touch it.

```ts
assemora({
  database,
  modules: [auth(), pages(), media()],
  origins: ['https://www.example.com'], // CORS: a list, never `*`
  frontend: {
    root: join(import.meta.dirname, '../app/dist'),
    framedBy: [], // who may frame /preview, beside 'self'
  },
  session: { secure: true, sameSite: 'strict' }, // the defaults, written out
  api: { introspection: 'authenticated' }, // the default
  mcp: { mutations: 'change-set' }, // the default
})
```

Authorization is `policies()`, never `permitAll()`. Core denies by default, and the
umbrella must not be the thing that opens the door. There is no option for it.

CSRF is on. A mutation carrying cookies repeats the CSRF cookie in a header.

```http
POST /api/commands/pages.publish
Cookie: assemora_session=…; assemora_csrf=…
x-csrf-token: …
```

```http
POST /api/commands/pages.publish
Authorization: Bearer <token>        # exempt: a bearer credential was presented
```

The header alone is not the exemption. A header that is not a bearer token leaves the
session cookie doing the authenticating.

`/api/_introspection` requires a credential, unlike `/api/openapi.json` beside it.

```ts
api: { introspection: 'public' }   // the opt-out
```

It answers with the registry itself, and the API Explorer that reads it is behind
Studio's login.

CORS is registered only when `origins` names something.

```ts
origins: ['https://www.example.com', 'http://localhost:5173']   // scheme://host[:port]
origins: ['*']                             // refused at boot, with a sentence saying why
origins: ['https://a.example; img-src *']  // refused: a CSP source list ends at `;`
```

The CSP is the strict one.

```text
frame-ancestors 'none'                          # no frontend
frame-ancestors 'self' https://studio.example   # frontend: { framedBy: ['https://studio.example'] }
img-src 'self' data: blob: https://cdn.example.com   # read off the storage driver
```

`framedBy` is the one line an application has to think about. The builder canvas frames
`/preview`, and nothing else may. `origins` says who may call the API and has no say in
who may frame it. Media behind a bucket or a CDN is added to `img-src` and `media-src`
automatically. Nothing else in the policy moves, and no option widens it by hand.

The session cookie is `httpOnly`, `SameSite=Strict` and `Secure`.

```ts
session: { secure: false }    // the opt-out, in your own source
session: { sameSite: 'lax' }  // for a Studio reached by link
```

`Secure` does not consult `NODE_ENV`. A default decided by an environment variable is
not a default.

Media URLs pass the same policy the library does.

```text
GET /api/media/*   → media.get on the Query Bus, then the bytes
```

An MCP mutation is a proposal.

```ts
mcp: { mutations: 'direct' }   // the opt-out
```

## Rate limits

Rate limits are per-process counters.

```ts
api: { rateLimit: { max: 600, windowMs: 60_000 } }   // the default: 600 requests a minute
mcp: { rateLimit: { max: 120, windowMs: 60_000 } }   // the default: 120 tool calls a minute
```

Both are enforced. `@assemora/http` registers its plugin ahead of every route it mounts;
`@assemora/mcp` counts inside the server. Two instances behind a load balancer give a
caller twice the allowance. A restart forgets everything counted so far. A shared limiter
in front of the processes is how a deployment gets one ceiling.

## Static files

Studio and your frontend are directories of files, served with the headers that decide
what a returning visitor downloads.

```text
GET /preview/assets/index-BRIFoUvp.js
Cache-Control: public, max-age=31536000, immutable

GET /preview/index.html
Cache-Control: no-cache
ETag: "…"
Last-Modified: …

GET /preview/index.html  +  If-None-Match: "…"
304 Not Modified
```

What the bundler fingerprinted is kept for a year. Which files those are is a fact about
where they are, not what they are called.

```ts
frontend: { immutableAssets: 'assets/' }        // the default: where Vite writes what it hashes
frontend: { immutableAssets: '_next/static/' }  // a frontend built by something else
frontend: { immutableAssets: false }            // hand-written files: nothing is immutable
```

It is deliberately not guessed from the name. A hash is written in the same alphabet
English is, so nothing tells `index-BRIFoUvp.js` from `hero-photograph.jpg` by looking.
Guessing wrong pins a file in every cache for a year, beyond what a deploy can reach.

Everything else carries an `ETag`. `no-cache` means "store it and ask first": a second
visit costs a request and gets a 304 with no body. The entry document is always in this
group. Its name never changes, and it names all the others.

Text is compressed.

```text
Accept-Encoding: br, gzip   → Content-Encoding: br
Accept-Encoding: gzip       → Content-Encoding: gzip
```

Text, JSON and SVG are compressed. Fonts and images are sent as they are: they arrived
compressed, and gzip over them makes them slightly larger.

Nothing here is configurable beyond `immutableAssets`, and none of it applies to `/api`.

## Background work

Without a queue, jobs run inside the process that schedules them, awaited.

```text
warn  Jobs run inside the process that schedules them
      effect: a restart loses what is in flight, and a slow job slows the request
      option: jobs: { queue } for a durable queue
```

```ts
import { bullQueue } from '@assemora/queue-bullmq'

const queue = bullQueue({ connection: { url: process.env.REDIS_URL ?? '' } })

assemora({ …, jobs: { queue, worker: () => queue.work({ concurrency: 4 }) } })
```

```ts
// src/worker.ts
await createApp().work()
```

`listen()` serves, `work()` works, and a process that does both calls both. There is no
`assemora worker` command: SPEC.md §77 fixes twenty-two commands, and none is a worker.
See [Jobs](13-jobs.md).

## Environment

The framework reads `PORT` and `HOST` on its own, and nothing else.

```bash
PORT=3000                                          # 3000 when unset
HOST=0.0.0.0                                       # loopback when unset
DATABASE_URL=postgres://user@host:5432/database    # read by your own src/app.ts
NODE_ENV=production                                # read by the CLI alone, for --force
```

Everything else arrives as an option, in your own source, where it can be reviewed.
Secrets never appear in the OpenAPI document or in an MCP schema, and hidden fields
never reach either.

## Health and readiness

Liveness and readiness are two different questions.

```text
GET /api/health   200 { "status": "ok" }      this process is answering
GET /api/ready    200 { "status": "ready" }   booted, and every module started
GET /api/ready    503                         still starting, or a module could not start
```

```json
{
  "error": {
    "code": "NOT_READY",
    "message": "This application booted, but collections did not start, so it is not ready to serve.",
    "details": {
      "notStarted": [{ "module": "collections", "reason": "…", "remedy": "…" }]
    }
  }
}
```

A deployment that cannot tell them apart restarts a process that was only still
starting. `/ready` does not probe the database: the adapter contract has no portable
ping. A module that could not start is not probed either. The boot established it.

An application whose tables are not migrated listens, serves Studio and answers 503
naming the module and what to do. Nothing routes traffic at it. That refusal is
`expected`, so it never reaches your error tracker, however often the probe asks.

## Logging

Logging is structured, one JSON object per line.

```json
{"level":"info","message":"Request completed","requestId":"…","source":"rest","actorType":"user","actorId":"…","method":"POST","path":"/api/commands/pages.publish","status":200,"durationMs":41.2}
```

```ts
assemora({
  logger, // your own; the default writes to the console
  observability: {
    errors: myErrorTracker, // the default logs; nothing is discarded
    slowQueryMs: 200, // the default; `false` switches it off
    slowRequestMs: 1000, // the default; a slower request is logged as a warning
  },
})
```

The S3 driver takes a `logger` too, and that is where a refused request is explained.
The audit log answers the other question: who attempted what, from which source, and how
it ended, including the attempts authorization refused.

## Before you ship

```bash
pnpm assemora db:generate --check   # a model change with no migration fails here
pnpm assemora build                 # typecheck, then regenerate OpenAPI and the SDK
pnpm assemora db:migrate            # on the target
```

```text
Simple REST read       p95 < 100ms   development-class PostgreSQL, excluding WAN latency
Simple CRUD mutation   p95 < 150ms
```

Studio never loads a whole dataset. N+1 relation queries are caught by tests and logs,
not by code review.

## Where to look next

- [Jobs](13-jobs.md) — the queue adapter, the worker process and what it costs to have
  neither.
- [`SPEC.md`](../../SPEC.md) §85 to §89 for the requirements this page implements.
- `packages/media/README.md` for every S3 option and what it signs.
- `packages/assemora/README.md` for the whole default surface in one place.
