# 0017. Studio, and the HTTP surface it needs

Status: accepted
Date: 2026-08-26

## Context

Phase 8 (SPEC.md §115) is Studio, in a fixed order: login, navigation, resource CRUD,
media, API Explorer, then pages, builder, revision history, users and the developer
section.

Studio is a React SPA and a client of the application layer (SPEC.md §58). Building it
first required an application for it to be a client *of*, and that immediately exposed
four things the HTTP layer could not yet do. None of them are Studio features; all of
them are gaps that any browser client would have hit.

## Decision

**`apps/playground` is the reference application.** It is a real blog built on the
framework — a model, a resource, three blocks, a hand-written route — composed into
`createApplication` with the in-memory adapter and seeded on boot. Studio is developed
and verified against it. It is also the honest test of SPEC.md §99: if an application
file is not short and readable, the framework has failed, and nothing else in the repo
would have told us.

**A handler may answer with bytes.** `bytes(data, contentType)` marks a response the
adapter sends untouched, skipping the response schema. Routes are schema-first, which
is right for an API and wrong for a file: the media library writes files and nothing
could serve them. The marker names no server library, so a handler still never sees
Fastify.

**A handler may set status, headers and cookies.** `respond(body, { cookies })` wraps a
value the response schema still validates. A session has to reach the browser as a
cookie JavaScript cannot read, and that is an HTTP concern — `@assemora/auth` owns what
a login *means* and must not learn about headers to say so.

**The HTTP layer implements CSRF, and it is the layer that can.** A mutating request
that arrives with cookies and no `Authorization` header is a browser spending an
ambient credential — the one case another site can provoke. Such a request must repeat
the CSRF cookie in a header, which a cross-site caller cannot read. SPEC.md §85 requires
this for Studio session mutations; `@assemora/auth` cannot enforce it, because by the
time an actor exists the request shape is gone.

**Every registered command is an endpoint.** `server.mountCommands()` generates
`POST /commands/<name>` for each command in the registry, with the command's own input
schema as the documented body. This is not a convenience: SPEC.md §14 says Studio, REST,
the SDK, the CLI and MCP are all callers of one bus, and until now only the generated
CRUD routes actually were. Mounting all of them is safe by construction rather than by
care — the bus validates, authorizes, transacts, revises and audits before a handler
sees anything, and authorization denies by default (SPEC.md §12, §50).

**The Studio-facing session and media endpoints are declared by the application.**
`@assemora/auth` and `@assemora/media` may not depend on `@assemora/http` (SPEC.md §8),
so `/auth/login`, `/auth/me` and `/media/*` live in the playground — which is what
SPEC.md §41 shows in its own examples. The playground is therefore the reference
implementation of the contract Studio expects, not merely a demo.

## Consequences

An application that wants Studio must expose those endpoints. That is a contract
carried by a sample rather than by a type, and it is the weakest part of this decision.
If a second application needs the same routes, they should be extracted into a package
that depends on `http` — a new edge, and a new ADR.

`respond()` and `bytes()` are escape hatches, and escape hatches spread. They stay
narrow on purpose: neither can be reached by accident, and a handler that returns a
plain value still behaves exactly as before.
