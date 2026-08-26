# 0007. Scope of automatic hooks

Status: accepted
Date: 2026-08-26

## Context

SPEC.md §104 requires deterministic hooks: a formatter after TypeScript files
change; lint, typecheck and targeted tests before a significant task completes; and
a full test plus build before a milestone completes.

An earlier version of this ADR narrowed the task gate to boundaries and lint and
moved typecheck and tests into the `pnpm verify` command, arguing that a full gate
costs seconds on every turn. Review measured the actual cost — a warm gate runs in
roughly one and a half seconds — and pointed out the deeper problem: SPEC.md is the
source of truth, so an ADR cannot narrow a requirement it dislikes. That version is
withdrawn.

## Decision

**PostToolUse (`Write`/`Edit`) formats one file.** The hook reads
`tool_input.file_path` from its stdin payload, exits immediately unless the path is
`.ts` or `.tsx`, and runs `biome format --write` on that single file. It does not
run `biome check --write`, so it applies no lint fixes, and it does not touch the
rest of the tree — a repository-wide reformat would pull unrelated files into the
current task's diff, which §106 forbids.

**Stop runs the task gate:** `pnpm boundaries && pnpm lint && pnpm typecheck &&
pnpm test`. Biome does not type-check, so without the typecheck step a type error
passes the gate silently.

The gate reads `stop_hook_active` from its stdin payload and exits 0 when it is
already set. Without that guard, a failure the model cannot fix — a broken file
outside the current task, for instance — turns "Stop → block → Stop" into a loop
with no exit condition.

**The milestone gate stays a command.** `pnpm verify` adds the build to the same
chain. Claude Code exposes no milestone event, so there is nothing to attach a hook
to; CLAUDE.md mandates the command at phase boundaries instead. This is a limitation
of the harness, not a preference.

## Consequences

- A boundary violation, a style violation, a type error or a failing test cannot
  survive the end of a turn unnoticed.
- The gate currently runs the whole suite because the whole suite is the targeted
  set — 32 tests in about a second. Once the suite grows past a few seconds, switch
  the gate to `vitest related` over the changed files and keep the full run in
  `pnpm verify`.
- The formatter no longer silently repairs files the current task did not touch.
  Such a file now fails the gate loudly, which is the intended behaviour.

## Alternatives

Leaving typecheck and tests to a prose instruction in CLAUDE.md — withdrawn: an
instruction is not a deterministic hook, and §104 asks for a hook.
