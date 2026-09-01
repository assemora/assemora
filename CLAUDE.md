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

- **After the phases: SPEC.md §24 and §47 — done.** Many-to-many is loaded by both
  adapters and carries `attach`/`detach`/`sync`, and `server.version('v1', …)` puts a
  resource at `/api/v1/articles` — in the registry, in OpenAPI, in the API Explorer
  and in the generated SDK, with no edit to any of them, because the version is part
  of the path rather than a fourth thing to compose. Mounting now refuses to start
  when the registry describes an address the server does not serve: an endpoint
  documented and answering 404 was always possible, and versioning made it the
  default outcome.

- **SPEC.md §82 — done.** `job()` is the third member of the family beside `command()`
  and `query()`, `dispatch()` hands one to a `QueuePort`, and `@assemora/queue-bullmq`
  is the production adapter (ADR-0023). A job dispatched inside a command waits for
  the **outermost** transaction to commit, not for the command to return — an earlier
  draft held it per command, and a review proved a nested rollback and an outer
  `transaction()` both left the job queued against state that never existed. That seam
  is `TransactionPort.afterCommit`, and events now use it too: a listener notified for
  an undone change was the same bug.
- Resolving an actor's permissions now checks that the user is still active, in
  `permissionsOf` — the one funnel every path goes through. A job carries an actor
  sealed into an envelope and replays it later, so a credential-time check structurally
  cannot see it, and a deactivated person's queued job used to write as them. It costs
  one extra row read per resolution and it is the only revocation the framework has.

- **SPEC.md §62 — done.** The theme is a stored document, not a hand-written
  stylesheet: `@assemora/theme` owns it, `themeCss()` renders it, and the umbrella
  serves it (ADR-0024). Three of the five groups have fixed keys derived from the
  constants §61 already addresses by name, so a theme cannot lack the token a block
  asks for. Every value is validated by kind and every declaration is built from
  validated parts — §62's "AI must change theme tokens rather than generate arbitrary
  global CSS" is therefore true by construction: `theme.update` is a command, so it is
  an MCP tool by generation, and no tool anywhere takes CSS.
- `theme.update` writes conditionally on the version it read, so `expectedVersion`
  means what SPEC.md §66 says. A row lock would need `for update` in the Query AST,
  which is a framework-wide change rather than the theme's to land alone.

- **SPEC.md §88 — done.** Request timing, slow query logging and the error tracking
  adapter interface were the three halves left; structured logs, command timing and
  `/health` + `/ready` were already there. The port follows the others in core: the
  default *logs* rather than discarding, because most applications register nothing
  and an error that vanishes for want of a reporter is worse than no port.
- The line between a caller's mistake and an incident is `status >= 500`, plus
  anything that is not an `AssemoraError` at all. SPEC.md §83 gave every error a
  status precisely to say whose failure it is, so the line is drawn once in the error
  model rather than re-argued in three layers.
- Nothing on its way to a reporter carries what was thrown. The error is rebuilt from
  a scrubbed first line and its `at` frames, capped in length, depth and frame count —
  the redactor was quadratic (cubic on a keyword-dense message: 131 seconds for 10 000
  characters) and it runs on a path that is already failing.
- A slow-query line carries the model, the operation, the duration and the row count,
  and never a value. A `where` holds whatever the caller passed, and a slow-query log
  is the file that ends up in a ticket.

- **A blank slate, and a collection with equal rights — done.** `pnpm create assemora`
  gave everybody a blog. SPEC.md §124 describes the walk as *"the developer adds:
  `export const Article = model(…)`"*, so the spec already assumed a fresh project has
  none — the starter disagreed with it. `starters/bare` is now an application with
  nothing in it, the worked example is `--template blog`, and §79's directories stay,
  empty, with a `.gitkeep`: a blank project needs the layout more than a populated one,
  because that is how a person learns where a model goes and it is where
  `assemora make:model` writes. The §124 test now *does* the adding rather than
  asserting the scaffold ships it.
