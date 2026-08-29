# Site kits: the full design

The decision is ADR-0027; the ordered work is `docs/architecture/site-kits.md`. This is
the long form behind both — the inventory of what a package can declare today, the
argument for each facet, a sketch of a client kit, and the reasoning that was rejected.

Measured against `608e1fd`. Where this document and `site-kits.md` disagree,
`site-kits.md` is the one that was corrected after the design was compiled and booted;
six of its findings are not in here.
---

## 0. Corrections, before anything is built on them

The three inventory passes disagree in six places. Each was settled by opening the file.

**1. Do not widen `FieldKind`.** One pass proposed `FieldKind | (string & {})` so a
plugin's kind name survives into the descriptor; another proposed a `control` beside a
closed `kind`. The union's own doc-comment has already decided it:

> *"A kind is a **stored shape** plus the control that edits it. Two names for one shape
> is how a schema starts lying, so `radio` is not here (it is a `select`, drawn as radios
> when Studio judges it worth it)"* — `packages/resources/src/fields.ts:30-35`

`spiciness` is an `integer` drawn differently, exactly as `radio` is a `select` drawn
differently. Widening the union propagates a lie to the column, to validation, to OpenAPI
and to the SDK. **`control` beside `kind` is right, `kind` stays closed at 24**, and this
removes what one pass costed as the single largest item in its tier.

**2. The union is 24 members, not 22.** `packages/resources/src/fields.ts:37-61`, and
measured: `registeredFieldKinds().length` is 26 with two probe kinds registered.

**3. `entries.list` does not silently drop an unknown filter.** The measurement says the
two list surfaces disagree, and one design pass budgeted two days partly for
that. Both paths push a `not_filterable` issue and throw:
`packages/resources/src/resource.ts:189-198` + `:249` for a static resource,
`packages/resources/src/dynamic.ts:279-288` + `:335` for a collection.
`packages/http/src/crud.ts:118-127` forwards to the same query. Both answer 422. **There
is no divergence and no work here.**

**4. `orders.status` does not necessarily 403.** `subjectOf`
(`packages/auth/src/authorization.ts:50-66`) splits at the *last* dot and
`policyFor(subject)?.rules[action]` is keyed by an open string, so a policy declaring a
`status` rule works today. The measurement was describing its own sample
policy, which declared four rules and not that one. The real hole is narrower and is in
§3 below: `query()` has neither `subject` nor `reachableFrom`
(`packages/core/src/queries.ts:70-84`) and `queryEndpoints` filters nothing
(`packages/http/src/queries.ts:88-89`).

**5. `RECORD_SCOPED` is at `packages/auth/src/authorization.ts:82`**, not `:84`.

**6. Not all six kit screens are a view of a resource.** One pass claimed they are.
Kitchen queue, order detail, add-on set editor, settings form and dashboard tile are.
**Menu ordering by drag is not** — it is a many-row write of `position`, and the same
pass's own rule ("moving a card is an action, not a drag-to-mutate") excludes it. Five of
six. The honest answer for the sixth is a `position` integer in the entry form; a generic
`entries.reorder` is a candidate and is out of this plan.

---

## 1. The principle

**Assemora ships mechanisms, never nouns. A package ships nouns, and it ships them by
declaring through the same eight builder methods an application declares through — so
there is nothing a package can do that a project could not have written itself, and
nothing it can declare that the Schema Registry does not describe.** The framework's job
is therefore to close the gap between *what a project can write in TypeScript* and *what
a package can declare*, and nowhere else: every item in §3 is either a shape that is
already expressible in a handler and not expressible in a declaration, or a namespace
with no owner. Concretely this rules out three things, and they are the arguments this
paragraph exists to settle. **It rules out the framework growing `Order`, `Cart`,
`Product` or any successor** — those are `@assemora/commerce`'s or a client's, and the
`pnpm boundaries` graph is what keeps them out (`scripts/lib/package-graph.ts`). **It
rules out a package getting a second place to declare a thing** — no parallel schema, no
screen definition file, no `plugin.json`; if a package wants Studio to draw something it
declares it on the resource, and the same declaration reaches OpenAPI, the SDK and MCP or
it does not exist. **And it rules out a package widening a declarative surface**: a
package may run arbitrary TypeScript in a `command()` handler, because a command is
validated, authorized, transacted, revised and audited, and it may not put an expression
anywhere a stored definition, a descriptor or a registry entry can hold one — the test is
`JSON.stringify` round-trips the declaration without losing meaning, and where that is
true the invariant is kept by construction rather than by rule.

---

## 2. The Studio decision

**Answer 1, with the line drawn at "a view, not a screen": Studio stays a closed,
pre-built artifact and becomes registry-driven, and the unit a package contributes is a
*view of a declared resource* — never a screen.**

### The argument

**The transport already enforces it, so this is not a policy.** The descriptor reaches
Studio as JSON from a handler that is literally `() => registry.describe()`
(`packages/openapi/src/route.ts:63` over `packages/core/src/registry.ts:242-250`). A
function does not survive `JSON.stringify`. A package that wants to give Studio
*behaviour* has nowhere to put it — a predicate written into an action is not rejected,
it is **erased**. That is the difference between forbidden and unexpressible, and the
brief asked for the second.

**The two cases that hurt.**

*The kitchen queue.* Everything the design needs is data: the filter
(`entries.list` already takes and validates `filters`, `packages/resources/src/resource.ts:189-209`
— Studio simply never sends them, `apps/studio/src/screens/collection.tsx:177`), the
refresh (`refreshMs` → `refetchInterval`; `grep refetchInterval apps/studio/src` → 0),
the four transition buttons (`when: [{ field: 'status', operator: 'eq', value: 'new' }]`),
the courier picker (`form: [{ name: 'courierId', kind: 'relation', target: 'couriers' }]`
— `EntryPicker` already exists at `apps/studio/src/screens/fields.tsx:378`), and the three
columns (`shape: 'board', groupBy: 'status'`).

Two things it cannot reach, and the second is the whole argument for the bound.
A sound alert: no, and a catalogue that grows an entry per client's ergonomics is a fork
with extra steps. **"Late — waiting over five minutes": no, and it must stay no**, because
`createdAt < now() − 5min` compares a field against a *moving* value and there is no shape
for that which is not an expression. The answer is that `late` is a **column**, written by
the job the kit already declares — and then `when: [{ field: 'late', operator: 'eq',
value: true }]` works. The ceiling pushed derived state out of a template and into a
command, where it is validated, authorized, transacted, audited and visible to an agent.
That is the bound doing its job, not an apology for it.

*The field control.* Measured, independently, against the built package:

```
registerFieldKind('spiciness', () => integer())
describeField(…).kind                        →  "integer"     ← the word is gone
registeredFieldKinds().includes('spiciness') →  true
{ ...integer(), kind: 'spiciness2' } then .required()  →  "integer"
```

The forgery fails because modifiers rebuild from the closed-over `state`
(`packages/resources/src/fields.ts:196-210`) and `start()`, the only constructor that sets
`kind`, is module-private (`:212`). So **`Fallback` is dead code for a plugin kind**
(`apps/studio/src/screens/fields.tsx:922-928` describes behaviour that cannot occur), and
today exactly one built-in kind reaches it: `relation`, because
`grep -c relation apps/studio/src/screens/fields.tsx` → **0**.

