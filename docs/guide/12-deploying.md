# Deploying

## The database

PostgreSQL, named by `DATABASE_URL`:

```ts
const url = process.env.DATABASE_URL ?? ''

assemora({ database: postgres({ url }), … })
```

`postgres()` takes a `url`, an optional `schema` (default `public`) and pool settings
(`max`, `idleTimeoutMs`, `connectionTimeoutMs`). Drizzle and `pg` live inside that
package and nowhere else; nothing above it knows they exist.

Migrations are files you have already reviewed:

```bash
assemora db:generate <name>   # in development, committed with the change
assemora db:migrate           # on deploy
assemora db:status            # what is applied, and drift
```

`db:generate --check` in CI fails the build when a model change has no migration
beside it. Outside development, a migration that changes or destroys stored data needs
`--force`, and so does any rollback — `NODE_ENV` is the only signal the CLI has, so
anything that is not `development` or `test` is treated as production.

**The application does not migrate itself on boot.** `applySchema()` exists in
`@assemora/database-postgres` and is what the test suites use to stand a schema up from
the model registry; a deployment runs `db:migrate` as its own step, ahead of the
processes that will serve traffic.

## Storage

The media library needs somewhere to put bytes. Under `assemora()`, saying nothing gets
the local driver pointed at the project's own `storage/media`, with one warning saying
so — a working development answer, and a directory a container replaces on the next
deploy. A deployment says where the bytes really go. Both drivers SPEC.md §63 makes
mandatory implement the same interface, and neither names a vendor in a signature:

```ts
useStorage(localStorage({ root: './storage/media' }))
```

```ts
useStorage(
  s3Storage({
    bucket: 'assets',
    region: 'auto',
    endpoint: 'https://<account>.r2.cloudflarestorage.com',
    accessKeyId: S3_KEY,
    secretAccessKey: S3_SECRET,
  }),
)
```

The S3 driver talks to anything that speaks S3 — AWS, Cloudflare R2, MinIO, Backblaze
B2, DigitalOcean Spaces — over `fetch`, signing with SigV4 computed from `node:crypto`.
There is no vendor SDK behind it.

Four things about it are decisions rather than defaults:

- **`addressing` defaults to `'path'`** and is stated, never inferred from the endpoint.
  Path style is what every S3-compatible service understands. Set
  `addressing: 'virtual-hosted'` for AWS S3.
- **Without `publicUrl`, `url(path)` returns a presigned GET URL** that expires
  (`signedUrlExpiresIn`, one hour by default, seven days at most). Studio and the REST
  layer ask for it as they render, so they are fine. Anything that *persists* a URL — a
  cached response, a static build, an exported document — should use `publicUrl` or keep
  the path and ask again.
- **A refused request becomes a 502**, never the bucket's own status, and its payload
  carries `{ operation }` and nothing else. A 403 from S3 means this deployment's
  credentials are wrong, and repeating it would tell a perfectly authorized caller they
  are forbidden. The bucket, key, status and S3 error code go to `logger.error` instead.
- **An upload claiming `image/svg+xml` or `text/html` is stored as
  `application/octet-stream` with `Content-Disposition: attachment`.** An SVG scripts
  whatever origin renders it, and a CDN in front of a bucket is normally a subdomain of
  the application.

The local driver reaches the same answers, but narrows the type as it *serves*; the S3
driver narrows on the way *in*, because by the time an object store answers for itself
the application is no longer in the request path.

## The security defaults

Under `assemora()`, SPEC.md §85 is configured in one place and you mostly do not touch
it:

- **Authorization is `policies()`.** Never `permitAll()` — core denies by default and
  the umbrella must not be the thing that opens the door.
- **CSRF is on.** It is optional in `createHttpServer` and leaving it out turns it off,
  so the umbrella passes it unconditionally. A mutation carrying cookies is exempt only
  when it also carries a `Bearer` credential — the header alone is not the exemption,
  because a header that is not a bearer token leaves the session cookie doing the
  authenticating.
- **`/api/_introspection` requires a credential**, unlike `/openapi.json` beside it: it
  answers with the registry itself, and the API Explorer that reads it is behind
  Studio's login. `api: { introspection: 'public' }` is the opt-out.
- **CORS is registered only when `origins` names something**, always as a list, never
  `*`. Every entry is checked to be `scheme://host[:port]`; `*` is refused with a
  sentence saying why, and so is anything carrying a `;` — a CSP source list is
  terminated by one, and an origin is not a place to hide a directive.
