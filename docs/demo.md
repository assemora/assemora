# The public demo

`examples/company` served publicly, from the `Dockerfile` at the repository root. It is
the same example `pnpm demo` runs locally, with three deployment facts added and nothing
in the application changed.

The project's own site is not here. `assemora.com` lives in its own repository and
depends on the published packages rather than on this checkout, which is the more
honest arrangement: it is an Assemora project like any other, and it proves the packages
work by being one.

## What makes publishing an administrator's password reasonable

The demo signs everybody in as the same administrator, and the password is printed on
the page that links to it. That is safe for exactly one reason: **the database is in
memory**. `DATABASE_URL` is never set, so `src/app.ts` falls back to the memory adapter,
`src/server.ts` seeds it on every boot, and a restart is a clean site. Nothing a visitor
does outlives the process.

Two things follow, and both are deliberate:

- Vandalism heals on restart rather than being prevented. Restart on a schedule and the
  worst case is bounded by the interval.
- `media()` is not among the example's modules, so there is no upload endpoint. The demo
  cannot be used to host a file, which is the abuse that would otherwise outlive a reset.

Setting `DATABASE_URL` moves the demo onto PostgreSQL and the reset that makes the
published password reasonable stops happening. Don't.

### It says who to sign in as

A public demo whose front door is a password field is a closed door: a visitor arrives,
finds a form, and has no way to know what to type. Set `ASSEMORA_DEMO=1` and the site
carries a strip saying the address and the password, with a link to Studio.

`GET /api/site/demo` is what it reads, and it answers only when **both** are true: the
deployment opted in with that variable, and it is running on the in-memory database.
This file is an example people copy, and a route that hands out a password must be
impossible to turn on by accident — with a real `DATABASE_URL` it is a 404.

Studio's own sign-in screen still says nothing. It has no unauthenticated source to
read a notice from, and giving it one is a change to the authentication surface rather
than a demo's to make — so a visitor who types `/studio` directly still arrives at a
bare form. The address handed out should be the site.

## It must be served over HTTPS

`session: { secure: true }` is the default (`packages/assemora/src/options.ts`), so the
session and CSRF cookies carry `Secure` and a browser will not send them back over plain
`http`. On a plain-http address the sign-in form accepts the password and the next
request arrives with no session — a failure that looks like a wrong password and is not.

Terminate TLS in front of the container. Do not set `session: { secure: false }` to work
around it: the demo would then hand out session cookies in cleartext, and the umbrella
warns about exactly that on boot.

## Environment

| Variable | Value | Why |
| --- | --- | --- |
| `ASSEMORA_SEED_PASSWORD` | the password the demo publishes | The image refuses to start without it. Unset, `src/seed.ts` generates 144 bits and writes them to a `.env` inside the container — an administrator nobody can sign in as |
| `HOST` | `0.0.0.0` | Set in the image. The umbrella binds loopback otherwise (ADR-0022), which a reverse proxy cannot reach |
| `PORT` | `3000` | Set in the image |
| `DATABASE_URL` | **unset** | See above |

The container binds every interface, and says otherwise: `src/server.ts` prints
`listening on http://127.0.0.1:3000` whatever `HOST` said, so read that line as a label
rather than as the bind address.

## Build and run

```bash
docker build -t assemora-demo .
docker run --rm -p 3000:3000 -e ASSEMORA_SEED_PASSWORD=<the published password> assemora-demo
```

The build installs and compiles only what the example depends on. Installing all 35
workspace projects pulls in the Next.js starter, the docs app and the site, and on a
small server that is killed part-way through `pnpm install` at exit 137 — the kernel,
not the tool.

## What a visitor sees

- `/` — the site. `mountRedirect` points the origin root at the frontend when one is
  mounted, so the address handed out in a post is the site rather than a 404 or a login
- `/studio` — Studio, signed in as the seeded administrator
- `/api/openapi.json` — the document, generated from the Schema Registry
- `/api/site/pages/home` — the published block tree over the public route