The fix is `control` on the field, not a wider `kind` — see correction 1. It is a
non-breaking addition, every exhaustive switch keeps compiling, and it makes something
already written start working: `apps/studio/src/collections/contract.ts:24-27` says in its
own words that `collections.create` publishes *"the kinds this process has registered,
plugins included"*, `:135-140` says such a kind *"needs nothing"*, and `:210-218` already
files it under an **"Other"** group. The authoring half was built for plugin kinds. Only
the descriptor was missing. Three chillies: yes. A colour wheel, a map pin, a
drag-to-reorder seating chart: **no**, unless Studio ships the shape.

### Why not the other two

**Answer 2 (Studio as a library)** wins both cases and pays everywhere else.
`apps/studio/package.json:36-46` publishes no `src` and one subpath (`./assets`);
`apps/studio/src/main.tsx:30` calls `createRoot` at module scope, so *importing* Studio is
*mounting* it; `apps/studio/src/styles.css:1` is `@import "tailwindcss"`, so a consumer
inherits Tailwind 4. It kills ADR-0022's third paragraph in both directions — "no" stops
meaning "install nothing", "yes" stops meaning "install one artifact" — and it makes
`docs/rules/studio.md`'s central rule unenforceable, because under it a button *computes*
whether an order may advance, which is business logic Studio has and the API does not.

**Answer 3 (split the surface)** cannot do the field control at all: a field control is a
control on the content-editing form, and content editing is the half answer 3 keeps
closed. It therefore needs answer 1's descriptor work regardless. That is why this
decision absorbs it as a *boundary* rather than treating it as a rival: **Studio renders
what is declared; the project renders what is arranged.**

### The three things to be honest about

**It costs no new facet, no new registry section and no MCP edit.** `resources` is already
in `assemora.describe`'s hand-written list (`packages/mcp/src/queries.ts:82`) and already
in Studio's `Introspection` (`apps/studio/src/api/introspection.ts:135-143`). A `.screens()`
facet would need a process-global, name-unique facet name — two kits could not both define
one (`packages/core/src/module.ts:107-115`) — plus a section, plus a hand edit at
`packages/mcp/src/queries.ts:74-98`, plus a route in `apps/studio/src/app/router.tsx:44-82`.
Views on a resource need none of them.

**Third-party code already runs in Studio's origin, and that is a defect to fix
independently of this decision.** `apps/studio/src/builder/canvas.tsx:371-376` renders
`<iframe src="/preview?…">` with **no `sandbox` attribute**, same origin. Both cookies are
origin-wide — `serializeCookie` defaults `Path=/` (`packages/http/src/respond.ts:56`) and
neither `authRoutes` cookie sets one (`packages/assemora/src/auth-routes.ts:51-68`) — and
the CSRF cookie is `httpOnly: false` deliberately (`:60`). A kit's block views run there
(`packages/react/src/registry.ts:72-85`). So a kit's browser code can read `assemora_csrf`
and POST as the signed-in editor **today**. `sandbox="allow-scripts"` is the fix and it
needs a decision about how `/preview` reads a draft without a session cookie, because
`packages/react/src/frame.ts:26-32` checks `event.origin` in both directions and an opaque
origin posts `"null"`. **It is its own work item and I am not counting it as a benefit of
this choice.**

**The ceiling, generalised.** A screen whose data is not a resource listing (a
revenue-by-category report) is not expressible — `QueryDescriptor` has no `output`
(`packages/core/src/queries.ts:50-56`), and adding one would give a package a second place
to declare a shape. A screen over two resources at once is not expressible. A control
Studio does not ship is not expressible. All three live in the project's own frontend.

---

## 3. What to build

Ordered so somebody starts at the top. Only three hard edges: **3.1 before 3.5** (a board
needs `status in [...]`), **2.4 before 3.6** (a singleton's write *is* the conditional
write), **1.1 before 1.4** (they share the limit plumbing). Everything else is
independent.

Recurring cost to budget once: a new command or query is an MCP tool **by generation**
(`packages/mcp/src/tools.ts:85-90`) and costs nothing. A new **registry section** reaches
`/api/_introspection` free and reaches an agent only through a hand edit at
`packages/mcp/src/queries.ts:74-98`. Nothing in this plan adds a section.

### Tier 0 — the four safety corrections a kit rests on

| # | Change | Package | Registry | MCP | Cost |
|---|---|---|---|---|---|
| 0.1 | `ResourceDescriptor.module`, passed from `internals.name` | `resources` | one field | — | one line each |
| 0.2 | One namespace refusal at `createApplication()` | `core` + `resources` | — | — | ~120 lines |
| 0.3 | A record-scoped action proves stage two ran | `auth` + `core` | — | every tool gets stricter | ~60 lines |
| 0.4 | Close the four silent maps | four call sites | — | — | small |

**0.1** `packages/resources/src/module.ts:49` is `context.registry.register('resources',
registered.descriptor)` — **the only facet that does not pass its module name**. Compare
`packages/data/src/module.ts:43`, `packages/pages/src/module.ts:34`,
`packages/http/src/module.ts:42`, all of which do. So the one section Studio's sidebar is
built from is the one section with no provenance. Everything in Tier 4 reads this.

**0.2** The permission namespace is the only collision that **grants** rather than
refuses. Every other duplicate throws at `createApplication()` — resource
(`packages/resources/src/registry.ts:15`), block (`packages/pages/src/block.ts:96`), policy
(`packages/auth/src/policies.ts:58`), command/query/job/route/model
(`packages/core/src/registry.ts:210`). But a kit declaring `resource(…, { name: 'orders' })`
and another declaring `command('orders.refund')` both install cleanly, and a role granted
`orders.*` so somebody can manage the catalogue holds the refund: `holds` matches by whole
segment (`packages/auth/src/permissions.ts:120-128`).

Assemora **has** this check — `refusePermissionSubject`
(`packages/resources/src/collections.ts:209-217`) reads the namespace off the registry and
refuses with a sentence explaining the harm. It runs on exactly one path,
`collections.create` (`:163`, `:385`). **The declarative path is unguarded**: the check
exists for a name somebody types into Studio and not for one that arrives by `pnpm add`.
Lift it to a check over resource names ∪ command groups ∪ query groups at
`createApplication()`, failing with **both modules named**.

One detail to settle while lifting it: `permissionSubjects()` splits at the *first* dot
(`packages/resources/src/collections.ts:180`, `indexOf`) and `subjectOf` splits at the
*last* (`packages/auth/src/authorization.ts:53`, `lastIndexOf`). For a three-segment name
they disagree. The discrepancy currently over-refuses, which is the safe direction, but
the widened check has to pick one rule and say which.

The escape hatch already exists: `command()` takes `subject`
(`packages/core/src/commands.ts:193`), honoured at `packages/auth/src/authorization.ts:62`.

**0.3** `if (RECORD_SCOPED.has(action)) return` (`packages/auth/src/authorization.ts:82`)
returns *allowed* the moment a policy object exists, and nothing checks the handler ever
called stage two. The framework's own commands remember; a kit's `orders.update` need not,
and `mountCommands()` has already published it (`packages/http/src/commands.ts:65-80`).
Make `authorize` return `'allowed' | 'deferred'` and have the Command Bus refuse to commit
a `deferred` command whose handler never asked.

