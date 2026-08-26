# 0016. Pages as trees, and the way back from any edit

Status: accepted
Date: 2026-08-26

## Context

Phase 7 (SPEC.md §114) adds pages, the block registry, the block tree, drafts,
publishing, revisions, restore and optimistic concurrency. Four of those touch the
architecture rather than only the feature set.

## Decision

**The block tree types live in `@assemora/schema`.** The dependency graph review
before phase 1 said they would have to, and here is where it matters:
`@assemora/react` depends on `schema` and on nothing else, so a renderer that could
only get `BlockNode` from `@assemora/pages` would drag the whole server layer into a
browser bundle. `pages` owns behaviour — drafts, publishing, commands — and `schema`
owns the shape of the data.

**Every tree edit is a pure function.** `addBlock`, `moveBlock`, `removeBlock`,
`duplicateBlock`, `updateBlockProps` and `setBlockHidden` take a tree and return the
next one, refusing anything the block declarations forbid. The commands are thin
wrappers that load the page, apply one of them, and commit. That is what will let a
dry run compute a change set without writing anything (SPEC.md §73), and it is why
the nesting rules of §56 are enforced in one place rather than in each caller.

**A version may be stated, and stating it is what makes a conflict visible.**
`expectedVersion` is optional. A mutation that carries it and finds a different
version answers 409 with both numbers, so a client can reload and retry
(SPEC.md §66). A mutation without it is a deliberate blind write — Studio always
sends one, because two editors on one page is exactly the case §66 exists for.

**The restorer registry lives in `core`, beside the other ports.**
`@assemora/revisions` knows what changed but not how to write a page back, and
`@assemora/pages` may not depend on it (SPEC.md §8). So the seam sits with the ports
of ADR-0008: whoever owns an entity registers how to restore it, and `revisions`
calls that without learning what a page is. An entity nobody registered answers
`NOT_RESTORABLE` rather than failing obscurely.

**Restoring is a command.** It passes policies, runs in a transaction and leaves a
revision of its own, recording which revision it came from. Undoing is not a way
around the pipeline.

## Consequences

- A page is never HTML, at any point, in any column (SPEC.md §125.14). A test puts a
  `<script>` tag in a block prop and shows it stays a prop.
- A block id is generated once and never reused. Duplicating a block gives new ids to
  the whole subtree, so no two blocks in a tree can share one.
- Revisions store a field-level patch alongside the two snapshots, because "spacing:
  xl → md" is what a person reads and what a change set diff will be built from
  (SPEC.md §75).
- `@assemora/media` ships the storage interface and a local disk driver. The
  S3-compatible driver of §63 needs a signing client and credential handling that
  belong with deployment, and arrives with the CLI in phase 10. The local driver
  refuses a path that climbs out of its root, because a filename comes from an upload.

## Alternatives

Keeping the block tree types in `@assemora/pages` — rejected: it would put the server
layer in every browser bundle that renders a page. Letting `revisions` import the
packages it restores — rejected against §8. Making `expectedVersion` mandatory —
rejected: a script that creates a page and immediately edits it has no reason to read
a version it just caused.
