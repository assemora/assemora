# 0025. What the spec forbids for ever, and what it only postponed

Status: accepted
Date: 2026-08-28

## Context

Every section of SPEC.md is implemented. The question that follows is the right one
to ask: why would anybody want a CMS that limits them?

The premise is half true, and the half that is false matters more than the half that
is true — so both halves are written down here, because "the spec limits us" will be
said again, and next time it should be answered from a decision rather than from an
argument.

SPEC.md §5 is titled "Not part of v1" and its first line is *"Do not implement before
v1 is complete"*. That is a schedule. It has been read as doctrine because the list is
long and the heading is blunt, and because for ten phases the difference did not
matter.

Meanwhile the spec's real limitation was never §5. It was silence: localisation,
taxonomy, navigation, forms and site-wide singletons are not forbidden anywhere. They
are simply absent, and they are what actually stops somebody building an ordinary
commercial site today. `AssemoraContext` has carried a `locale` since phase 1 and
nothing has ever read it.

## Decision

**Four invariants are permanent and are not open to revision.** They are the product,
not restrictions on it:

1. **A page is a block tree, never an HTML blob** (§53). What can be undone, diffed,
   restored and reasoned about by an agent is structure. An HTML blob is none of
   those things.
2. **The theme is tokens; nothing anywhere accepts CSS** (§61, §62). Not from a
   person, not from an agent. A control that takes a length, a colour or a class name
   is the CSS editor arriving through a side door.
3. **A resource definition is declarative data** (§86). No `eval`, no `new Function`,
   no expression evaluated at runtime, in any field kind ever added.
4. **Every mutation goes through the Command Bus** (§2, §14). One path, validated,
   authorized, transacted, revised and audited — for Studio, REST, the SDK, the CLI
   and an agent alike.

The reason is one sentence from §1: *"Assemora must not be yet another headless CMS
or visual page builder."* An agent can be trusted with a site **because** the surface
is constrained. Remove these four and what is left is WordPress with a language model
attached — which is what the rest of the industry is shipping, and what nobody has
made safe. These four are what the customer is buying, and describing them as limits
on the customer gets the product backwards.

**The rest of §5 has expired, by its own terms.** v1 is complete, so multi-site,
multitenancy, e-commerce, a workflow builder, realtime collaboration, an animation
editor, a Figma importer and payments are now ordinary product decisions, to be
argued on merit and sequenced like anything else. §5 is amended to say so rather than
being deleted: the list was right when it was written, and the reason it was right is
worth keeping.

**The spec grows the sections it never had.** Localisation, taxonomy, navigation,
forms and singletons are added as numbered sections, in the same voice as the rest,
before any of them is built. A capability that arrives without a section arrives
without a contract, and the Schema Registry only works because every subsystem reads
one description rather than keeping its own.

**Three fixed lists stop being fixed**, because they defend nothing:

- §39's fifteen field kinds. §39 itself says the field API is extensible through the
  Plugin API; the list is what shipped, not a ceiling. It is now described as such.
- §77's twenty-two CLI commands. The queue worker of §82 had nowhere to live, and the
  answer was to keep it out of the CLI rather than to admit a twenty-third.
- §61's seven universal controls. "Do not build a full CSS editor" is the rule; seven
  is a count, and it does not enforce the rule.

## Consequences

- A proposal to add arbitrary CSS, free positioning, cursors or an HTML page body is
  answered by this ADR rather than re-argued. If one of the four ever has to change,
  it changes here first, in a new ADR that says what replaces it.
- §5 no longer refuses anything on its own. It records which decisions were deferred
  and why, and each now needs its own argument to proceed — which is more work per
  feature, and the right amount.
- The spec gets longer before the product does. That is deliberate: the alternative
  is five capabilities each inventing their own storage, their own permissions and
  their own agent surface.

## Alternatives

**Delete §5** — rejected. The reasoning in it is why v1 finished at all, and a list of
things that were deliberately not built is worth more than the absence of one.

**Rewrite the spec** — rejected, and it is the tempting answer. Its value is not the
restrictions; it is that one document is the source of truth that OpenAPI, Studio, the
SDK, MCP and every review are checked against. Replacing a spec that limits with no
spec at all trades a bounded problem for an unbounded one.

**Leave the silence and build anyway** — rejected. That is how localisation would
become five incompatible answers: one in the data layer, one in pages, one in Studio,
one in the SDK and one an agent cannot see.
