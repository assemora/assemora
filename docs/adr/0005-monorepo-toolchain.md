# 0005. Monorepo toolchain

Status: accepted
Date: 2026-08-26

## Context

Phase 0 (SPEC.md §107) requires a workspace, Turborepo, TypeScript configuration,
lint, formatting, Vitest and a working package build pipeline. The stack in §6 is
only partly fixed: it names neither the package builder nor the linter.

## Decision

- **Build with `tsc` project references** (`tsconfig.build.json` per package), no
  bundler. Packages ship as ESM libraries, where a bundler adds nothing but another
  dependency, and references make the compiler check dependency direction alongside
  `pnpm boundaries`.
- **TypeScript 7** (the native compiler). Verified during phase 0: composite builds,
  `declaration`, `declarationMap` and inference-heavy DSL all work.
- **Biome 2** instead of ESLint + Prettier: one tool for formatting and linting, and
  the §91 style (single quotes, no semicolons, trailing commas, 2 spaces) is fully
  expressible in configuration.
- **Vitest 4** for runtime and type-level tests (`--typecheck` covers §94).
- **Turborepo** orchestrates per-package `build` and `typecheck`; tests run in a
  single pass from the root.
- Node 24 executes `.ts` directly via type stripping, so tooling scripts are written
  in TypeScript with no separate build.

## Consequences

- Relative imports inside a package use the `.js` extension (`nodenext` resolution).
- A new dependency between packages requires three edits: `package.json`,
  `references` in `tsconfig.build.json`, and the policy in
  `scripts/lib/package-graph.ts`. Any disagreement fails `pnpm boundaries`.
- Building all 17 packages takes seconds and is cached by Turborepo.

## Alternatives

tsup/tsdown/unbuild — rejected at phase 0 as an unnecessary dependency. Revisit if a
bundling requirement appears, for example a browser build of `@assemora/sdk` or
`@assemora/react`.
