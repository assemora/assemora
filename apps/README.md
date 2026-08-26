# Applications

- `studio/` — Studio, the visual application (SPEC.md §58). A React SPA and a client
  of the application layer: it holds no business logic the API does not have, and it
  never reaches past the API to the database. It is also published, so a generated
  project can serve it at `/studio` beside its own API.
- `playground/` — a running Assemora application, and the surface Studio is developed
  against. Three files, because `assemora()` owns the wiring now (ADR-0022).
- `docs/` — the documentation site. It renders the Markdown in `docs/guide/`.

Studio is a client of a stable application layer. Starting development there is
forbidden (SPEC.md §118).
