# Site kits: what to build, in order

The decision is ADR-0027: the framework ships mechanisms, a package ships nouns. This is
the work that follows from it, ordered so somebody can start at the top and never be
blocked by something below.

The acceptance test is literal, and a step that fails it should be named rather than
worked around:

```bash
pnpm create assemora a-site      # blank, as it is
pnpm add @example/shop           # one package
# one line in src/app.ts
```

and the result is a whole site — data model, admin views, blocks, routes, agent tools.
Nothing forked, nothing patched, no file in `node_modules` edited.

Everything below was measured against `608e1fd`, by taking a real site — a catalogue of a
hundred photographed items, a checkout, an order-status screen and a staff queue — and
asking what would have to exist before it could be built on Assemora. Every claim carries
its own `path:line`, so this document stands on its own.

## Tier 0 — safety and provenance

Nothing else may be built first: every facet below rests on these.

| # | Change | Package |
| --- | --- | --- |
| 0.0 | A policy is bound to the module that owns the subject, and policies reach the Schema Registry | `auth` + `core` |
| 0.1 | `ResourceDescriptor.module` | `resources` |
| 0.2 | One namespace refusal at `createApplication()`, naming **both** modules | `core` + `resources` |
| 0.3 | ~~A record-scoped action must prove stage two ran~~ — done | `auth` + `core` |
| 0.4 | Close the four silent last-wins registries | four call sites |
| 0.5 | `sandbox` on the builder canvas iframe | `apps/studio` |

**0.0** is the one with a live consequence and ADR-0027 records the measurement. The rule
is *"a subject the declaring module does not own"*. Policies in the registry is the other
half: an application's access control is currently invisible to OpenAPI, Studio, MCP and
`assemora describe`, which contradicts the single-source rule.

**0.1** `packages/resources/src/module.ts:49` is the only facet registration that does not
pass its module name — compare `packages/data/src/module.ts:43`,
`packages/pages/src/module.ts:34`, `packages/http/src/module.ts:42`. So the one section
Studio's sidebar is built from is the one with no provenance. The generated CRUD routes
carry none either, so a report of what a package brought will undercount it.

**0.2** needs 0.1, and it is bigger than it looks. The permission namespace is the only
collision that *grants* rather than refuses. `refusePermissionSubject`
(`packages/resources/src/collections.ts:209-217`) already does this and runs on exactly
one path — `collections.create`. The declarative path is unguarded. Lift it to a check
over resource names ∪ command groups ∪ query groups at `createApplication()`, and make it
module-aware or it refuses a package that legitimately owns both `orders` the resource
and `orders.*` the commands.

One detail to settle while lifting it: `permissionSubjects()` splits at the *first* dot
(`collections.ts:180`) and `subjectOf` at the *last* (`packages/auth/src/authorization.ts:53`).
For a three-segment name they disagree. The discrepancy currently over-refuses, which is
the safe direction, but the widened check must pick one rule and say which.

Note the ordering trap: a duplicate resource name throws inside `registerResource`
*during* module registration (`packages/core/src/application.ts:101`), so an end-of-boot
check never sees it. The identical-name case needs its own message, naming both modules.

**0.3 — done.** `authorize` now resolves an `AuthorizationDeferral` rather than nothing
when it lets a record-scoped action past on the strength of a policy alone, and the
Command Bus refuses to commit a deferred command whose handler never called stage two.
The refusal names the command and the question that was owed, inside the transaction, so
the writes the handler already made go with it.

It carries the subject and action rather than the bare `'deferred'` this plan proposed:
the whole value of the refusal is that it can say *which* question, and a literal cannot.
It records that the question was put and not what it was about — `revisions.restore`
defers on `revisions` and then asks about the page or article it is restoring, which is a
stronger question than the one deferred, and demanding a match would refuse the most
careful command there is.

**0.4** `registerFieldKind`, `registerRestorer`, `model()`'s table registry and the shared
command ∪ query name are all silent last-wins. Measured: `orders.sync` declared as both a
command and a query produces **two MCP tools with one name**, and
`packages/mcp/src/server.ts:97` is a `find` — so the read wins and the mutating tool is
unreachable. `useAdapter`, `useStorage` and `registerJobBus` are the same shape.

## Tier 1 — what blocks the client site