- The deeper half was that the two ways to make a resource were not equal: a collection
  made in Studio answered 404 at its own address, and one declared in TypeScript did
  not. That is what "the CMS limits me" actually meant. `mountResources()` is idempotent
  now, so a collection loaded at boot gets endpoints of its own; a collection made while
  the process runs is served by one parameterised pair, because Fastify cannot add a
  route after `listen()`; and the route descriptions are reconciled when the Schema
  Registry *changes*, which is what lets `collections.create` answer with the addresses
  it really published instead of a promise. `settled()` still refuses to start when the
  registry describes an address nobody serves — the invariant was widened, not switched
  off, and a test proves it.
- A collection can restrict its CRUD (SPEC.md §43). The flags live in the definition and
  go through the parser like every other value, so a read-only collection is read-only
  in Studio, over MCP and in the generated SDK — not only at `/api`. Equal in rights was
  one-directional until then: a collection got everything a static resource got except
  the ability to publish *less*.
- **An application must boot against a database whose schema is not applied**, because
  that is exactly what `assemora db:generate` does — it boots the real application to
  read its registry (ADR-0021). `collections()` read its own table in a boot hook, so
  the command that writes the first migration needed the table that migration creates,
  and no project registering `collections()` could ever generate one. The adapter now
  tells five failures apart that all arrived as one 500 — `SCHEMA_NOT_APPLIED`,
  `DATABASE_NOT_FOUND`, `DATABASE_UNAUTHORIZED`, `DATABASE_FORBIDDEN`,
  `DATABASE_UNREACHABLE` — and only the first is survivable. `ECONNREFUSED` is eleven
  characters, so the `^[0-9A-Z]{5}$` SQLSTATE test never saw it and a refused connection
  used to report that the database had *rejected* the operation.
- A module that booted and could not start says so — `context.cannotStart(reason,
  { remedy })`, `application.notStarted`, and `/api/ready` answers 503 naming it
  (ADR-0026). Before that a process listened, served Studio, answered `/ready` with 200
  and refused every data request with 503, and a readiness probe routed production
  traffic at it. Core only warns, because throwing would take `db:generate` down with
  it; `listen()` errors, because it is the one caller that knows the state is fatal
  rather than routine.
- `AssemoraError` takes `expected`, and both `isIncident` and the access log read it.
  A permanent 503 on a probe is the endpoint answering, not a defect: at `periodSeconds:
  5` it was seventeen thousand reports a day, and `ports.ts` states the harm in its own
  words — a tracker fed a page of refusals hides the one 500 that mattered. The bit only
  ever *withdraws* the claim, so the harmful direction is not expressible.

- **What comes next is settled, and is not e-commerce.** A real site was measured against
  the framework — a catalogue of a hundred photographed items, a checkout, an order-status
  screen and a staff queue. Its customer-facing half is already expressible — models,
  resources, commands, queries, routes, blocks and policies reach far enough. So the
  question ADR-0025 reopened is answered: **Assemora does not learn what an order is.**
  ADR-0027 records what replaces it — the framework ships mechanisms and a package ships
  nouns, declaring through the same builder methods an application uses. `module()` grows
  facets; `Order` never arrives. `docs/architecture/site-kits.md` is the ordered work and
  `site-kits-design.md` is the long form behind it.
- Studio stays a closed, pre-built artifact and becomes registry-driven, and the unit a
  package contributes is a **view of a declared resource**, never a screen. The argument
  is the transport rather than a rule: a descriptor reaches Studio as JSON from
  `() => registry.describe()`, and a function does not survive `JSON.stringify` — so a
  predicate written into a declared action is not rejected, it is erased. The ceiling that
  draws is real and accepted: "waiting more than five minutes" compares a field against a
  *moving* value, so it becomes a column a job writes, which puts derived state in a
  command where it is validated, authorized, audited and visible to an agent.
- **A package can open the application today, and nothing says so.** `registerPolicy`
  refuses only a duplicate and writes nothing to the registry; `authorize` grants on
  permission *or* policy, so a policy is an alternative grant rather than a second gate;
  and nothing anywhere registers a policy for `pages`. Twelve lines in an installed
  package make `pages.create` and `pages.publish` succeed for a caller with no credential
  at all. Not exploitable while nothing is published and every module is first-party —
  critical the day a package is installable, which is what ADR-0027 is for. It is item 0.0
  of the plan, with five other Tier 0 corrections everything else rests on.

