# 0027. The framework ships mechanisms, a package ships nouns

Status: accepted
Date: 2026-08-28

## Context

A real client design was measured against Assemora: a food delivery service, seven
finished screens, a PWA manifest and a menu of a hundred dishes. The customer-facing
half turned out to be expressible today — models, resources, commands, queries, routes,
blocks and policies reach far enough. What it exposed instead was the question ADR-0025
left open when it expired §5's deferral of e-commerce: **should Assemora learn what an
order is?**

The answer is no, and it is settled here so that it is not re-argued. What replaces it
is a stronger requirement, and it is now the product:

> Any site must be buildable on Assemora. It stays blank, and a **package** turns it
> into what somebody needs.

`packages/plugin/src/plugin.ts` already contains the architecture for this, in its first
paragraph: *"A plugin **is** a module. It declares resources, blocks, routes and commands
with the same builder … so there is nothing a plugin can do that an application could not
have written itself."* What a plugin adds over a module is provenance. `WIRING` at
`plugin.ts:74` already counts a facet this package has never heard of as a contribution,
so the mechanism for growing exists. What is missing is what can be grown.

The question therefore has a precise form: **which facets must `module()` gain, so that a
site kit is a package rather than a fork?**

## Decision

**Assemora ships mechanisms, never nouns. A package ships nouns, and it ships them by
declaring through the same builder methods an application declares through — so there is
nothing a package can do that a project could not have written itself, and nothing it can
declare that the Schema Registry does not describe.**

The framework's job is to close the gap between what a project can write in TypeScript
and what a package can declare, and nowhere else. Three consequences follow, and they are
what this ADR exists to settle:

1. **The framework never grows `Order`, `Cart` or `Product`,** nor any successor. Those
   belong to a client's package or to a commerce package somebody else publishes, and
   `scripts/lib/package-graph.ts` is what keeps them out of the graph.
2. **A package never gets a second place to declare a thing.** No parallel schema, no
   screen definition file, no `plugin.json`. A package that wants Studio to draw
   something declares it on the resource, and the same declaration reaches OpenAPI, the
   SDK and MCP — or it does not exist. One declaration feeding every subsystem is the
   product; a second declaration surface would trade it away for convenience.
3. **A package never widens a declarative surface.** It may run arbitrary TypeScript in a
   `command()` handler, because a command is validated, authorized, transacted, revised
   and audited. It may not put an expression anywhere a stored definition, a descriptor
   or a registry entry can hold one. The test is that `JSON.stringify` round-trips the
   declaration without losing meaning.

**Studio stays a closed, pre-built artifact and becomes registry-driven. The unit a
package contributes is a view of a declared resource, never a screen.**

The argument is the transport rather than a rule. A descriptor reaches Studio as JSON,
from a handler that is literally `() => registry.describe()`
(`packages/openapi/src/route.ts:63`), and a function does not survive `JSON.stringify`. A
package that wants to give Studio behaviour has nowhere to put it: a predicate written
into a declared action is not rejected, it is erased. Unexpressible is a stronger
guarantee than forbidden, and it is the same argument ADR-0022 made when it refused
Studio a hard dependency.

The ceiling this draws is real and is accepted. A view can express a filter, a refresh
interval, a set of actions gated on a field's value, a picker, and a grouping. It cannot
express "waiting more than five minutes", because that compares a field against a moving
value and there is no shape for it that is not an expression. The answer is that such a
fact becomes a **column**, written by a job the package already declares — which pushes
derived state out of a template and into a command, where it is validated, authorized,
transacted, audited and visible to an agent. The bound is doing its job.

**A field kind stays closed; a package draws its field differently through `control`.**
A kind registered through `registerFieldKind` is already erased by the time it reaches a
descriptor — `registerFieldKind('spiciness', () => integer())` describes as `integer`,
and forging it fails because modifiers rebuild from closed-over state
(`packages/resources/src/fields.ts:196-210`) and the only constructor that sets `kind` is
module-private. The union's own doc-comment had already decided this: *"A kind is a
stored shape plus the control that edits it. Two names for one shape is how a schema
starts lying"* (`fields.ts:30-35`). `spiciness` is an `integer` drawn differently,
exactly as `radio` is a `select` drawn differently.