**0.4** `registerFieldKind` (`packages/resources/src/field-registry.ts:62-64`),
`registerRestorer` (`packages/core/src/ports.ts:225-227`), `model()`'s table registry
(`packages/data/src/model.ts:287`) and the shared command∪query name are all silent
last-wins. Measured for the third: two `model('orders', …)` calls leave the second's
columns and throw only later, and only if both reach `.models()`. Measured for the fourth:
`orders.sync` as both a command and a query produces **two MCP tools with one name**, and
`packages/mcp/src/server.ts:97` is a `find`, so the query wins and the *mutating* one is
unreachable. Add the same throws-and-names-both treatment. `useAdapter`
(`packages/data/src/runtime.ts:21`), `useStorage` (`packages/media/src/storage.ts:80`) and
`registerJobBus` are the same shape and belong here if a kit is ever installed from a
registry rather than by hand.

### Tier 1 — the four the analysis ranked, which block the customer site

| # | Change | Package | Cost |
|---|---|---|---|
| 1.1 | `bodyLimit` on the server and per route | `http` | ~30 lines |
| 1.2 | `case 'relation'` in Studio, + `ResourceOptions.titleField` | Studio + `resources` | ~40 lines |
| 1.3 | Asset caching, `ETag`, compression | `http` | ~120 lines |
| 1.4 | A body parser, and the exact bytes | `http` | ~250 lines |

**1.1** `grep -rn bodyLimit packages/` → **nothing**. Fastify's default is 1 MiB and
`media.upload` takes base64, which inflates 4/3. A hundred photographs are the content of
a food site and no project code can raise the ceiling. Cheapest item in the plan and the
analysis's #1 blocker.

```ts
// HttpServerOptions and RouteDefinition
readonly bodyLimit?: number   // bytes
```
`RouteDescriptor` gains it too, so OpenAPI and the SDK stop promising an upload the server
refuses.

**1.2** Two lines of user-visible failure with one shape. `EntryPicker` exists and is
reachable only from `LinkInput`; `media()` got a picker and `relation()` got neither. And
`titleOf` picks a picker's label by declaration order among `text | slug | email | url |
select` (`apps/studio/src/screens/fields.tsx:355-367`), so declaring `articleNumber` before
`name` makes every list read `091`, `001`, `144`.

```ts
readonly titleField?: string   // validated: a declared, non-hidden field
```

**1.3** `assetCacheControl` is `/-[0-9a-f]{8,}\.[a-z0-9]+$/i`
(`packages/http/src/assets.ts:73-74`); Vite's hash alphabet is base64url, so every real
filename is `no-cache`. `grep -rn "compress\|etag" packages/http/src` → **0**. Widen the
class to `[A-Za-z0-9_-]{8,}`, add `ETag`/`Last-Modified` with `304`, register
`@fastify/compress` — which is a fourth Fastify dependency and therefore one line in
`scripts/lib/package-graph.ts` and a sentence in an ADR.

**1.4** The one that needs a design. `HttpServer` is ten members and none is `register`
(`packages/http/src/server.ts:159-219`), deliberately — an escape hatch handing out the
Fastify instance gives away the boundary in one method. The precedent points the other
way: `bytes()` (`packages/http/src/bytes.ts:14-15`) is a marker whose doc-comment says
*"the marker names no server library, so a handler still never sees Fastify"*. The inbound
direction is that reflected.

```ts
export type BodyParser = {
  readonly contentType: string          // strict type/subtype, no '*'
  /** Bytes in, a value out. Throwing is a 400 the layer above renders as §46's envelope. */
  parse(raw: Uint8Array, headers: Readonly<Record<string, string>>): unknown
  readonly bodyLimit?: number
}
```

Declared through a `.bodyParsers()` facet keyed by module, so two kits claiming
`application/x-www-form-urlencoded` are refused at `createApplication()` **naming both** —
the facet knows `internals.name`, so this collision message can be right from the first
line, unlike the six that name neither. The parsed value lands where `request.body` lands
(`packages/http/src/server.ts:633`) and is validated by the route's declared `body` schema,
so a payment gateway's callback is *typed*, which a `register` hatch would not have given.

Two things that decide whether it is right rather than adequate. **Timing:**
`addContentTypeParser` cannot be called after `listen()`, so parsers go at the head of the
promise chain `packages/http/src/server.ts:430-438` documents as load-bearing — which means
a parser arriving from a boot hook is too late and must be *refused with a sentence*, not
dropped. `.bodyParsers()` at registration is synchronous
(`packages/core/src/application.ts:188-197`) and therefore always early enough. **Raw
bytes:** `RouteDefinition.raw?: true` → `RouteRequest.raw?: Uint8Array`, held in a
`WeakMap<request, Uint8Array>` so it is freed with the request, and `raw: true` **requires**
a `bodyLimit` or `mount` refuses the route — a route that keeps the whole body in memory is
a memory amplifier, and that is a refusal at boot rather than an incident at 3 a.m.

**No registry section.** A parser is transport, like `mountAssets`, which is outside the
registry on purpose (`packages/http/src/server.ts:201-209`). What *is* registry business is
`RouteDescriptor.contentType?`, so OpenAPI stops generating a JSON call for a route that
refuses JSON. **No MCP.** A payment callback must not be a tool.

### Tier 2 — five core primitives

| # | Change | Package | Registry | MCP | Cost |
|---|---|---|---|---|---|
| 2.1 | `query()` gains `subject` and `reachableFrom` | `core` (+`http`,`mcp`) | two optional fields | a query can leave the tool list | ~35 lines |
| 2.2 | `ActorType` gains `'anonymous'` | `core` + `auth` | — | — | ~40 lines |
| 2.3 | `JobRequest.delayed(ms)` | `core` + `queue-bullmq` | — | — | ~50 lines |
| 2.4 | A conditional write in `@assemora/data` | `data` | — | — | ~90 + conformance |
| 2.5 | `Issue.params` | `schema` + `core` | — | codes not prose | ~80 lines |

**2.1** `packages/core/src/queries.ts:70-84` has neither, while `command()` has both
(`packages/core/src/commands.ts:189-213`). `packages/http/src/commands.ts:69` filters on it
and `packages/http/src/queries.ts:88-89` filters nothing; `packages/mcp/src/tools.ts:86-88`
filters commands and not queries. So a publicly-authorized `orders.status` polled every 30
seconds is *necessarily* an MCP tool and *necessarily* at the generic path.

**2.2** `packages/core/src/context.ts:11` is `'user' | 'agent' | 'api'`. A cart belongs to
somebody who is nobody yet, so its owner is not expressible and the policy degenerates to
`() => true`. `permissionsOf` (`packages/auth/src/permissions.ts:99-110`) is an exhaustive
switch: one case returning `EMPTY`, with no row read, which is also the honest answer.

**2.3** `JobRequest` is `{ name, payload, retries }` (`packages/core/src/jobs.ts:55-59`).
`.delayed(ms)` returns a new request, immutably, like the query builder. **The default
in-process runner refuses a delayed job** with a `ConfigurationError` naming it and saying
`jobs: { queue }` is what a delay needs: it cannot await five minutes
(`packages/core/src/ports.ts` awaits jobs deliberately) and it must not run it now, because
the whole meaning of "escalate if nobody accepted after five minutes" is the delay.

**2.4** `packages/theme/src/write.ts:30-31` says it in its own words: *"`@assemora/data`
has no conditional write of its own to call — when it grows one, this is the file that
disappears."* The Query AST already has `operation: 'update' | 'delete'` and both adapters
implement them, so this is a builder terminal plus one conformance case (ADR-0013), not an
AST change.

```ts
update(values: Partial<Row>): Promise<number>   // rows written
delete(): Promise<number>
```

**An unconditioned `update()` or `delete()` throws.** "Update every row" is never what
anybody typed on purpose. Highest leverage item in the plan: it deletes
`packages/theme/src/write.ts` (66 lines) and the `ATTEMPTS = 3` retry loop
(`packages/theme/src/commands.ts:35, 84`), and it is what makes 3.6 cheap.

**2.5** `Issue` is `{ path, code, message }` and every refinement bakes its parameter into
an English sentence, so a customer who does not read English is told `"Must be at least 9 characters"` and
the client validates twice. §131 does not fix it — a translated copy of the row inherits
the same untranslatable English. Do it **before** localisation or localisation does it
twice.

### Tier 3 — the declarative Studio surface

| # | Change | Package | Registry | MCP | Cost |
|---|---|---|---|---|---|
| 3.1 | A filter grammar on `entries.list` | `resources` | `comparators` per field | agent stops guessing | ~140 lines |
| 3.2 | `DynamicDefinition.defaultSort` | `resources` | — | — | ~30 lines |
| 3.3 | `control` on a field | `resources` + Studio | one field | — | ~90 lines |
| 3.4 | `actions` on a resource | `resources` + Studio | one field | — | ~180 lines |
| 3.5 | `views` on a resource | `resources` + Studio | one field | publishes the state machine | ~200 lines |
| 3.6 | `singleton()` | `resources` + Studio | `kind: 'singleton'` | free | ~250 lines |

**3.1** Today a filter is equality only: `built.where(field, parsed.value)`
(`packages/resources/src/resource.ts:201`).

```ts
filters: { status: { in: ['new', 'accepted'] }, total: { gte: 400 }, courierId: { isNull: true } }
```

Every comparator maps to a `ComparisonOperator` the AST already has. The bare form
`{ status: 'new' }` keeps meaning equality, so every caller is untouched. **`pattern` stays
out** — a regex on a declarative surface is a runtime expression through the side door;
`contains` maps to `like` with the value escaped by the adapter,
so the caller never writes a pattern.

**3.2** `packages/resources/src/dynamic.ts:320` is `if (query.sort !== undefined)` with no
else, so `paginate()` walks an unordered heap — a row can appear twice and another be
skipped. A static resource can close this and a collection cannot. `ENTRY_SORT_FIELDS`
already bounds what is legal.

**3.3** `FieldState` gains `readonly control: ControlDescriptor | undefined`, the builder
gains `.control(name, props?)`, `describeField` (`packages/resources/src/descriptor.ts:96`)
copies it, and `ResourceFieldDescriptor` carries it.

```ts
export type ControlDescriptor = {
  readonly name: 'icons' | 'stars' | 'slider' | 'segmented' | 'picker' | 'swatches'
  readonly icon?: 'star' | 'flame' | 'chilli' | 'heart' | 'circle'
  readonly min?: number
  readonly max?: number
  readonly step?: number
  /** '$', 'min', '%'. A word beside the box, capped at 8 characters, never a format string. */
  readonly unit?: string
}