**SPEC.md §131 localisation — the core is done** (ADR-0028). `assemora({ locales,
defaultLocale })` is a deployment fact, validated once and registered as a Schema Registry
section so Studio, OpenAPI, the SDK and `assemora.describe` read the set rather than each
being told. A language is a path segment stripped *before* routing — `/api/ru/articles` is
`/api/articles` read in Russian — so every route stays declared and described once; three
languages would otherwise treble the document whose whole purpose is to be read. A first
segment that is not a language is untouched, so `/api/v1/…` still means a version.

- `model(…).translatable()` adds `locale` and `translationOf` and the row keeps its shape.
  A field never becomes a map keyed by language: that breaks the record type, the column,
  the form, the OpenAPI schema, the SDK and the MCP tool at once, which is §2 abandoned
  for a storage convenience.
- A read is scoped to the language of the operation without a caller asking, and a missing
  translation falls back to the default **in one query** — two appended result sets would
  put every untranslated row after every translated one, and page two of a menu would be a
  different menu. It costs one extra read to build the condition. `inLocale`, `allLocales`
  and `withoutFallback` are the ways to mean something else.
- `entries.create` writes the language of the operation; `entries.translate` writes the
  translation, starting from a copy of the original, through the Command Bus — so it is
  validated, authorized, revised, audited and an MCP tool by generation. A translation of
  a translation hangs off the original, or the fallback sees two entries where the site
  has one.
- A resource read projects `locale` beside `id`. §131 is explicit: a page that silently
  serves English under a Russian URL with nothing saying so is worse than a 404.
- Before it, `Issue` gained `params` and `toPayload` gained `issues`, so a refusal reaches
  a client as a code and its parameters rather than as an English sentence with the number
  baked in (`site-kits.md` 2.5 — do it before localisation or do it twice).

- Studio edits in a chosen language — from the registry, so an application with no locales
  sees no switcher. A listing badges a row answered in another language, and the entry form
  leads with the languages: the row on screen, a link to one that exists (`out of date`
  where it was written before the original changed), or a button that writes it. A fallback
  says in as many words that it is the original and that editing it changes what every
  language falls back to. `entries.translations` is the read behind it, and it takes the
  same permission reading the entry does.
- A **reference names the original row** of an entry in every language, so the projection
  carries `translationOf` beside `locale` and Studio's relation picker works in entry ids:
  the labels are in the language being edited and the values are the originals. Without it,
  picking a category while editing in Russian wrote a Russian row's id into a foreign key.

- **A page is translatable**: a slug and a block tree per language, which is §131's own
  wording. `pages.translate` copies the original's blocks and leaves the copy unpublished,
  and `pages.get` steps back to the original for a translation nobody has published —
  otherwise the minute after making one, a visitor got an empty page where a minute
  earlier they got the original.
- A translatable row in a deployment that names no languages carries `UNSPECIFIED_LOCALE`,
  the empty string. A read of the **default** language matches it too, because a row
  written before a site had languages is in the language it was written in. Without that,
  adding `locales` to a project with content would make all of it vanish. Core does *not*
  refuse a translatable model in a one-language deployment — it used to, and that broke
  SPEC.md §9 and §124, which write out a whole application without a word about locales.

- **OpenAPI carries the languages as a server variable**, and the prefix moved out of the
  paths to make that expressible: a path holding its own base cannot be relative to both
  `/api` and `/api/ru`. So a document has `servers: [{url:'/api'}, {url:'/api/{locale}',…}]`
  and paths like `/articles` — which is how an OpenAPI document is ordinarily written. One
  language still means one path.
- **The generated SDK types the languages**: `export type Locale = 'uk' | 'en' | 'ru'`,
  `createTypedClient({ url, locale })` and `api.inLocale('ru')`, which answers with a
  second client rather than changing the one a caller holds.

**§131 is built.** The one thing in it that is not, and will not be: a collection (§37) is
not translatable at all and says so where it is asked — its entries share one JSONB table
and its stored definition has nowhere to say which fields are worth translating.

Every section of SPEC.md §1–§130 is implemented. The spec then grew: ADR-0025 settles
which of its limits are permanent and which were only a schedule, and adds five
sections it never had — §131 localisation, §132 taxonomy, §133 navigation, §134 forms,
§135 singletons. Of those, §131's core is built; §132, §133, §134 and §135 are not.