**A policy may only be declared for a subject the declaring module owns**, and policies
belong in the Schema Registry. This is a safety precondition of everything above rather
than a feature: see the first consequence below.

## Consequences

**A package can open the application, today, and nothing says so.** `registerPolicy`
refuses only a duplicate (`packages/auth/src/policies.ts:56-60`), writes nothing to the
Schema Registry, and is first-come-first-served; `authorize` grants on **permission OR
policy** (`packages/auth/src/authorization.ts:74-80`), so a policy is an alternative
grant rather than a second gate; and no module anywhere registers a policy for `pages`,
so the name is free. Twelve lines in an installed package —
`policy('pages', { create: () => true, publish: () => true })` — make `pages.create` and
`pages.publish` succeed for a caller with no credential at all, while `/api/auth/me`
answers 401. Measured.

The rule is *"a subject the declaring module does not own"*, not *"a subject no module
declares"* — the second does not catch it, because `pages` **is** declared, by
`@assemora/pages`. Two things follow that are worth having regardless: an application's
access control is currently not describable, which contradicts the single-source rule,
and `assemora plugins` should be able to print what a package's policies grant before
somebody runs it.

Severity today is low, because nothing is published and every module is first-party. It
becomes critical on the day a package is installable, which is the day this ADR is for.

> **Amended — the precondition is met.** Both halves are built.
> `packages/auth/src/ownership.ts` holds the rule, and an application that breaks it
> refuses to boot naming the module, the subject and what would have had to be true.
>
> *Owning a subject* is two things a module already says out loud. **Its own name as a
> namespace**: `module('pages')` owns `pages` and `pages.drafts`, which is what every
> framework module relies on and where the module name *is* the domain. **A model or a
> resource it registered**: an application's module is named after the area rather than
> the table, so `module('blog').models(Article).resources(Articles)` owns `articles` and
> would own nothing at all under a name-only rule.
>
> The second half needed a fact the registry did not keep. An entry said what a thing was
> and nothing about where it came from, so `SchemaRegistry` gained `registeredBy` and
> `forModule`: the application hands each module a view of the registry that records the
> module's name without the module being asked and without it being able to give another.
> That attribution is general rather than policy-specific. It is not the whole of 0.1 in
> `docs/architecture/site-kits.md`: the registry can now *answer* who registered a
> resource, and whether `ResourceDescriptor` should also carry the name as a field — so
> that `describe()` and Studio read it without a second lookup — is still open.
>
> **The application is the exemption, deliberately.** `auth({ policies })` is written at
> the composition root by whoever assembled the modules, so it speaks for the whole
> application and is held to no ownership rule; a policy over somebody else's subject is
> a decision the application is entitled to make and a package is not. It is described
> with no `module`, which is what "not a package" has looked like since the section
> existed. `registerPolicy` keeps its place as a test harness seam and lost its module
> parameter: the attributed form is not exported, so a caller outside `@assemora/auth`
> cannot claim to be `pages`, and an unattributed policy is refused at boot.
>
> **The check runs at boot, not at registration**, and that is not a detail. Ownership is
> decided against what a module *registered*, and a facet runs in the order the builder
> was written — `.policies(P).resources(Articles)` would be refused and
> `.resources(Articles).policies(P)` allowed, for one declaration. By boot every module
> has registered everything.
>
> **It is not a sandbox.** One process, and a package determined to grant itself access
> can patch past any of this. What it removes is the casual case, which is the one that
> happens: self-granting now requires impersonating a module, and impersonation reads as
> impersonation in a diff.

**Namespacing is forced, and should be chosen rather than discovered.** Two packages
declaring `resource(…, { name: 'orders' })` fail with a stack trace naming neither module
and offering no remedy, during module registration — earlier than any end-of-boot check
could run. Renaming the resource is not enough: both then declare `policy('orders', …)`
because the second's own command is `orders.refund`, and under the rule above the second
package cannot declare a policy for its own command unless it renames the command. The
rules therefore force command-name namespacing anyway. Prefixing arrives whether or not
it is designed; designing it is the cheaper path.