- **The CSP is the strict one.** `frame-ancestors` is `'none'` unless the application
  serves a `frontend`, and then it is `'self'` plus `frontend.framedBy`. That is the one
  line an application has to think about: the builder canvas frames `/preview`, and
  nothing else may. `origins` says who may *call* the API and has no say in who may
  frame it.
- **The session cookie is `httpOnly`, `SameSite=Strict` and `Secure`.** `Secure` does
  not consult `NODE_ENV`: a default decided by an environment variable is not a default.
  `session: { secure: false }` is the opt-out, and it is written in your own source.
- **Media URLs pass the same policy the library does.** `GET /api/media/*` runs
  `media.get` on the Query Bus before it fetches a byte.
- **An MCP mutation is a proposal.** `mcp: { mutations: 'direct' }` is the opt-out.

### What the rate limits actually count

Rate limits are 600 requests a minute and 120 MCP tool calls a minute. Both are
enforced — the HTTP one by `@assemora/http`, which registers its plugin ahead of every
route it mounts, and the MCP one inside `@assemora/mcp` — and `api: { rateLimit }` and
`mcp: { rateLimit }` set them.

Both are **per-process counters**, and that is the part to plan around: two instances
behind a load balancer give a caller twice the allowance, and a restart forgets
everything counted so far. A shared limiter in front of the processes is how a
deployment gets one ceiling rather than one per replica.

Images are the other thing worth knowing about the policy above: when media is stored
in a bucket or behind a CDN, that origin is added to `img-src` and `media-src`
automatically, read off the storage driver you configured. Nothing else in the policy
moves, and there is no option that widens it by hand.

## Background work

An application that declares a job and configures no queue runs its jobs inside the
process that schedules them, awaited, and says so once on boot. That is a real answer
for a small deployment; it is not a durable one, because a restart loses whatever was
in flight and a slow job slows the request that scheduled it.

```ts
const queue = bullQueue({ connection: { url: process.env.REDIS_URL ?? '' } })

assemora({ …, jobs: { queue, worker: () => queue.work({ concurrency: 4 }) } })
```

The worker is a second process, running the same application:

```ts
// src/worker.ts
await createApp().work()
```

`listen()` serves, `work()` works, and a process that does both calls both. There is no
`assemora worker` command — SPEC.md §77 fixes twenty-two of them and none is a worker.
See [Jobs](13-jobs.md) for the whole of it.

## Environment

The framework reads exactly two variables on its own:

```bash
DATABASE_URL=postgres://user@host:5432/database
PORT=3000                 # 3000 when unset
```

Everything else arrives as an option, in your own source, where it can be reviewed.
Secrets never appear in the OpenAPI document or in an MCP schema, and hidden fields
never reach either.

## Health and readiness

```text
GET /api/health   liveness: this process is answering
GET /api/ready    readiness: 503 until the application has booted
```

They are two different questions, and a deployment that cannot tell them apart restarts
a process that was only still starting. `/ready` does **not** probe the database: the
adapter contract has no portable ping, and a readiness check that lies about what it
verified is worse than one that says what it means.

## Logging and observability

Logging is structured. Every entry carries what the pipeline knew: `requestId`,
`actorType`, `actorId`, `command`, `entityType`, `entityId`, `duration`. Pass your own
logger as `logger` — the S3 driver takes one too, and that is where a refused request is
explained.

The audit log answers the other question: who attempted what, from which source, and how
it ended, including the attempts authorization refused.

## Before you ship

```bash
pnpm assemora db:generate --check   # a model change with no migration fails here
pnpm assemora build                 # typecheck, then regenerate OpenAPI and the SDK
pnpm assemora db:migrate            # on the target
```

The performance targets to hold yourself to, on a development-class PostgreSQL: a
simple REST read under 100ms at p95, a simple CRUD mutation under 150ms, excluding WAN
latency. Studio never loads a whole dataset — pagination is mandatory — and N+1 relation
queries are caught by tests and logs rather than by code review.

## Where to look next

- [Jobs](13-jobs.md) — the queue adapter, the worker process and what it costs to have
  neither.
- [`SPEC.md`](../../SPEC.md) §85 to §89 for the requirements this page implements.
- `packages/media/README.md` for every S3 option and what it signs.
- `packages/assemora/README.md` for the whole default surface in one place.