registerFieldKind('spiciness', () => integer().min(0).max(3).control('icons', { icon: 'chilli', max: 3 }))
```

**`registerFieldKind` needs no third argument** — the factory already returns a field, and
the field carries the control. One fewer API than the alternative design, and the control
survives `fieldFromSpec`'s modifiers by construction, because it lives in the state the
modifiers rebuild from (`packages/resources/src/fields.ts:196-210`) rather than being
spread on top, which is exactly why the `kind` forgery fails.

**`FieldShapeSpec` does not gain `control`.** A stored definition names a *kind*; the
kind's factory — TypeScript in a package — decides the presentation. That is §86's own
mechanism, and it means a person authoring a collection cannot pick a control that does not
fit the shape.

**3.4 and 3.5** — the two shapes, and the one line in them that matters:

```ts
type JsonScalar = string | number | boolean | null

export type ConditionDescriptor = {
  readonly field: string
  readonly operator: 'eq'|'ne'|'in'|'gt'|'gte'|'lt'|'lte'|'isNull'|'isNotNull'
  readonly value?: JsonScalar | readonly JsonScalar[]
}

export type ActionDescriptor = {
  readonly id: string
  readonly label: string
  readonly command: string                  // a registered command, never a computation
  readonly entryAs: string                  // which input key takes the primary key
  readonly input?: Readonly<Record<string, JsonScalar>>
  readonly form?: readonly FieldSpec[]      // ← the existing untrusted-definition parser
  readonly when?: readonly ConditionDescriptor[]
  readonly tone?: 'default' | 'primary' | 'danger'
  readonly confirm?: string
}

