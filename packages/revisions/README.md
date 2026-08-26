# `@assemora/revisions`

Revisions, restore, audit log.

**Implementation phase:** 7 — implemented.

Core collects a revision inside the command's transaction (ADR-0008); this package
stores it, diffs it and puts it back. Registering `revisions()` is what makes
`discardRevisions()` unnecessary and what turns SPEC.md §3.6 — any content mutation
is reversible — from an aspiration into a property of the pipeline.

A revision keeps both snapshots and a field-level patch, because "spacing: xl → md"
is what a person reads and what a change set diff will be built from (SPEC.md §75).

Restoring is itself a command: it passes policies, runs in a transaction, and leaves
a revision recording which one it came from. How an entity is written back is
registered by whoever owns it — the seam lives in `@assemora/core`, so this package
never learns what a page is.

## Workspace dependencies

- `@assemora/schema`
- `@assemora/core`
- `@assemora/data`
