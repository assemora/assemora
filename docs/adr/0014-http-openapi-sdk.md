# 0014. How one route declaration becomes runtime, documentation and a client

Status: accepted
Date: 2026-08-26

## Context

Phase 5 (SPEC.md §112) has a single criterion: one route declaration must generate
runtime and docs. SPEC.md §121 spells out what "and docs" means — the route must
validate its request, type its handler, serialize its answer, and appear in OpenAPI,
in the API Explorer and in the generated SDK, with no additional schema anywhere.
Four decisions were needed to get there without breaking the boundaries of §8.

## Decision

**Reads travel a Query Bus, writes the Command Bus.** `@assemora/http` may not depend
on `@assemora/resources` (SPEC.md §8), yet the generated CRUD of §43 has to read
content. Core gained the Query Bus that §11 and §15 already name: `resources`
registers `entries.list` and `entries.get`, and the HTTP layer dispatches them by
name exactly as it dispatches `entries.create`. A read is validated and authorized —
§51 gives a policy a `read` rule — and creates no side effects.

**Describing a route is not mounting it.** `module('blog').routes(login)` registers
the description; `server.mount(login)` puts it on a port. A route is documentation
whether or not anything is listening, which is what lets the CLI generate an OpenAPI
document from a project that is not running. Mounting a route that is already
described is therefore not an error, and `mountRegistered()` mounts what the modules
declared.

**The untyped client carries no index signature.** `Client` exposes `resource(name)`
and `request(...)`. An index signature would make `api.articles` possibly `undefined`
under `noUncheckedIndexedAccess`, so the `api.articles.list()` of SPEC.md §48 would
not compile. That shorthand is real at runtime — the client is a proxy — and typed by
the generated file, which declares each resource by name. Generation is where the
sugar comes from, and the generated file is compiled by a test.

**Everything published is built from a snapshot.** `buildOpenApiDocument` and
`generateSdk` accept the registry or plain data. A hidden field is left out of both:
a document and a client are published, and SPEC.md §85 keeps secrets out of what is
published as firmly as out of what is logged.

## Consequences

- `tests/integration/contract.test.ts` is the executable form of §98: it declares one
  route and one resource, then asserts they reached the registry, the OpenAPI
  document, the introspection endpoint and the generated SDK — and compiles the
  generated SDK with `tsc`, because §92 asks that an example actually compile.
- An unexpected failure answers `INTERNAL_ERROR` with nothing of its own message: a
  thrown error can carry a connection string, and a response is published output.
- A handler that returns something its response schema rejects is a 500, not a
  quietly undocumented body.
- CORS is only configured when origins are listed. There is no wildcard path.

## Alternatives

Letting `@assemora/http` import `@assemora/resources` — rejected against §8. Reading
content through the Command Bus — rejected against §15. Generating the SDK from the
OpenAPI document instead of the registry — rejected: the registry is the source
(ADR-0002), and OpenAPI is one of its outputs.
