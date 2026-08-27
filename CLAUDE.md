# Assemora — working rules for Claude Code

You are developing **Assemora**: a TypeScript framework and CMS where the same
application layer is driven by developers (TypeScript API), humans (Studio) and
AI agents (MCP).

`SPEC.md` in the repository root is the product and architecture source of truth.
Read it before changing anything architectural. `docs/adr/` records decisions that
have already been made — do not reverse one without writing a new ADR.

## Current state

- **Phase 0 (repository foundation) — done.** Workspace, package boundaries,
  TypeScript, Vitest, Biome, boundary checker, ADRs.
- **Phase 1 (`@assemora/schema` + `@assemora/core`) — done.** Schema primitives with
  inference, the kernel, and the single mutation path of SPEC.md §14.
- **Phase 2 (`@assemora/data`) — done.** `model()`, the column DSL, the query
  builder, the Query AST, model instances, scopes and relations. The adapter
  contract and an in-memory adapter were pulled forward into `@assemora/database`,
  because SPEC.md §109 requires queries that actually run.
- **Phase 3 (`@assemora/database-postgres`) — done.** Query AST → Drizzle,
  transactions, JSONB, batched relation loading, schema DDL and a migration runner,
  with integration tests against a real PostgreSQL.
- **Phase 4 (`@assemora/resources`) — done.** Static and dynamic resources, the
  field registry, the `entries.*` CRUD commands, filtering, search and pagination.
- **Phase 5 (`@assemora/http` + `@assemora/openapi` + `@assemora/sdk`) — done.**
  `route()`, the Fastify adapter, generated REST CRUD, OpenAPI 3.1, the API Explorer
  introspection endpoint and the SDK generator. The contract of §98 runs as a test.
- **Phase 6 (`@assemora/auth`) — done.** Users, sessions, roles, permissions,
  policies, API tokens and agent identities. Every CRUD command passes policies, and
  an application no longer needs `permitAll()`.
- **Phase 7 (`@assemora/pages` + `@assemora/revisions` + `@assemora/media`) — done.**
  The block tree, drafts, publishing, revisions with restore, optimistic concurrency
  and the media library with a local storage driver.
- **Phase 8 (`apps/studio`) — done.** Login, navigation, resource CRUD, media, the
  API Explorer, pages, the block builder, revision history, users and the developer
  section — all driven by the Schema Registry: Studio has no list of collections, no
  hand-written form and no list of block types. `apps/playground` is the reference
  application it is developed against, and now ships its own frontend bundle, which
  is what the builder canvas renders inside (ADR-0017, ADR-0018).
  `@assemora/react` was pulled forward from phase 10 for that reason: SPEC.md §59
  requires the canvas to run the real renderer, not a copy of it.

- **Phase 9 (`@assemora/mcp` + `@assemora/audit` + `@assemora/change-sets`) — done.**
  Dry run, change sets, the audit log, field-level agent permissions and an MCP
  server generated entirely from the Schema Registry. The mandatory scenario of
  SPEC.md §97 runs as `tests/integration/agent-e2e.test.ts`, over the protocol.

- **Phase 10 (`@assemora/cli` + `create-assemora` + `assemora` + starters) — done.**
  The twenty-two commands of SPEC.md §77, schema diffing behind `db:generate`, the
  plugin API, the S3 storage driver, the umbrella of SPEC.md §9, the scaffolder, both
  starters, both examples and the guide. Every package now exports its real API.

Decisions phase 10 added (ADR-0021, ADR-0022):

- The CLI imports the project's *application* at runtime through `assemora.config.ts`
  and reads its registry and its buses. It never imports a feature package, so
  `assemora agents` is an authorized, audited read on the Query Bus like any other.
- `defineConfig` lives in `@assemora/cli`, because the config exists for the CLI and
  core must not learn what a migrations directory is.
- Schema diffing splits along the dialect line: `diffSchema()` in `@assemora/database`
  is pure and knows no SQL, `migrationSql()` in `@assemora/database-postgres` writes
  it, and the CLI orchestrates. The diff is taken against the snapshot in
  `.assemora/generated/`, not against a live database — generation has to be
  deterministic and to work offline, and drift belongs in `db:status`.
