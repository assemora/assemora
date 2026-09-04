# 0032. A singleton is one row behind a command

Status: accepted
Date: 2026-09-05

## Context

SPEC.md §135 is one of the five sections ADR-0025 added, and it is three lines long:

> A page there is exactly one of: site settings, the footer, a contact block. The theme
> (§62) is the first singleton and the shape the rest follow — one row, edited through a
> command, revised and restorable like any other content.

ADR-0031 built the settings screen and deliberately gave it no `input` row: a setting a
person changes at run time is a command's input, and until a command existed the
screen described the deployment and offered one preference. This is the command.

What §135 leaves open: where the row lives, whether each singleton is a table, how the
values are validated, how a person edits one, and what an agent is told.

## Decision

**`singleton(name, fields, options)` in `@assemora/resources`.** The fields are the
resource fields — `text()`, `email()`, `richText()`, `image()` — so one declaration
feeds validation, the form, the OpenAPI schema, the SDK type and the MCP tool, which is
the rule every declaration in this framework lives under (SPEC.md §2). A module
registers one with `.singletons()`, beside `.resources()`.

**One table, one row per name.** `assemora_singletons` holds `name`, a JSONB `values`
and a `version`, and this package owns it the way it owns the collections table.
Adding a footer to a site is therefore never a migration — which is what §135's "a page
there is exactly one of" means for a person adding one on a Tuesday. A row that has
never been written is version 0 and empty, the way an unedited theme is.

**Two generic operations, addressed by name.** `singletons.get` and
`singletons.update` serve every singleton (ADR-0012): an application with three has
two tools, not six. The write validates against the declared fields with the same
function `entries.update` uses, refuses fields an agent may not write, asks the record
before writing (ADR-0015), and states `expectedVersion` the way the theme does
(SPEC.md §66) — a caller who read version 3 and writes at version 4 is told, and a
caller who said nothing writes over what is there. Every write is a revision under the
singleton's own name, and a restorer puts the row back — to a snapshot, or to nothing,
which undoing the first write has to reach.

**A singleton is a subject.** `singletons.update` is the permission; `site` is the
subject a policy answers for, and a module may write that policy only for a singleton it
declared, which is the ownership rule of ADR-0027 extended to one more section.

**Studio draws it on the settings screen.** A singleton is a group under **Content**
whose rows are its fields, drawn by the same control every entry form uses, and saved
through the screen's one save bar with the version the screen read. The screen is drawn
from the registry, so a singleton needs no line of Studio — the same claim ADR-0031
made, now with an editable row.

## Consequences

- SPEC.md §135 is built. The theme stays the theme: it was the first singleton and its
  document has structure a JSONB of fields would not carry.
- The settings screen has its first editable rows that reach the server. Nothing else
  about it changed: the registry's `settings` section still has no `input`.
- `assemora.describe` answers with `singletons`, and the field-level agent permissions
  of SPEC.md §76 apply to them by the same function.

## Alternatives

- **A table per singleton.** Rejected: it makes a footer a migration, and there is
  nothing to query across rows that would justify a column per field.
- **An `input` row kind in the settings section.** Rejected in ADR-0031 and again here:
  the fields already exist as a declaration, and a second declaration of the same fields
  as rows would drift.
- **Rebuilding the theme on this.** Rejected: the theme's document is five groups with
  fixed keys and per-kind validation, which is more than a field map, and it is already
  the shape §135 asks for.
