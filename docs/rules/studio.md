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
- A control the handoff draws is drawn by `src/ui/`, never by the browser. A native
  `<input type="checkbox">` tinted with `accent-color` is a different size, radius and
  check mark on every platform — the kit's box is 17px at radius 5 — so `Checkbox`,
  `Switch`, `Radio` and `Segmented` exist and are the only way those four are written.
  `Select` is the deliberate exception, and `Picker` is the one dropdown it cannot be.
- A control's size is one of the three the handoff draws — 36 on a form, 32 in a toolbar
  or panel, 28 in a list row — chosen with a prop, never with a height in a `className`.
  `h-8` on its own changes the height and leaves the padding, the radius and the chevron
  behind, which is how five selects became five slightly different controls.
- Studio says nothing in a language literal. Every word it writes is a key in
  `src/i18n/messages/`, holding every language at once — the compiler refuses a key
  written in one of them (ADR-0030). What the *application* says — a label, a
  description, a refusal — is the application's words and is never translated here.
- The language Studio speaks and the language it edits are two controls. The first is a
  preference of the person reading; the second is `context.locale` and decides which
  rows the screen is about (SPEC.md §131).