- `assemora` is the umbrella of SPEC.md §9 and the top of the graph. It may depend on
  everything precisely because nothing depends on it, and `pnpm boundaries` fails on
  any edge pointing at it. It holds wiring and no business logic — including the
  routes `auth`, `media` and `mcp` may not declare themselves.
- Studio is loaded by the umbrella through a dynamic import resolved from the
  *project*, never a dependency: a hard edge would install a React SPA into every
  project that answered no to SPEC.md §78's third question.
- `create-assemora` is unscoped and dependency-free, because `pnpm create assemora`
  resolves an unscoped name and runs before anything is installed.
- `starters/bare` is a workspace package, so CI compiles the template rather than
  trusting it. All eight answers to §78's questions are asserted mechanically.
- `server.mountAssets()` serves a single-page application outside the API prefix and
  outside the Schema Registry: a stylesheet is not an endpoint.

An adversarial pass after the phase found defects worth remembering, all fixed:

- The API rate limit had never worked. `@fastify/rate-limit` attaches through an
  `onRoute` hook, and routes were mounted before the plugin finished registering, so
  no request in any Assemora application was ever counted (SPEC.md §85).
- `mountCommands()` published `POST /api/commands/auth.login` beside the hardened
  login route — the same session as readable JSON, usable as a CSRF-exempt bearer
  token, with the IP and user agent recorded on the session chosen by the caller.
  The umbrella no longer publishes a command it fronts with a route of its own.
- Media bytes went to the model directly, so a policy covered the listing and not the
  files. They go through the Query Bus now, like every other read.
- The generated SDK printed an array of a union as `readonly "a" | "b"[]`, which is
  not the type anybody meant, so §124's "TypeScript SDK" was unmet for any project
  with pages.
- A `BlockView` was a `ComponentType`, and a class component's `defaultProps` put the
  props in a covariant position — so every registry entry needed `as never`.
- `hasDefault` cleared the "may fail on existing rows" warning in the schema diff,
  though ADR-0011 keeps defaults out of the DDL, so the column really does arrive
  with nothing to put in existing rows.

Decisions phase 9 added (ADR-0019, ADR-0020):

- A dry run is the command pipeline with the transaction rolled back. There is no
  second code path, so a preview cannot disagree with the write it predicts, and a
  preview an actor may not perform is refused exactly as the command would be.
- Inside a batch preview a step does *not* open its own rollback — the caller owns
  it. "Add a block, then set its title" is one proposal, and undoing each step
  separately would leave the second referring to something rolled back (SPEC.md §74).
- An MCP mutation is a proposal by default. Production state changes when a person
  applies it (SPEC.md §75); `mutations: 'direct'` is the deliberate opt-out.
- Applying re-previews and compares `baseVersions`, so a proposal written against an
  older page is refused rather than silently overwriting. Declining is an *outcome*,
  not an exception: the row has to remember that it declined, and throwing would roll
  back the very status that records it.
- Every tool is generated from the registry. A hand-written tool list drifts the
  moment somebody adds a resource, and this package cannot reach a database at all.
- A tool carries the name the bus knows, beside the name the agent calls. Stripping
  the `assemora.` prefix is not invertible — `assemora.describe` is registered under
  that name.
- Field-level agent permissions refuse the whole command and name every offending
  field, rather than dropping fields silently. A read projects to what the actor may
  see; revisions still record the whole row, because history is not a reader.
- The Query Bus is audited too. SPEC.md §76 lists audit among the seven things a tool
  call must pass, and half the tools are reads.
- A command may declare the `subject` it acts on where its name and the record it
  changes disagree — the block commands declare `pages` (ADR-0015, amended).

Decisions phase 1 already fixed, which phase 2 builds on:

- `core` owns the ports for authorization, transactions, revisions and audit;
  packages above it register implementations (ADR-0008).
- Authorization denies by default. `permitAll()` is the explicit, deliberately blunt
  opt-out.