The four permanent invariants, so nobody re-argues them: a page is a block tree and
never an HTML blob; the theme is tokens and nothing accepts CSS; a resource definition
is declarative data with no runtime expression; every mutation goes through the
Command Bus. They are the product rather than restrictions on it — an agent can be
trusted with a site because the surface is constrained.

Also left, and not a section: nothing is published to npm, so `create-assemora` writes
a dependency range that resolves to nothing and a generated project runs only from a
checkout.

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
- `belongsToMany` is loaded by both adapters and carries the pivot verbs of SPEC.md
  §24. The join table is derived once, by `joinTableDescriptor()` in
  `@assemora/database`, because the DDL, the schema diff and the pivot writes all
  need one and deriving it three times is how they come to disagree. A pivot with
  columns of its own is an ordinary model with two `belongsTo` relations — declaring
  one and pointing `through` at it is refused, because ADR-0011 keeps defaults out of
  the DDL and its own `id` would arrive with nothing to put in it.
- `decimal()` carries a string, not a `Decimal` value type (SPEC.md §18).
- Column defaults live in the data layer, not in the generated DDL (ADR-0011).
- Schema *diffing* is not implemented; `assemora db:generate` lands in phase 10.
- CRUD is one generic command set (`entries.create/update/delete`) addressed by
  resource name, matching the MCP tools of §70 (ADR-0012).
- A resource's writes are reachable only through those commands; `PERSISTENCE` is
  behind a symbol so bypassing the mutation path is deliberate.
- Optimistic concurrency (§66) is stored but not enforced; it lands with pages in
  phase 7.
- Dynamic entries sort by their own columns only, not by a key inside the JSONB — so a
  definition asking for a sortable field is refused at the parser rather than accepted
  and ignored.
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
- Row-level concurrency has no lock. `for update` is not in the Query AST, so a
  command that must not lose an update writes conditionally on the version it read —
  `@assemora/theme` does. That works and is arguably stronger for a single row, but it
  is a pattern each command reimplements until `@assemora/data` grows a conditional
  write.
- `registeredModels()` is process-global and populated at import, so a module switched
  off still contributes its tables to the generated schema. True of `theme: false` and
  identically of revisions, audit and change sets.
- Nothing tells an upgrading project that a release added a table. `db:status` reports
  migration files, not drift, for the reason recorded above.
- The pivot verbs sit below the Command Bus, at the level of `save()` — which is the
  right level for a mechanism, but `save()` has `entries.update` above it and a link
  has nothing above it at all. So a many-to-many is the one relation Studio, REST, the
  SDK and MCP cannot edit, and the audit log cannot see. `entries.link` / `unlink` /
  `sync` following ADR-0012's generic CRUD is the shape; which side of a mutual
  relation owns the fact, and what a policy on a link means, have to be decided first.

**SPEC.md §81 notifications — done, as a module (ADR-0029).** §81 names notifications once,
in a list of what an event is for, and stops there. `@assemora/notifications` is the contract
behind the word: `notification('orders.placed', { input, render })` is the fourth member of the
family beside `command()`, `query()` and `job()`; a recipient and a delivery are resources, so
the address book, the log, REST, OpenAPI, the SDK and the MCP tools follow from one declaration;
and a channel is a driver, with `telegram()` the first one and the only file that knows Telegram
exists.

- **The package registers no policy**, which is the whole of item 0.0 taken seriously: an
  installed dependency must not open an application. `notifications.send` is therefore refused
  until the application says who may announce, and the rule it writes is one line —
  `send: ({ context }) => context.source === 'job'`. `context.source` is set by the door a call
  came through and no client can choose it, so a guest placing an order causes a notification
  while `POST /api/commands/notifications.send` is refused.
- **The payload is a schema.** A topic validates what it is sent before anybody is told anything,
  so no caller — a handler, an operator, an agent — can put arbitrary prose into a staff channel.
  `render` is server-side and never leaves the process, which is the ADR-0027 line about a
  function not surviving `JSON.stringify` used deliberately rather than worked around.
- **A message is text and only text**: no parse mode, no markup. Every value in it came from what
  a stranger typed into a checkout, and escaping value by value has to be right every time.