export type ViewDescriptor = {
  readonly id: string
  readonly label: string
  readonly section?: string
  readonly shape: 'table' | 'board' | 'cards'
  readonly filters?: Readonly<Record<string, JsonScalar | readonly JsonScalar[]>>
  readonly sort?: string
  readonly columns?: readonly string[]
  readonly groupBy?: string
  readonly refreshMs?: number
  readonly actions?: readonly string[]
  readonly tile?: { readonly label: string }
}
```

**`form?: readonly FieldSpec[]` is the single most important line.** `FieldSpec` is the
*existing* parser for untrusted declarative field data
(`packages/resources/src/field-registry.ts:56`, built by `fieldFromSpec` at `:361-387`). An
action's modal is therefore not a second form system — it is `fieldFromSpec` →
`describeField` → Studio's own `FieldInput`. A package gets exactly the field kinds a
stored collection definition gets and not one more, and invariant 3 is kept by code that
already keeps it.

Validated at declaration, so all three fail at `createApplication()` rather than in a
browser: `command` must be a name the bus knows (`ModuleContext.commands.has`), a `form`
field's `target` must resolve through `resourceByName`
(`packages/resources/src/registry.ts:29`), and `field` must be declared. The same parser
serves a **stored** collection, so a collection made in Studio can carry views and actions
too — and a stored definition cannot invent a command, because the name is checked against
the bus.

Studio changes: six of forty-seven files. `apps/studio/src/app/shell.tsx:63-71` flatMaps
over views grouped by `view.section` (a resource with no views keeps today's single entry);
`apps/studio/src/app/router.tsx:45-49` gains a `view` search param and **zero new routes**;
`apps/studio/src/screens/collection.tsx:174-180` sends `filters` and `sort` and reads
`refetchInterval`; a row action strip in `collection.tsx` and `entry.tsx`; one new action
modal; `apps/studio/src/screens/fields.tsx:991-1135` gains `case 'relation'` and a `control`
branch ahead of the kind switch.

Two rules for the renderer, and they are the design. **Moving a card on a board is an
action, not a drag-to-mutate** — a state change is a command, and a drag that PATCHes a
status is Studio inventing a mutation path. **A button whose command refuses shows the
refusal** — a declared button is a suggestion, the command is the authority, and they are
allowed to disagree.

What an agent gains, free, because `resources` is already in `assemora.describe`:
**`when` publishes the state machine.** Which transitions are legal from which state was
readable only by opening the handler; now it is data, and an agent can check before it
proposes.

**3.6** A singleton (§135) is not a package and does not need a facet:

```ts
export const Settings = singleton('shop.settings', {
  phone: text().required(),
  deliveryFee: integer().control('slider', { min: 0, max: 200, unit: '$' }),
  freeDeliveryOver: integer(),
  pickupDiscountPercent: integer(),
  orderPrefix: text(),
  slots: array(text()),
})
```

It lives in `@assemora/resources`, produces an `AnyResource` with `kind: 'singleton'`,
registers through `.resources()`, and is reached through the `entries.get` / `entries.update`
that already exist, addressed by name (ADR-0012) with `api: { create: false, delete: false }`.
It is stored **in one shared framework table**, `assemora_singletons`, the way collections
share `assemora_resource_entries` (`packages/resources/src/system-models.ts`).

That last choice is the one worth defending: **a kit adding a singleton adds a row, not a
table**, so `pnpm add @example/shop` gets a settings screen with zero schema change. That
is worth more than sortable columns on a table with one row, and it is the difference
between "install and it works" and "install, then `db:generate && db:migrate`".

Cost: the write is 2.4; `ResourceDescriptor.kind` widens to `'static' | 'dynamic' |
'singleton'`, which Studio's two switches must handle (`sortableFields` at
`apps/studio/src/api/introspection.ts:236-237` is the only one that reads `kind` today).
**No MCP change at all**, because both operations are `entries.*` and already tools.

**The theme does not become a singleton.** Its row is `assemora_theme` and is migrated in
every deployed project; moving it is a data migration for no user-visible gain, and it has
semantics no singleton has (defaults, repair, a version driving the stylesheet URL —
ADR-0024). §135's *"the theme is the first singleton and the shape the rest follow"* is
satisfied by the shape being followed. What the theme *does* lose is
`packages/theme/src/write.ts` (66 lines) and the retry loop, to 2.4.

### Tier 4 — provenance and upgrade

| # | Change | Package | Cost |
|---|---|---|---|
| 4.1 | `plugins` into Studio's `Introspection` and `assemora.describe`; `labelOf` names a job | Studio, `mcp`, `plugin` | ~90 lines |
| 4.2 | `assemora plugins`, the twenty-third command | `cli` | ~150 lines |
| 4.3 | `db:generate` diffs the registry, not the process global | `cli` | ~40 lines |
| 4.4 | The snapshot and `assemora_migrations` remember package versions | `cli`, `database-postgres` | ~180 lines |
| 4.5 | `assemora build` runs `db:generate --check` | `cli` | one step |

**4.1** `installedPlugins()` (`packages/plugin/src/plugin.ts:244`) has **zero callers**
outside its own package and tests; `@assemora/plugin` is a dependency of nothing
(`scripts/lib/package-graph.ts:55`). Provenance is written into the registry and read by
nobody. And `labelOf` (`packages/plugin/src/plugin.ts:87-116`) returns `undefined` for a
callable, and a `JobDefinition` **is** callable (`packages/core/src/jobs.ts:61-68`), so
every job of every plugin is anonymous — one `typeof` branch, ten minutes, and it is the
difference between a count and a name.

**4.2** ADR-0025 already unfroze §77's list: *"the list is what shipped, not a ceiling"*.
The report is in §5.

**4.3** `packages/cli/src/commands/db.ts:76` reads `registeredModels()`, populated at
**import** (`packages/data/src/model.ts:287`). `db.ts:588` does `await
loadApplication(loaded)` and **discards the application**. Read
`app.registry.section('models')` instead — per-application, and each entry already carries
`module` (`packages/data/src/module.ts:40-44`). The global stays for what it is right for:
resolving a relation's target. A model declared and never registered becomes *absent* rather
than silently present, so `db:generate` must name it. Verified nothing in the repository
changes behaviour — every starter and example registers through `.models()`. **This is the
smallest change in the plan and the prerequisite for every sentence in §5 about upgrade.**

**4.4** `assemora_migrations` stores `name, applied_at`
(`packages/database-postgres/src/migrations.ts:349-358`), so **nowhere does the system
record which version of a kit a database was migrated for** — the comparison is not merely
unimplemented, it is not expressible. `writeSnapshot` already writes `{ version, migration,
tables }`; add `packages`, read off the `plugins` section. Then `db:status` answers the
question it cannot answer today — *"@example/shop is installed at 2.1.0; this database was
migrated for 1.4.0"* — with **no `adapter.introspect()`**, which is the stated reason drift
goes unreported. It compares two artefacts the framework wrote itself.

### Deferred, deliberately, and not needed for the acceptance test

**Navigation (§133) and taxonomy (§132)** are each a package of their own and each is
*nicer* than what a kit can do today rather than *necessary*: an ordered `nav_items`
resource with a parent and a position is expressible now, and so is a `dish_tags` model
with two `belongsTo`. They should land after the test passes, navigation first, because
navigation's `term` target needs taxonomy to exist. **Do not** let the kit encode a keyword
list matched against an ingredient line — that is a `pattern` by another name, and
invariant 3 forbids it; terms are stored on the dish.

---

## 4. `@example/shop`, sketched

The kit is four files plus a seed. Everything below **compiles today** except where
marked. A prior pass compiled a 1,514-line version of the non-marked half against the
repository's real built packages with `strict`, `noUncheckedIndexedAccess`,
`exactOptionalPropertyTypes` and `erasableSyntaxOnly`, exit 0, and booted it: 7 resources,
7 blocks, 8 commands, 8 queries, 2 jobs, 9 routes, `notStarted: []`, `orders.place`
answering `{"number":"#PC-45594","total":567}`, and `entries.update` on `orders` refused
`FORBIDDEN`.

### `src/models.ts` — compiles today

```ts
import { belongsTo, boolean, hasMany, integer, json, model, string, text, timestamp, uuid } from '@assemora/data'

export const Category = model('shop_categories', {
  id: uuid().primary().defaultRandom(),
  name: string(),
  slug: string().unique(),
  position: integer(),
  // Pizza-ness is a property of the category, not of the dish: `configurable` is set on
  // `picca` alone in the client's own data.
  configurable: boolean(),
  addonSetId: uuid().nullable(),
  dishes: hasMany(() => Dish),
  createdAt: timestamp().created(),
})

export const Dish = model('shop_dishes', {
  id: uuid().primary().defaultRandom(),
  name: string(),
  slug: string().unique(),
  articleNumber: string().nullable(),   // a made-to-order item has none
  price: integer(),                     // minor units, so a price is never a float
  ingredients: text().nullable(),
  popular: boolean(),
  spicy: boolean(),
  available: boolean(),
  position: integer(),
  categoryId: uuid(),
  category: belongsTo(() => Category),
  createdAt: timestamp().created(),
})

export const Order = model('shop_orders', {
  id: uuid().primary().defaultRandom(),
  number: string().unique(),
  status: string(),
  // Written by `shop.escalateUnaccepted`, because "waiting over five minutes" compares a
  // field against a moving value and a declared view cannot express that (§2).
  late: boolean(),
  // Frozen at `orders.place`. A price change next week must not rewrite what somebody paid.
  subtotal: integer(),
  discount: integer(),
  deliveryFee: integer(),
  total: integer(),
  address: json<{ street: string; house: string; flat?: string; floor?: string; entrance?: string }>(),
  courierId: uuid().nullable(),
  acceptedAt: timestamp().nullable(),
  cookingAt: timestamp().nullable(),
  onwayAt: timestamp().nullable(),
  deliveredAt: timestamp().nullable(),
  lines: hasMany(() => OrderLine),
  createdAt: timestamp().created(),
})
// … OrderLine, Cart, CartLine, Courier, Addon, AddonSet, OptionGroup, OptionChoice,
// PromoCode, Promotion, Banner — sixteen models, all the same shape.
```

### `src/resources.ts` — the orders surface

```ts
import { integer, relation, resource, singleton, text, toggle } from '@assemora/resources'
import { Order, ShopSettings } from './models.ts'