- The Schema Registry lives in `core` and stores descriptors typed only through
  `@assemora/schema`. It must never import types from a package above it.
- `.models()`, `.resources()` and `.routes()` reach `module()` through module facets
  plus interface augmentation (ADR-0009).
- Block tree types belong in `@assemora/schema`, not `@assemora/pages`, or
  `@assemora/react` drags the server layer into browser builds.
- A relation's target is accepted as `unknown` so mutual relations do not hit
  TypeScript's circular-reference error (ADR-0010). Relation *names* stay typed.
- The query builder is immutable and produces a Query AST. Nothing may reach an
  adapter's own query API, and `@assemora/data` must never learn about PostgreSQL.

Decisions the second half of phase 8 added (ADR-0018):

- `server.mountQueries()` publishes every registered query as `GET /queries/<name>`,
  the read half of `mountCommands()`. Query-string values are decoded against the
  query's own declared input schema. A read belongs to the package that owns the
  data — `pages.list`, `media.list`, `auth.users.list` are queries in their packages.
- `list` and `get` both mean `read` in `subjectOf`, for every subject. A permission is
  held by any wildcard above it: `articles.*` grants `articles.update`.
- `BlockNode.design` carries the seven universal controls of SPEC.md §61, beside
  `props` rather than inside it. Every value is a token; the theme decides what a
  token looks like, and nothing there can express CSS.
- A block may be added before it is written. `pages.publish` refuses a tree holding an
  unfinished block and names the field.
- Every tree command answers with the tree it produced, so the canvas redraws without
  a read and Studio never reimplements a tree operation.
- `revisions.undo` / `revisions.redo` are commands; the stack is derived from the
  history, not held in a tab. A revision carries `sequence` because ordering decides
  what undo does and `createdAt` cannot separate two commits in one millisecond.
- `revisions.restore` restores a revision's `after` — "put it back the way it was
  then". `to: 'before'` reverses it instead.
- The builder canvas is an iframe loading the *application's* frontend at `/preview`.
  `@assemora/react` owns the renderer and the `postMessage` protocol both ends read.
- `diffTrees()` in `@assemora/schema` says "the hero's title changed" instead of
  handing back two block trees.
- `createHttpServer({ security })` sends a Content Security Policy, `nosniff` and a
  referrer policy on every response (SPEC.md §85). `frameAncestors` is the one an
  application must set: the builder canvas frames `/preview`, and nothing else may.

An adversarial review after the phase found six things worth knowing, all now fixed
and covered by tests:

- A query whose *input* names what it reads has to authorize twice, like a command
  does. `QueryContext.authorize(subject, action, record)` is that second question, and
  `revisions.list` asks it — otherwise one `revisions.read` opened the history of
  every entity in the application.
- A role, an API token and an agent are each a way to mint a credential, so all three
  refuse to grant a permission the actor does not hold themselves.
- A stored file is served as its own type only if that type is safe to render;
  anything else is `application/octet-stream` with `Content-Disposition: attachment`.
- An ordinary edit retires the redo branch. Without that, redo reached past a newer
  edit and overwrote it with a state the page had left.
- A restorer says what it *replaced*, and the revision of a restore records that
  rather than the other side of the revision it applied — the two differ exactly when
  an old revision is restored after later edits.
- `null` is a state a restorer must handle: undoing a creation deletes, and restoring
  a deletion re-creates.

Decisions phase 8 added to the HTTP layer (ADR-0017):

- `bytes(data, type)` and `respond(body, { cookies, headers, status })` are the two
  ways a handler answers with something other than a plain JSON body. Both are
  deliberately narrow; neither names a server library.
- `server.mountCommands()` publishes every registered command as
  `POST /commands/<name>`. Safe because the bus validates and authorizes first, and
  authorization denies by default — not because the list is curated.
- CSRF lives in `@assemora/http`: a mutating request with cookies and no
  `Authorization` header must repeat the CSRF cookie in a header (SPEC.md §85).
- `/auth/login`, `/auth/me` and the media URLs are declared by the *application*,
  because `auth` and `media` may not depend on `http`. `apps/playground` is the
  reference implementation of that contract.

