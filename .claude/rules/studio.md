# Studio rules

Reference: SPEC.md §58–§62, §115, §118, §123.

- Studio is a React SPA and a *client* of the application layer. It never talks to
  the database and never holds business logic the API does not have.
- Every builder operation (add, move, nest, duplicate, remove, edit props, publish,
  undo) maps to a Command. If Studio can do it, an agent can do it through the same
  command.
- Pages are a block tree with stable immutable block IDs — never an HTML blob.
- The canvas renders inside an iframe using the real frontend renderer, for CSS
  isolation and accurate responsive preview.
- v1 ships universal design controls (spacing, width, alignment, background,
  visibility, container width) — not a general CSS editor. Visual specifics stay in
  developer-defined blocks.
- The theme is structured tokens. AI edits tokens; it never emits arbitrary global
  CSS.
- Lists are always paginated. Studio never loads a full resource dataset.
- Concurrency is explicit: mutations carry `expectedVersion` and a conflict returns
  409 rather than silently overwriting someone's newer change.
