## What this changes, and why it had to

<!--
Write it for someone reading in a year with no memory of the discussion. If the
decision was contested, say what the alternative was and why it lost.
-->

## Before merging

- [ ] `pnpm verify` passes
- [ ] One logically complete change — no refactor, feature and reformat in the same commit
- [ ] Everything is in English: code, comments, identifiers, tests, commit messages

If this touches a **public API**:

- [ ] Runtime tests
- [ ] Type inference tests in `*.test-d.ts`
- [ ] Invalid usage asserted with `@ts-expect-error`, so a regression that makes bad code compile fails the suite
- [ ] A documentation example that actually compiles

If this touches **architecture**:

- [ ] Mutations still go through the Command Bus, and policies still run
- [ ] Reads still go through the Query Bus and cause no side effects
- [ ] No new dependency edge between packages — or the edge is declared in `scripts/lib/package-graph.ts` **and** an ADR explains it
- [ ] No implementation library (Drizzle, Fastify, React) leaked outside the package that owns it, or into a public signature
- [ ] No second schema for a subsystem: the Schema Registry is still the single source

<!--
SPEC.md §125 lists what Assemora will not do. If this needs one of those broken,
say so here plainly rather than hoping it is not noticed.
-->