export const Orders = resource(
  Order,
  {
    number: text().sortable().searchable().label('Order'),
    status: text().filterable().label('Status'),
    late: toggle().filterable().label('Needs a call'),
    total: integer().sortable().label('Total').control('slider', { unit: '$' }),   // ← 3.3
    courierId: relation('couriers').label('Courier'),
  },
  {
    name: 'orders',
    label: 'Orders',
    titleField: 'number',                                                          // ← 1.2
    // A total is computed inside `orders.place`. Generic CRUD must never write it, and
    // SPEC.md §43's flags bind in Studio, over MCP and in the SDK — not only at /api.
    api: { create: false, update: false, delete: false },

    actions: [                                                                     // ← 3.4
      { id: 'accept', label: 'Accept', command: 'orders.advance', entryAs: 'id',
        input: { to: 'accepted' }, tone: 'primary',
        when: [{ field: 'status', operator: 'eq', value: 'new' }] },

      { id: 'setEta', label: 'Set ETA', command: 'orders.setEta', entryAs: 'id',
        form: [{ name: 'etaMinutes', kind: 'integer', label: 'Minutes', required: true }],
        when: [{ field: 'status', operator: 'in', value: ['accepted', 'cooking'] }] },

      { id: 'assignCourier', label: 'Assign courier', command: 'orders.assignCourier',
        entryAs: 'id',
        form: [{ name: 'courierId', kind: 'relation', target: 'couriers', required: true }],
        when: [{ field: 'status', operator: 'eq', value: 'cooking' }] },

      { id: 'delivered', label: 'Delivered', command: 'orders.advance', entryAs: 'id',
        input: { to: 'delivered' }, confirm: 'Mark this order delivered?',
        when: [{ field: 'status', operator: 'eq', value: 'onway' }] },
    ],

    views: [                                                                       // ← 3.5
      { id: 'kitchen', label: 'Kitchen', section: 'Kitchen',
        shape: 'board', groupBy: 'status',
        filters: { status: ['new', 'accepted', 'cooking', 'onway'] },               // ← 3.1
        sort: 'createdAt', refreshMs: 5000,
        columns: ['number', 'total', 'createdAt'],
        tile: { label: 'Orders waiting' } },

      { id: 'late', label: 'Needs a call', section: 'Kitchen', shape: 'table',
        filters: { status: 'new', late: true }, sort: 'createdAt', refreshMs: 5000 },

      { id: 'all', label: 'All orders', shape: 'table', sort: '-createdAt' },
    ],
  },
)

export const Settings = singleton('shop.settings', {                               // ← 3.6
  phone: text().required(),
  deliveryFee: integer().control('slider', { min: 0, max: 200, unit: '$' }),
  freeDeliveryOver: integer(),
  pickupDiscountPercent: integer(),
  orderPrefix: text(),
})
```

Marked: `titleField` needs 1.2, `control` needs 3.3, `actions` needs 3.4, `views` needs
3.5, list-valued `filters` needs 3.1, `singleton` needs 3.6 (which needs 2.4). Everything
else — the models, the resource, `api: { create: false, … }`, the fields — compiles and
runs today.

### `src/commands.ts` — compiles today, one line marked

```ts
export const PlaceOrder = command('orders.place', {
  description: 'Turns a cart into an order at a price the client did not choose',
  input: { cartToken: string(), name: string(), phone: string(), fulfilment: string() },
  // A route written for it is what makes it safe: it is publicly authorized, and the
  // generic /api/commands path would let anybody replay it without the rate window.
  reachableFrom: 'its own route',
  handle: async (input, context) => {
    const cart = await loadCart(input.cartToken)
    const priced = price(cart, await settings())          // server-side, never the client's
    const order = await PERSIST.create({ ...priced, number: nextNumber() })
    await context.revise(order.id, null, order)
    await dispatch(AlertKitchen({ orderId: order.id }))
    await dispatch(EscalateUnaccepted({ orderId: order.id }).delayed(5 * 60_000))   // ← 2.3
    return { number: order.number, total: priced.total }
  },
})
```

The `delayed(5 * 60_000)` is the design's own promise — *"зателефонуємо протягом 5
хвилин"* — and it is the one line in the file that does not compile today.

### `src/shop.ts` — the module

```ts
import { plugin } from '@assemora/plugin'

export const shop = () =>
  plugin('shop', {
    version: '1.0.0',
    description: 'Menu, cart, orders and a kitchen queue for a delivery restaurant',
  })
    .models(Category, Dish, Order, OrderLine, Cart, CartLine, Courier, Addon, AddonSet,
            OptionGroup, OptionChoice, PromoCode, Promotion, Banner, ShopSettings)
    .resources(Categories, Dishes, Orders, Couriers, PromoCodes, Promotions, Banners, Settings)
    .commands(CreateCart, AddLine, ApplyPromo, PlaceOrder, AdvanceOrder, SetEta, AssignCourier)
    .queries(ListMenu, GetDish, ListPromotions, OrderStatus, OrderQueue)
    .policies(MenuPolicy, OrdersPolicy, CartPolicy, CouriersPolicy)
    .blocks(PromoHero, Steps, DishGrid, Rules, Faq, Facts, MenuSection)
    .routes(...shopRoutes)
    .jobs(AlertKitchen, EscalateUnaccepted, CloseStale)
```

### `src/app.ts` — the one line

```ts
import { shop } from '@example/shop'

export const createApp = (): AssemoraApplication =>
  assemora({
    database: database(),
    modules: [auth(), pages(), collections(), shop()],   // ← the line
    project: { name: manifest.name, version: manifest.version },
    studio: true,
    mcp: true,
    frontend: { root: join(import.meta.dirname, '../app/dist') },
  })
