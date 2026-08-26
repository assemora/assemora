# 0006. Package boundaries are machine-checked

Status: accepted
Date: 2026-08-26

## Context

SPEC.md §8 fixes the direction of dependencies and forbids cycles; §125 forbids
Drizzle, Fastify and React from leaking outwards. Written as prose only, such a rule
is broken silently — one `pnpm add` in the wrong package is enough.

## Decision

The dependency graph is expressed as explicit allowed edges in
`scripts/lib/package-graph.ts`. `pnpm boundaries` verifies that:

1. every workspace dependency is an allowed edge;
2. there are no cycles;
3. an implementation library is declared only by its owning package
   (`drizzle-orm` → `database-postgres`, `fastify` → `http`, `react` → `react`);
4. `@assemora/schema` stays dependency-free;
5. `references` in `tsconfig.build.json` match the `package.json` dependencies;
6. the package name matches its directory and a policy exists for it.

Layer rules apply to `dependencies` and `peerDependencies`. `devDependencies` are
checked too, but differently: an implementation library is forbidden there as well —
putting Drizzle in the dev section would be just as much of a leak — while a
workspace package may appear there for tests alone.

The checker also reads the sources. For every `.ts` file under a package's `src`, it
collects the `@assemora/*` packages that are imported and requires them to be both
allowed and declared. Production files obey the layer graph; test files may reach for
a package the production code must not use — an in-memory adapter, say — but only if
the package declares it.

That scan is what makes the rest of the checker trustworthy. A pnpm workspace hoists
packages into a shared `node_modules`, so an import nobody declared still resolves at
runtime, and every package.json-based rule would have passed it in silence.

The checker itself is covered by tests (`scripts/lib/boundaries.test.ts`).

## Consequences

- Changing the architecture becomes a visible act: the policy edit lands in the diff
  and requires a new ADR.
- Adding a package without declaring its policy fails with a clear error.
- The cost is three places per edge (see ADR-0005).

## Alternatives

Prose rules in `docs/rules/` alone — rejected: a rule without a check survives
until the first rush.
