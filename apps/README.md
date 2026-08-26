# Applications

These directories are created on their own phases (SPEC.md §115, §117) and stay
empty until then — pnpm ignores them while they have no `package.json`.

- `studio/` — the Studio React SPA, phase 8.
- `playground/` — a surface for exercising the API by hand, phase 8.
- `docs/` — documentation site, phase 10.

Studio is a client of a stable application layer. Starting development there is
forbidden (SPEC.md §118).