Carried into phase 3 deliberately, do not mistake them for oversights:

- `create()` takes `Partial<Record>` and validates at runtime; compile-time required
  fields land with resources in phase 4.
- `.with()` types the head of a relation path; deeper segments are runtime-checked.
- `belongsToMany` is declared and described but not yet loaded by any adapter.
- `decimal()` carries a string, not a `Decimal` value type (SPEC.md §18).
- Column defaults live in the data layer, not in the generated DDL (ADR-0011).
- Schema *diffing* is not implemented; `assemora db:generate` lands in phase 10.
- CRUD is one generic command set (`entries.create/update/delete`) addressed by
  resource name, matching the MCP tools of §70 (ADR-0012).
- A resource's writes are reachable only through those commands; `PERSISTENCE` is
  behind a symbol so bypassing the mutation path is deliberate.
- Optimistic concurrency (§66) is stored but not enforced; it lands with pages in
  phase 7.
- Dynamic entries sort by their own columns only, not by a key inside the JSONB.
- A resource read is projected to its declared, non-hidden fields; the model row
  behind it is reachable through `Resource.model`, never through `list()`.
- Every adapter must agree on what a `Condition` means, and
  `tests/integration/adapter-conformance.test.ts` is what proves it (ADR-0013). A new
  operator arrives with its conformance case.
- `ASSEMORA_REQUIRE_POSTGRES=1` turns an unreachable database into a failing
  integration suite instead of a silently skipped one.
- Reads go through the Query Bus, writes through the Command Bus. `@assemora/http`
  serves resources without depending on them (ADR-0014).
- Describing a route and mounting it are separate acts; registration is idempotent.
- A hidden field never reaches the OpenAPI document or the generated SDK.
- Authorization asks twice: permissions before the write, the policy rule once the
  record is loaded (ADR-0015). A command name is also its permission name.
- Passwords are Argon2id; tokens are SHA-256 digests of 256 random bits. Neither is
  ever stored as written, and a token's plaintext exists only when it is issued.
- Block tree types live in `@assemora/schema`; `@assemora/pages` owns the behaviour
  (ADR-0016). Every tree edit is a pure function, and the commands are thin wrappers.
- `expectedVersion` is optional: stating it turns a lost update into a 409 (§66).
- The restorer registry is a core seam, like the ports — `revisions` restores an
  entity without knowing what it is.

Known gaps, each with a reason rather than an oversight:

- A command and a query declare an input schema but no *output* schema, so their
  generated endpoints appear in OpenAPI and the SDK with an undocumented response.
  Closing it means adding `output` to `command()` and `query()` and writing one for
  every existing handler — worth doing, and not what SPEC.md §115 asked for.
- The Design section of SPEC.md §58 is not built: SPEC.md §62 fixes the theme token
  document but declares no table, no commands and no routes for it. That contract has
  to be designed before a screen can edit it.
- Studio's own calls are recorded as `source: rest`, because Studio reaches the same
  generic `/api/commands/*` routes any REST client does. Separating them means either
  a header the server would have to trust, or routes Studio alone may call — a
  decision, not a patch.
- `frame-ancestors` is one header for the whole origin, so `frontend.framedBy` widens
  it on `/studio` too. Per-route security headers in `@assemora/http` would fix it.
- `db:status` reports applied and pending migrations but not drift against a real
  database. That needs `adapter.introspect()` to return relations and enum values,
  which it does not — it reads columns only.
- A session records no `ipAddress`. `request.ip` is the socket peer, which behind any
  proxy is the load balancer, and trusting `X-Forwarded-For` without a configured
  chain of trusted hops is the same forgery one layer down. It needs a `trustProxy`
  option on `createHttpServer` and an `ipAddress` on the context; a column that lies
  in every production deployment is worse than an empty one.
- `string()` is `varchar(255)`, so an agent-supplied change-set title longer than that
  fails on PostgreSQL where it succeeds in memory. `text()` versus `string()` for
  free-form fields is a convention call nobody has made.