| # | Change | Package | Cost |
| --- | --- | --- | --- |
| ~~1.1~~ | ~~`bodyLimit` on the server and per route~~ — **done** | `http` | ~30 lines |
| ~~1.2~~ | ~~`case 'relation'` in Studio, + `ResourceOptions.titleField`~~ — **done** | Studio + `resources` | ~40 lines |
| 1.3 | Asset caching, `ETag`, compression | `http` | ~120 lines |
| 1.4 | A body parser, and the exact bytes | `http` | ~250 lines |

**1.1 — done.** `grep -rn bodyLimit packages/` found nothing, Fastify's default is 1 MiB,
and `media.upload` takes base64, which inflates 4/3. Measured: 600 KB uploaded, 800 KB was
refused 413. A hundred photographs are the content of such a site and no project code
could raise the ceiling.

It is now an option on `createHttpServer`, on a route, and per command name on the
endpoints `mountCommands()` generates — per route because a ceiling sized for a photograph
is a memory amplifier on every address that only receives a form. `assemora()` gives it to
`media.upload` alone: 16 MiB by default, `media: { maxUploadBytes }` to change, everything
else at `DEFAULT_BODY_LIMIT`. A refusal is translated into §46's envelope and names the
limit, because a body the parser rejects never reaches a route and so was arriving in a
shape no generated client reads. `RouteDescriptor.bodyLimit` is the registry half, so
OpenAPI and the SDK stop promising an upload the server refuses.

**1.2 — done.** Studio draws a picker over the target resource, and `ResourceOptions`
carries `titleField`, refused at `resource()` when it names nothing or names a hidden
field. A relation whose target is not described, or not readable by this actor, keeps a
text box and says which of the two it is. What follows is what it was.

`grep relation apps/studio/src/screens/fields.tsx` → zero. `EntryPicker` exists
(`fields.tsx:378`) and is reachable only from `LinkInput`; `media()` — the same stored
shape — got a picker and `relation()` got neither. And Studio's collection editor
*refuses to save* a relation field without a target
(`apps/studio/src/collections/draft.ts:463`), then hands the editor a text box for a
UUID. Second half: `titleOf` picks a picker's label by declaration order among
`text | slug | email | url | select` (`fields.tsx:355-367`), so declaring `articleNumber`
before `name` makes every list read `091`, `001`, `144`. `ResourceOptions.titleField`,
validated against a declared non-hidden field.

**1.3** `assetCacheControl` is `/-[0-9a-f]{8,}\.[a-z0-9]+$/i`
(`packages/http/src/assets.ts:73-74`) and Vite's hash alphabet is base64url, so every
real filename this repository builds is `no-cache` — `index-DEIdtNpg.js`,
`index-B17nNPQv.js`, `index-DqSbeEe8.js`. Only the doc-comment's own hand-written example
matches. There is no `ETag` and no `Last-Modified`, so a conditional request re-downloads
in full. `grep -rni compress packages/http/src` → zero; the shell bundle is 202,723 bytes
raw against 63,732 gzipped. `@fastify/compress` is a fourth Fastify dependency and
therefore one line in `scripts/lib/package-graph.ts` and a sentence in an ADR.

**1.4** is the one that needs a design, and `bytes()` is the precedent — a marker whose
doc-comment says *"the marker names no server library, so a handler still never sees
Fastify"* (`packages/http/src/bytes.ts:14`). The inbound direction is that reflected:

```ts
export type BodyParser = {
  readonly contentType: string   // strict type/subtype, no '*'
  /** Bytes in, a value out. Throwing is a 400 the layer above renders as §46's envelope. */
  parse(raw: Uint8Array, headers: Readonly<Record<string, string>>): unknown
  readonly bodyLimit?: number
}
```

Declared through a `.bodyParsers()` facet keyed by module, so two packages claiming
`application/x-www-form-urlencoded` are refused at `createApplication()` naming both. The
parsed value lands where `request.body` lands (`packages/http/src/server.ts:633`) and is
validated by the route's declared `body` schema — so a payment callback is *typed*, which
a `register` escape hatch would never have given.

Two details decide whether it is right rather than adequate. `addContentTypeParser` cannot
be called after `listen()`, so a parser arriving from a boot hook is too late and must be
**refused with a sentence**, not dropped; `.bodyParsers()` at registration is synchronous
and therefore always early enough. And `raw: true` — for an HMAC over the exact bytes —
**requires** a `bodyLimit` or `mount` refuses the route, because a route that holds the
whole body in memory is a memory amplifier, and that is a refusal at boot rather than an
incident at 3 a.m.