```

### Which step of the acceptance test fails, precisely

`pnpm add @example/shop` plus that line delivers the data model, the admin CRUD, the REST
surface, the OpenAPI document, the SDK, the agent tools, the routes, the jobs and the
blocks **in the palette**. It delivers **nothing onto the page**, and it delivers none of
the seven customer screens.

`createBlockRegistry` is a per-call, project-owned object in the project's Vite bundle
(`packages/react/src/registry.ts:72-85`, called at `starters/bare/app/main.tsx:38`). A kit
cannot reach it. So the smallest honest amendment to the test is:

```ts
// app/main.tsx — one line in one more file
import { blocks as shopBlocks } from '@example/shop/views'
export const blocks = createBlockRegistry({ ...shopBlocks }, { fallback: Missing })
```

**That is not a fork and not a patch, and it is not one line in `src/app.ts` either.** It
is one line in the project's own renderer, which is arguably where a person *should* choose
their views — but the test as literally written fails there, and no item in §3 fixes it.

---

## 5. The ecosystem contract

**Namespacing: kits get an owner and one refusal, not a prefix.** A prefix
(`example_orders`) makes the URL a fact about npm packaging — `/api/orders` is what the
site's own frontend calls, and the package is an implementation detail of the site, not
something its visitors read off a URL. It is also worse for an agent:
`assemora.describe` hands over subjects to reason about the *site*, and prefixing forces the
agent to know which package owns a noun before it can name one. Payload and Strapi prefix;
that is the shape to avoid. The alternative is 0.1 + 0.2 — every declaration carries its
module, and one refusal at `createApplication()` names **both** modules and offers
`subject:` as the escape hatch. That is worth more than a prefix, because a human resolves
it at install time with full information, where a prefix is a decision the framework makes
for ever on their behalf. The one place a prefix *is* right is a theme token: a CSS custom
property is a genuine global with no registry to arbitrate it, so a kit asks for
`--shop-badge`.

**Upgrade: the database remembers the version it was migrated for, and a kit ships renames,
never SQL.** 4.4 gives `db:status` the sentence it cannot say today. Beyond that, three
measured facts decide the contract. A kit that ships a **required** column in v2 breaks the
project's `db:generate` outright — `packages/database-postgres/src/migration-sql.ts:403`
refuses it, and `hasDefault` does not help because ADR-0011 keeps defaults out of the DDL —
so the documented remedy is three migrations a kit cannot ship. A kit that **renames** a
field produces `drop` before `add` (`packages/database/src/schema-diff.ts:66-120` has nine
change kinds and none is a rename), and every row's value is gone. A kit that renames a
**block prop** freezes every page holding it: the published page keeps serving, but
`pages.publish` refuses (`packages/pages/src/tree.ts:256` → `packages/pages/src/block.ts:110`)
and `blocks.update` refuses whatever you send, because `updateBlockProps` merges
`{ ...existing.props, ...props }` (`packages/pages/src/tree.ts:143-144`) so the stale key is
always in the merge. So a kit declares renames as **pairs of names** — `rename`,
`renameField`, `renameProp` — the diff gains `columnRenamed`, and the block half is a
`blocks.renameProp` **command**, so rewriting every tree is authorized, transacted, revised,
audited and undoable. No SQL, no expression, no callback: invariant 3 holds by construction.
Refuse a kit running SQL at boot, a kit writing into the project's migration directory, and
a per-package migration sequence — all three destroy the property that makes `db:generate`
trustworthy, which is one deterministic diff against one committed snapshot, reviewable as
one file in one pull request.

**Trust: disclosure, because containment is not available and promising it is worse than
promising nothing.** Measured: `import { User } from '@assemora/auth'` then `User.create(…)`
writes a user with no command, no policy and no audit row. `useAdapter`, `useStorage`,
`registerJobBus` and `registerRestorer` are public exports and process-global. A kit runs
`postinstall`. Any plan claiming "this kit cannot reach your users table" is lying. What the
four invariants actually hold is narrower and worth stating exactly: they are guarantees
about the **declarative surfaces**, and a kit that bypasses the bus must **write TypeScript
to do it** — a file a reviewer can read, not a JSON field somebody pasted. So: `assemora
plugins` (4.2) prints what a package brought, and four lines that make it a security report
rather than a manifest — the permission subjects it claims, the reads and writes an
actorless context can make, **policies it declared for subjects it does not own**, and
framework parts it replaced. The third is a measured attack: a kit declaring
`policy('articles', { read: () => true, … })` for a subject the *project* owns and has no
policy for passes `registerPolicy`, which throws only on a duplicate
(`packages/auth/src/policies.ts:56-58`), and `registerPolicy` **writes nothing to the Schema
Registry**, so a policy is invisible to OpenAPI, Studio, MCP and `assemora describe`. Add a
`policies` section (subject, action names, module — not the rules) so it is visible, and
**refuse** a plugin declaring a policy for a subject no module declares and it does not own.

**What stops three kits turning the admin into a junk drawer.** Measured baseline
(against the built packages): a project with
`auth() pages() media() revisions() audit() changeSets() theme() collections()` and nothing
of its own already hands an agent **61 flat MCP tools** — 42 commands and 21 queries, two
filtered as `reachableFrom: 'its own route'`. Three kits take it past a hundred, and
`apps/studio/src/app/shell.tsx:63` maps resources with no grouping, no sort and no order but
registry insertion. Three answers, and they are one idea. **A kit is a place, and it says
what it is for**: the sidebar groups by `view.section` within the kit's own name (0.1 is what
makes that possible), and a kit declares its front door — the two or three resources somebody
opens on purpose — so `assemora.describe` reports **kits first, then their tools**, which is
strictly better for an agent with three kits or with none. The grouping key is the **module**,
not a free-form category, because a free-form category *is* the WordPress menu: every plugin
invents a top-level item and competes for attention. Grouping by module means the number of
top-level things is the number of kits somebody chose one at a time. And the refusal: **no kit
may add a top-level section to Studio's sidebar.** `Overview / Content / Pages / Library /
Design / AI / Settings` (`apps/studio/src/app/shell.tsx:52-105`) is the CMS's own structure and
it is why Studio is legible with one kit or five. That admin is illegible because
`add_menu_page()` lets any plugin claim the top level, and every plugin does — being one level
up is worth more to a plugin author than legibility is to them. **The framework has to hold
that line, because no individual kit author has any incentive to.**

---

## 6. What still cannot be a package

**The customer-facing screens, and this is the one that matters.** A package can export React
components; it cannot own the project's Vite build, its `index.html`, its router or its
service-worker registration, and it cannot reach `createBlockRegistry`
(`packages/react/src/registry.ts:72-85`). The menu, cart, checkout and status screens are not
block trees — they are an application. The honest division is that the kit ships a component
library and a block-view map and the project imports and wires them. **Acceptable, and it
should be written into the kit's README rather than papered over**: "one package, whole site"
is true of the data, admin, API and agent halves and false of the customer-facing half.

**A migration.** A kit ships a claim; the project runs `db:generate && db:migrate`. Acceptable,
and 4.4 is what makes it safe — the alternative is a per-package migration sequence, which is
worse than the problem.

**The theme.** ADR-0024 makes it a stored document a person edits. A kit writing it at boot
overwrites the client on every restart. Seeding is a scaffold act (`create-assemora
--template`), not a module act. Acceptable.

**The ports.** `authorization`, `transactions`, `revisions`, `audit`, `queue` and `errors` are
constructor options only (`packages/core/src/application.ts:38-62`), and `assemora()`
deliberately offers none for the first four (`packages/assemora/src/options.ts:9-13`). A kit
must not replace the application's authorization. **Acceptable and deliberate** — and 0.4 is
what closes the back door, because `useAdapter` and `useStorage` are that in all but name today.

**Per-route rate limiting.** `orders.place` from an anonymous visitor wants a tighter window
than `GET /shop/menu`; the limit is one global window. **Not acceptable long-term** — it is the
one item on this list that is a real gap rather than a boundary — but it does not block the
acceptance test and it is not designed here.

**Deployment facts**: `DATABASE_URL`, the storage driver, the queue, merchant credentials, the
domain, TLS, and the cron that would run a scheduled job. Acceptable, and unremarkable.

**A hundred photographs at 2–5 MB.** Content. On a food site the content is the product.
Acceptable, and 1.1 is what makes uploading it possible at all.

---

## 7. ADR draft

# 0027. Blank by default, anything by package

Status: proposed
Date: 2026-08-28

## Context

ADR-0025 settled which of the spec's limits are permanent and which were only a schedule, and
expired §5's deferral of e-commerce. The question that followed was whether Assemora should
learn what an order is. It should not, and that is decided: the moment the framework owns
`Order` it owns discounts, taxes, refunds, delivery zones and a payment integration, which is a
second product.

What replaces it is a stronger claim and a harder one: **any site must be buildable on
Assemora, it stays blank, and a package turns it into what somebody needs.** The test is
literal — `pnpm create assemora`, `pnpm add @example/shop`, one line in `src/app.ts`, and the
result is a working shop, with nothing forked and no file in `node_modules` edited.

`packages/plugin/src/plugin.ts` already has the architecture right: a plugin *is* a module, it
declares through the same builder, and what it adds over a module is provenance. Measured
against the real client design, a kit can already declare almost everything it needs. What is
missing is not expressiveness. It is four things: **Studio has no notion of a verb beyond
create/update/delete**, so a restaurant's `orders.advance` is an MCP tool, an SDK method, a REST
endpoint and an audit row with no button; **four framework namespaces have no owner**, and the
one that grants rather than refuses is permissions, because a role granted `orders.*` for one
kit silently holds another kit's `orders.delete`; **provenance is written into the registry and
read by nobody**, so `installedPlugins()` has zero callers and `ResourceDescriptor` has no
`module` at all; and **no artefact records which version of a package a database was migrated
for**, so the comparison is not unimplemented but inexpressible.

## Decision

**Assemora ships mechanisms, never nouns.** Every extension added under this ADR is a shape
already expressible in a `command()` handler and not expressible in a declaration, or a
namespace with no owner. `Order`, `Cart` and `Product` stay out of `@assemora/*` for ever, and
`pnpm boundaries` is what keeps them out.

**A package declares through the same builder an application declares through, and gets no
second place to declare anything.** No parallel schema, no screen definition file, no
`plugin.json`. If a package wants Studio to draw something it declares it on the resource, and
that same declaration reaches OpenAPI, the SDK and MCP or it does not exist.

**Studio stays a closed, pre-built artifact and becomes registry-driven. The unit a package
contributes is a view of a declared resource, never a screen.** A resource gains `actions`,
`views`, `titleField` and `singleton`; a field gains `control`; `entries.list` gains a filter
grammar. An action carries a **command name**, never a computation — Studio POSTs to a door
`mountCommands()` already opened, which validates and authorizes before anything runs. A
declared button is a suggestion and the command is the authority, and they are allowed to
disagree. What Studio cannot express — a report, a screen over two resources, a control it does
not ship, a wall-mounted kitchen display — belongs to the project's own frontend, which is
already served on the same origin and already carries the same session.

**Invariant 3 is kept by transport, not by rule.** The descriptor reaches Studio as JSON from a
handler that is `() => registry.describe()`. A function does not survive `JSON.stringify`, so a
predicate written into an action is not rejected — it is erased. A `*.test-d.ts` asserting that
every new descriptor type is JSON-safe makes the same guarantee at compile time, which
invariant 3 has never had.

**A field's `kind` stays closed and gains a `control` beside it.** The union's own doc-comment
already made this decision: a kind is a stored shape plus the control that edits it, and `radio`
is not a kind because it is a `select` drawn differently. `spiciness` is an `integer` drawn
differently. Widening the union would propagate a lie to the column, to validation, to OpenAPI
and to the SDK.

**Every declaration carries its module, and one refusal names both claimants.** Kits get an
owner, not a prefix. A prefix makes the URL a fact about npm packaging and makes an agent learn
which package owns a noun before it can name one.

**A kit is a place in the admin, and no kit may add a top-level section to Studio's sidebar.**
Its screens land inside Content under its own name.

**Trust is disclosure, because containment is not available.** A package runs arbitrary
TypeScript on the server by definition, and that is what `command()` is for: it is supervised —
validated, authorized, transacted, revised, audited. Browser code in the admin document is not
supervisable by anything, because there is no bus between a component and the DOM. That
asymmetry is the whole security position: **Assemora supervises what a package does on the
server and therefore lets it run code there; it cannot supervise what a package does in the
admin document, and therefore lets it send only data.**

## Consequences

- A proposal to add a domain noun to `@assemora/*` is answered by this ADR rather than
  re-argued. If commerce is worth building, it is worth building as `@assemora/commerce`,
  published on the same terms as anybody else's kit and declaring through the same builder.
- Studio's build and packaging are untouched. ADR-0022 holds in both directions: a project that
  answered no to §78's third question still installs nothing, and one that answered yes still
  installs one artifact whose contents are identical everywhere — which is also a supply-chain
  property, fixable by upgrading one package.
- Four silent failures become loud ones at `createApplication()`, and they name both modules.
  Some applications that boot today will stop booting, which is the point: each is a namespace
  two things were sharing without either knowing.
- `db:generate` diffs the registry rather than a process global, so a model declared and never
  registered stops silently contributing its table. Nothing in this repository changes
  behaviour; a project that relied on the old reading gets a named warning.
- The declarative surface has a ceiling, and it is felt. "Waiting more than five minutes" is not
  expressible, because it compares a field against a moving value. The answer is that the fact
  becomes a column a command writes — which is more code, and the code is authorized, audited
  and visible to an agent. The ceiling pushes derived state to the right place.
- A kit still cannot draw its own blocks on the site: `createBlockRegistry` is a per-call,
  project-owned object in the project's bundle. "One package, whole site" is true of the data,
  admin, API and agent halves and false of the customer-facing half, and the acceptance test
  fails at exactly that step.

## Alternatives

**Studio becomes a library the project builds** — rejected. It wins the two hard cases outright
and pays everywhere else: every project inherits a React + Tailwind 4 + TanStack build of the
admin, `@assemora/studio` has to publish source it currently does not (one subpath, no `src`,
and `createRoot` at module scope so importing Studio is mounting it), and
`docs/rules/studio.md`'s central rule becomes unenforceable — a screen that computes whether an
order may advance is business logic Studio has and the API does not. It also puts a package's
code in the document holding the session cookie and `can()`.

**Split the surface: Studio owns content, workflows live in the project's frontend** — rejected
as a rival and adopted as a boundary. It cannot do the field control at all, because a field
control is a control on the content-editing form and content editing is the half it keeps
closed. It therefore needs this ADR's descriptor work regardless, which makes the two
complements.

**A `.screens()` facet** — rejected as more machinery for less. A facet name is process-global
and name-unique, so two kits could not both define one; it needs a registry section, a hand edit
to `assemora.describe`'s section list, an entry in the tool generator, a new Studio route and a
new package. Views on a resource need none of them, and every kit screen the client design
actually asks for is a view of a resource or a singleton — five of six, the sixth being
drag-to-reorder, which is a many-row write and is refused on the same grounds as any
drag-to-mutate.

**Prefix every kit's names** — rejected. It makes `/api/orders` a fact about npm packaging, and
it is worse for an agent rather than better. An owner plus one refusal at install time gives a
human the decision with full information, where a prefix makes it for them for ever.

**Widen `FieldKind` so a plugin's kind survives** — rejected, and it is the tempting answer
because the descriptor already erases the name. It propagates a presentational distinction into
the database, validation, OpenAPI and the SDK, and the union's own doc-comment already refused
exactly this for `radio`.

**Let a kit ship migrations** — rejected. One deterministic diff against one committed snapshot,
reviewable as one file in one pull request, is what makes `db:generate` trustworthy. A kit ships
renames as pairs of names and a claim about the version it needs; the project runs the command.