- **Sending and delivering are two commands with the network call in between.**
  `notifications.send` renders once and writes a pending row per address inside the caller's
  transaction; the jobs are held until the outermost commit, so a rolled-back order tells nobody.
  The job sends and then executes `notifications.record`, so the row it changes goes through the
  Command Bus like every other row. A rejection (`chat not found`) is recorded and not retried; an
  unreachable channel is recorded and rethrown, and the queue decides when.
- **A delivery that failed is a row, not a silence.** A recipient pointing at a channel this
  deployment was not given is a failed delivery naming the missing channel — the difference
  between "the kitchen was not told" and "nobody knows whether the kitchen was told". What it does
  not do is expire: the rendered text holds a telephone number and an address, and retention is a
  decision nobody has made.

**Site kits, Tier 1.1 and 1.2 — done.** A body limit is a number the application sets,
and a relation is chosen rather than typed.

- `bodyLimit` is an option on `createHttpServer`, on a route, and per command name on the
  endpoints `mountCommands()` generates. Per route, because the ceiling a photograph needs
  is a memory amplifier on every address that only ever receives a form — so `assemora()`
  gives it to `POST /api/commands/media.upload` alone, at 16 MiB by default and
  `media: { maxUploadBytes }` to change. Everything else keeps 1 MiB, now stated as
  `DEFAULT_BODY_LIMIT` rather than inherited from Fastify. A refusal is translated into
  §46's envelope and names the limit: a body rejected by the parser never reaches a route,
  so without that it arrived in a shape no generated client reads.
- `RouteDescriptor.bodyLimit` is the registry half, so OpenAPI and the SDK stop promising
  an upload the server answers 413 to.
- Studio draws `relation()` with a picker over the target resource, and `ResourceOptions`
  gains `titleField`. Without it a picker read the first *declared* field holding text, so
  declaring `articleNumber` before `name` made every list read `091`, `001`, `144` — an
  answer that depended on the order somebody wrote the fields in. A `titleField` naming
  nothing, or naming a hidden field, is refused at `resource()` where it was written.
  A relation whose target is not described, or not readable by this actor, keeps a text
  box and says which of the two it is: the column still holds an id.

The rest of what that measurement found is real and unfixed. Each carries its `path:line`
in `docs/architecture/site-kits.md`, whose Tier 0 and Tier 1 are the ones a package makes
urgent:

- `assetCacheControl` tests for a hex hash and Vite's alphabet is base64url, so every
  asset this repository builds is `no-cache` — and there is no `ETag` and no
  `Last-Modified`, so a conditional request re-downloads in full. Nothing is compressed
  either: the shell bundle is 202,723 bytes against 63,732 gzipped.
- A collection has no `titleField`: a dynamic definition does not carry one, so a
  collection made in Studio still falls to the guess. The picker itself works there,
  because a relation's target is in the descriptor either way.
- A record-scoped action (`update`, `delete`, `restore`, `publish`) passes stage one the
  moment a policy object exists, and nothing checks the handler ever asked stage two.
  The framework's own commands all remember; an application's need not.
- A command and a query may share a name, and that produces two MCP tools with one name.
  `packages/mcp/src/server.ts:97` is a `find`, so the read wins and the mutation is
  unreachable.
- A policy is invisible: `registerPolicy` writes nothing to the Schema Registry, so an
  application's access control is the one thing the single source does not describe.
- The builder canvas frames `/preview` same-origin with no `sandbox`, and the CSRF cookie
  is `httpOnly: false` at `Path=/` — so a block view can read the parent's cookies.
- `datetime` renders through `toISOString()` into a `datetime-local`, so 18:00 Kyiv
  displays as 15:00. The write path is correct, so it does not compound.
- `validateProps` has no null branch while `validateAgainstFields` does, so clearing a
  block's image, number, date or link throws where the same field in a resource form
  clears.
- There is no `media.update`, so `alt`, `width` and `height` are permanently null.
- A collection's listing emits no `ORDER BY` when no sort is sent, then paginates over an
  unordered heap.
- A validation message is English prose with its parameter baked in and `toPayload` drops
  the code, so a non-English site cannot show a server-side field error. §131 does not
  fix it — a translated row inherits the same untranslatable English.

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
