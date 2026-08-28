# Starters

Phase 10 (SPEC.md §117, §79).

Each is a real workspace package, so CI compiles the template rather than trusting it
(ADR-0021), and `create-assemora` copies the directory as it stands. The one-line
description `--help` prints for each is in its `template.json`.

- `bare/` — the default: the whole application with nothing declared in it. No frontend
  framework; Vite serves the site bundle.
- `blog/` — `bare` with a worked example already in place: an `Article`, its resource,
  two block types with their views, and a published page. `--template blog`.
- `nextjs/` — application starter on Next.js, with the same worked example.