- `revisions.undo` of a *deletion* re-creates the entry under a new id, because the
  resource restorer goes through `PERSISTENCE.create`. A second undo then cannot find
  it.
- Studio's sidebar derives every item from the registry except Media, which is
  hard-coded — so a project without `media()` shows a link to nothing.
- `.with('posts')` does not add the relation to the instance type. ADR-0010 erased the
  relation target's type to make mutual relations declarable at all; typing the loaded
  shape means revisiting that trade-off in a new ADR, not patching around it.
- `whereJson`'s path and value are `string` and `unknown`. Typing a JSON path against
  the document type is possible and wanted; it is a design task of its own.
- `json<T>()` takes a type argument nothing validates at runtime. SPEC.md §17 asks for
  exactly that shape; a checked variant would take a schema instead of a type.
- Row-level concurrency (locks, lost updates) is untested. It needs `for update` in the
  Query AST, which belongs with optimistic concurrency in phase 7 (SPEC.md §66).

## Commands

```bash
pnpm verify           # boundaries + lint + build + typecheck + test + test:types
                      # what CI runs. Run it before finishing a task
pnpm test:integration # PostgreSQL suite; skips itself when no database is reachable
                      # it imports built packages, so build first — `vitest` alone
                      # can pass against a stale dist. `pnpm verify` builds for you.
pnpm boundaries    # package dependency rules (SPEC.md §8)
pnpm lint          # Biome check
pnpm format        # Biome write
pnpm build         # turbo run build (tsc project references)
pnpm typecheck     # per-package tsc --noEmit + scripts
pnpm test          # Vitest
pnpm test:types    # type-level tests only (*.test-d.ts)
```

Two processes are needed to look at Studio:

```bash
pnpm --filter @assemora/playground dev   # the application, on :4000
pnpm --filter @assemora/studio dev       # Studio, on :5173, proxying /api
```

The playground seeds itself on first boot and signs in with `ada@assemora.dev`. A
generated project needs one process instead: `assemora()` serves Studio at `/studio`
beside its own API.

## Non-negotiable rules

- `SPEC.md` is the source of truth. When architecture is ambiguous, prefer the
  solution that preserves schema-first design and clean user-facing code.
- Public API priority: **beautiful > readable > type-safe > internally simple.**
  Never change a public API merely to make the implementation easier.
- Never expose Drizzle, Fastify, React or any other implementation library through
  the normal public API. Ownership of those libraries is enforced by
  `pnpm boundaries`.
- No decorators in primary Assemora APIs.
- One schema declaration feeds runtime validation, database, Studio, OpenAPI, SDK
  and MCP. Never duplicate schemas between those subsystems.
- All mutations go through the Command Bus. Studio, REST, SDK, CLI and MCP share
  the same application logic — MCP never gets its own business logic or direct DB
  access.
- Never bypass Policies. Never bypass Revisions for content mutations.
- No dependency cycles between packages; new edges require an entry in
  `scripts/lib/package-graph.ts` plus an ADR.
- Never use `any` to silence TypeScript. Use `unknown` and validate. Local,
  documented exceptions only.
- Pages are stored as a block tree, never as an HTML blob.
- Do not skip phases to produce a visual demo sooner. Studio and AI are clients of
  a stable application layer, not its designers.
- Run `pnpm verify` before completing a task.

## Language

Everything in this repository is written in English: code, comments, identifiers,
documentation, ADRs, test names and commit messages. No exceptions.

## Style

ESM, single quotes, no semicolons, trailing commas, 2-space indent, small
functions, explicit domain names. Biome enforces formatting — do not hand-format.

TypeScript is configured with `strict`, `noUncheckedIndexedAccess`,
`exactOptionalPropertyTypes` and `erasableSyntaxOnly`. Do not weaken these flags.

## Git

One logically complete change per task. Never mix refactoring, a new feature and a
repository-wide reformat in the same commit.

## Detailed rules

@docs/rules/architecture.md
@docs/rules/public-api.md
@docs/rules/data-layer.md
@docs/rules/security.md
@docs/rules/testing.md
@docs/rules/studio.md