**The permission namespace is the one collision that grants rather than refuses.** A
package declaring `resource('orders')` and another declaring `command('orders.refund')`
both install cleanly, and a role granted `orders.*` so somebody can manage a catalogue
holds the refund. Assemora already has the check — `refusePermissionSubject`
(`packages/resources/src/collections.ts:209-217`) — and runs it on exactly one path,
`collections.create`. The check exists for a name somebody types into Studio and not for
one that arrives by `pnpm add`.

**Studio's security advantage over a library-shaped Studio is currently zero, and has to
be earned.** `apps/studio/src/builder/canvas.tsx:371` frames `/preview` same-origin with
no `sandbox` attribute, a package's block views run there, the CSRF cookie is
`httpOnly: false` (`packages/assemora/src/auth-routes.ts:65`) at `Path=/`
(`packages/http/src/respond.ts:56`). A package's browser code can already read the
parent's cookies and act as the editor. The decision above stands on packaging and on
`docs/rules/studio.md`; the security half of it is a claim that is not yet true.

**Not every invariant survives contact with a package.** A package's block *view* lives
in the project's own bundle (`packages/react/src/registry.ts:72`,
`starters/bare/app/main.tsx:38`) and can `dangerouslySetInnerHTML` a `richText` prop,
exactly as a project's own view can. Invariant 1 constrains what a page *stores*, not
what a renderer does with it. Saying so here is better than overclaiming the four.

**Provenance is missing where it is most needed.** `packages/resources/src/module.ts:49`
is the only facet registration that does not pass its module's name, so the one registry
section Studio's sidebar is built from is the one with no provenance — and the generated
CRUD routes carry none either.

**The build order is a consequence, not a schedule.** Safety and provenance come before
any facet, because every facet rests on them. `docs/architecture/site-kits.md` carries
the ordered list.

## Alternatives

**Grow `Order` in the framework.** Rejected by the owner of the product, and the reasons
are worth keeping. Three properties recur in every ordering site and none is expressible
today: a cart belonging to somebody who is nobody yet, a total computed server-side and
never trusted from the client, and a state machine with recorded transition times. Those
are the argument *for*. Against: the moment the framework owns `Order` it owns discounts,
taxes, refunds, delivery zones and a payment integration, which is a second product. The
narrow middle — ship the three properties without the noun — is compatible with this ADR
and is where those needs should be met.

**A `.screens()` facet, and a package shipping React into Studio.** Rejected. It needs a
registry section, a hand edit at `packages/mcp/src/queries.ts:74-98` for an agent to see
it, a Studio route it does not own, and a new package to define the facet — and it puts
third-party code in the admin origin deliberately rather than by an oversight that can be
fixed. The reason sometimes given for rejecting it — that two packages could not both
define the facet — is wrong: `defineModuleFacet` checks the definer, not the caller
(`packages/core/src/module.ts:113`), so a facet defined once by a framework package would
work exactly as `.resources()` does. It is rejected on the other four grounds.

**Studio as a library the project builds.** Rejected, but not on security, which it
currently ties on. `apps/studio/package.json` publishes one subpath and no `src`,
`apps/studio/src/main.tsx:29` calls `createRoot` at module scope, and
`apps/studio/src/styles.css:1` is `@import "tailwindcss"` — so it is not a library today
and making it one costs every project a build of the admin, which ADR-0022 declined for
the same reason it declined a hard dependency. Should the sandbox and cookie defects
above go unfixed, this alternative gets stronger, not weaker.

**Widen `FieldKind` so a package's kind name survives.** Rejected: it propagates a lie to
the column, to validation, to OpenAPI and to the SDK, and the union's own doc-comment
already refused it for `radio`.

**Give a package a prefix automatically.** Not rejected, but not decided here. It follows
from the namespacing consequence above and deserves its own ADR, because it changes a
URL, an SDK method name and what an agent calls a tool.
