# 0033. A form's layout is a view, declared or arranged

Status: accepted
Date: 2026-09-05

## Context

Studio drew every entry form the same way: what the entry *is* on the left, what is
*true of* it on the right, decided by the kind of each field (`mainFields` /
`asideFields`). The comment beside that rule said why it was a rule and not a
declaration — a resource descriptor had nowhere to say where a field is drawn, and
inventing one touches the schema layer, the parser, the registry, OpenAPI and MCP.

An administrator wants a long form in tabs, a pair of short fields on one row, the
order the editors think in rather than the order the columns were declared in. An
agent asked to "tidy the order form" wants the same thing, as a command. And
`docs/architecture/site-kits.md` already names the unit a package contributes to Studio:
a *view* of a declared resource, never a screen. This is that view.

## Decision

**A `Layout` in `@assemora/resources`.** Tabs of sections, or sections alone, and the
column beside the form; a section is a key, an optional title, one or two columns and
its fields; a field is its name, or its name and a width. Declarative data with no
function in it, so it reaches Studio as JSON and an agent through `assemora.describe`
(ADR-0027). It says where a field is drawn and nothing about what it is: validation,
OpenAPI, the SDK and the MCP schema read the fields and never the layout.

**Three sources, one section.** A resource may declare a layout —
`resource(…, { layout })`, checked where it is written. `resources.arrange` stores one
in a JSONB row per resource, static or dynamic alike, which wins over the declaration;
`null` puts the declaration back. The registry's `layouts` section carries the
*resolved* layout and its source; a resource with no entry there is drawn the way every
form was before. A section of its own rather than a field on the resource's entry, so
arranging a form never re-registers the resource and nothing derived from that entry —
the generated REST paths — is reconciled for a change that is not about it.

**A layout cannot hide a field.** A field the layout does not name is drawn in a trailing
section. A column added to a model must not vanish from the form for the want of a line
in a layout; hiding is `hidden()` and permissions, and nothing else. The validator
refuses a hidden field placed, a field placed twice, an unknown field, an empty section,
and a key used twice.

**The write is the ordinary write.** `resources.arrange` is one command for every
resource (ADR-0012), validates with the same check a declaration passes, authorizes
`(resource, 'arrange')` so a policy can open one resource's form and not another's,
states `expectedVersion` (SPEC.md §66), and is a revision with a restorer that reaches
back to the declaration. Over MCP it is a tool by generation; in change-set mode an
agent proposes and a person applies.

**Studio draws, and one screen arranges.** The entry form is drawn from the arrangement
by one component; the form screen holds a layout, applies one pure step per click and
shows the same component as a live preview. Its route is `/content/$resource/form`,
reached from the entry's menu.

## Consequences

- The kind-based two columns are now the *derived* layout and stay the default; a
  project that arranges nothing sees exactly what it saw.
- The stored layouts are loaded at boot and tolerate their own table not existing, the
  way collections do (ADR-0021); a row whose fields no longer fit is skipped with a
  warning and kept.
- The block inspector in the page builder has the same anatomy and can take the same
  `layout` later; the list's columns are a second key on the same view. Neither is
  built here.
- In several processes a stored layout reaches the others after a restart — the
  limitation collections already have.

## Alternatives

- **Conditions without a rule for required fields.** Rejected; see the amendment.
- **Layout inside the collection's definition.** Rejected: two places for one thing,
  and a static resource would have had none.
- **Per-role layouts.** Rejected: who sees which field is permissions; a layout is one
  answer per resource.
- **Drag and drop on the live form.** Rejected for the first version: the entry form
  has to stay predictable, and the structured editor beside a preview is what the
  collection builder already does.

## Amendment — a section may be shown on a condition

`visibleWhen` on a section: `{ field, equals }` while a field of the same form holds a
value, `{ field, present: true }` while it holds anything. Data, evaluated by whoever
draws the form against what is typed in it — Studio's `layout/visible.ts` — and never by
the server, which validates the fields whatever is on screen. A hidden section's values
stay in the draft and are saved with it: a layout arranges and does not clear, so
switching a condition off and on loses nothing.

The rule that was deferred is decided the strict way: **a required field may not sit in
a section a condition hides.** The server would refuse the save while the input that
could fix it is hidden, which is a refusal nobody can act on. `layoutIssues()` refuses
it as `required_hidden` where the layout is written or sent. Conditions are for optional
detail — the delivery address when fulfilment is delivery — which is what they were asked
for.

The form screen offers the condition per section: a boolean or a select field is asked
for a value, any other field only whether it is filled in, because a form does not
constrain what a free field holds. Its preview draws a conditional section faded, with
the condition written over it, since nothing in a preview is typed and the section would
otherwise be invisible to the person arranging it. Tabs carry no condition yet.