`RouteDescriptor.contentType` is the registry half, so OpenAPI stops generating a JSON
call for a route that refuses JSON.

## Tier 2 — the facets

`actions`, `views` and `control` on a resource; `singleton()`; navigation; a filter
grammar on `entries.list`; `query()` gaining `subject` and `reachableFrom`; a route
reaching the Command Bus; a delayed job.

The design for each is in `docs/architecture/site-kits-design.md`. Six problems were
found by compiling and booting the design and must be solved rather than discovered:

- **`views` cannot show a child collection.** No field kind renders a `hasMany` —
  `relation()` is a single uuid (`packages/resources/src/fields.ts:319-320`), `table()` is
  a JSON grid stored in the row (`:693`). The class is "a workflow screen over a parent
  and its children": a ticket's messages, an invoice's lines, a moderation queue's
  reported comments.
- **`views` cannot express a per-viewer filter.** "Assigned to me" is in every workflow
  admin, and the escape used for time-derived state — make it a column a job writes —
  does not apply, because the value differs per viewer rather than moving with the clock.
- **A board has no page size and no column order.** `groupBy` groups whatever came back in
  one page of `entries.list`, which is 20 rows (`packages/resources/src/resource.ts:135`).
  Sixty open orders means the board silently shows a third of them, and *"lists are always
  paginated"* is the rule that makes it so.
- **A declared action is a confused deputy** unless it is bound. Nothing ties
  `ActionDescriptor.command` to the resource it sits on, so a package can put "Accept" on
  its own screen and call `auth.users.password` — measured, it succeeds, and the audit row
  says `source: rest`, which is what Studio's own calls look like. The rule: an action may
  only name a command whose subject is the resource it is declared on, or one the
  declaring module owns.
- **`refreshMs` is an audit-row generator with no floor.** Every query writes an audit row
  (`packages/core/src/queries.ts:131`). Two views at five seconds on three tablets is
  ~104,000 rows a day, and a customer status poll is an *unauthenticated* write into the
  audit table.
- **A package's first `resource()` cannot create an entry** unless it declares every
  non-nullable column without a default. The check is in the data layer
  (`packages/data/src/model.ts:207`), below the resource's own validator, so Studio shows
  a validation error for a field that is not on the form and there is no way to satisfy it.

## The ecosystem, still undecided

**`db:status` lies after a package is installed.** `pnpm add` then `db:generate` is
precisely the moment a project acquires a snapshot/database mismatch: the diff is taken
against `.assemora/generated/schema.json`, so a migration is written holding one table
while the database is missing twenty-eight; the application dies on boot with
`SCHEMA_NOT_APPLIED` and `db:status` prints *"Every migration is applied."* Comparing
package versions does not catch it, because both artefacts the framework wrote agree with
each other. This wants a decision before packages exist.

**Prefixes.** ADR-0027 records that the rules force command-name namespacing anyway.
Designing it is cheaper than discovering it, and it changes a URL, an SDK method name and
what an agent calls a tool — so it is its own ADR.

**Uninstall works better than expected and nobody had checked.** A published page keeps
serving its orphan tree; `pages.publish` refuses with `UNKNOWN_BLOCK` and freezes the
page, but `blocks.remove` frees it; `revisions.restore` answers *"Nothing knows how to
restore a dishes. The package that owns it registers a restorer."*;
`assemora db:generate` writes the drops with a warning per table. Left dangling: role
permissions like `dishes.*`, and audit rows naming commands nothing can explain.

**`/api/_introspection` is a third scaling axis nobody counted:** 114 KB blank, 158 KB
with two packages installed, fetched on every Studio screen.

## What still cannot be a package

- A **screen** that is not a view of a declared resource. That is the chosen bound
  (ADR-0027), and the escape is the project's own frontend, already served at `/` and
  already carrying the same session — the cookie is `Path=/`
  (`packages/http/src/respond.ts:56`).
- A **block view**. It lives in the project's bundle (`packages/react/src/registry.ts:72`,
  `starters/bare/app/main.tsx:38`), so a package ships the block *declaration* and the
  project imports its views — one import per block. That is the honest cost of not
  shipping React from a server package.
