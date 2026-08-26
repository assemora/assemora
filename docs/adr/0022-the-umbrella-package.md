# 0022. `assemora()` is a package, and it is the top of the graph

Status: accepted
Date: 2026-08-26

## Context

SPEC.md §9 is titled "Target user-facing API" and says outright that it is the
reference against which architectural decisions are made. Its last block is
application configuration:

```ts
export default assemora({
  database: postgres(),
  modules: [auth(), pages(), media(), blog()],
  studio: true,
  api: true,
  mcp: true,
})
```

Nine phases in, that call does not exist. What an application actually writes is
`apps/playground/src/main.ts`: roughly a hundred lines that register an adapter and a
storage driver, construct an application with four ports, list seven modules of which
three are infrastructure the developer did not ask for, build an HTTP server with
CORS, CSRF, rate limits and a content security policy, call five `mount*` methods,
and then hand-declare the login route, the `/auth/me` route, the media URLs, the MCP
endpoint and the preview route — because `@assemora/auth`, `@assemora/media` and
`@assemora/mcp` may not depend on `@assemora/http` (SPEC.md §8), so somebody above
all of them has to connect the two halves.

That "somebody" has been the application itself since phase 6, and it was recorded as
a known gap rather than a design. Phase 10 is "CLI + starters + DX" (SPEC.md §117),
and the Definition of Done for v1 (SPEC.md §124) requires a created project to have
Studio, REST, OpenAPI, the API Explorer, the SDK and MCP working with no further
configuration. A starter that opens with a hundred lines of wiring does not meet it,
and copying those hundred lines into every generated project would make them the
framework's real public API.

## Decision

**A new package, `assemora`, assembles the others.** It is the only package allowed
to depend on everything, because it is the only package nothing depends on. A cycle
through it is therefore impossible, which is what makes the exception safe rather
than a hole in SPEC.md §8. `scripts/lib/package-graph.ts` records it as a *terminal*
package and `pnpm boundaries` fails on any edge pointing at it, so the property is
machine-checked rather than remembered.

It is published as `assemora`, unscoped. `import { assemora } from 'assemora'` is the
line §9 writes, and `@assemora/assemora` is not that line. It is the second package
whose name is not `@assemora/<directory>`, after `create-assemora`, and the mechanism
for that already exists.

**What it owns is the wiring, and nothing else.** It contains no business logic, no
command, no model and no policy. Every line in it either constructs something a
package below it exports, or connects two packages that are forbidden to know about
each other — the login route over the auth commands, the media URL over the storage
driver, the MCP endpoint over the buses. If a decision belongs to a feature, it stays
in that feature's package; the umbrella only decides *defaults*.

**Studio is loaded dynamically, not depended on.** `studio: true` imports
`@assemora/studio/assets` at runtime and serves it through `server.mountAssets()`. A
hard dependency would put a React single-page application into the install of every
project that answered "no" to SPEC.md §78's third question, and `@assemora/studio`
lives in `apps/` where the boundary checker does not reach — an edge it could not
police is an edge it should not have. A project that asks for Studio without
installing it gets one clear sentence saying which package to add.

**The defaults are the secure ones.** Authorization is `policies()`, never
`permitAll()`. CSRF is on. CORS is a list, never a wildcard. The content security
policy is the strict one, and `frameAncestors` is set to the Studio origin because
the builder canvas frames `/preview` and nothing else may (SPEC.md §59, §85). An
application overrides any of them explicitly, which is the point: the blunt choice is
visible in the source of the project rather than hidden in the framework.

## Consequences

- `apps/playground/src/main.ts` becomes a short file, and the routes it used to
  declare by hand move into the umbrella where they are written once. The playground
  keeps its own custom routes, which is what it is for.
- The gap recorded at the end of phase 8 — "`/auth/login`, `/auth/me` and the media
  URLs are declared by the application" — is closed. They are declared by the
  package whose job is to know about both sides.
- Installing `assemora` installs the whole framework. A project that wants less
  keeps constructing its application by hand, which stays fully supported and is what
  every test in this repository does.
- The umbrella is where a new capability has to be remembered. Adding a package with
  an HTTP surface means adding it here too, or a generated project silently will not
  have it. That is a real maintenance cost, accepted in exchange for §9.

## Alternatives

**Leave the wiring in the starter template** — rejected. The template would become
the framework's real public API, unversioned and uncorrectable: every project ever
generated would carry a frozen copy, and a security default fixed in the framework
would not reach any of them.

**Put `assemora()` in `@assemora/core`** — rejected outright. Core must not import
HTTP, the database, Studio or MCP (SPEC.md §8, §125), and this call needs all four.

**Make the CLI construct the application** — rejected. ADR-0021 turns on the CLI
importing the project's application rather than building one; reversing that would
give `@assemora/cli` the same edges and put them in the package a developer runs
rather than the one they deploy.
