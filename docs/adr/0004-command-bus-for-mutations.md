# 0004. The Command Bus is the only mutation path

Status: accepted
Date: 2026-08-26

## Context

The system has four classes of client: Studio, REST/SDK, the CLI and AI agents. If
each gets its own path to the database, permissions, validation, revisions and audit
drift apart between them. For an agent-native product that is unacceptable: an
agent's action must pass exactly the checks a user's click passes.

## Decision

Every mutation is a Command. There is one path: validation → authorization →
transaction → handler → revision collection → events → audit (SPEC.md §2, §14).
Reads do not go through the Command Bus (SPEC.md §15).

## Consequences

- MCP carries no business logic of its own — it invokes the same commands (SPEC.md
  §68, §76).
- Dry run and change sets become possible: a command can be executed in preview mode
  and its diff shown before it is applied (SPEC.md §73, §74).
- Reversibility of content changes is guaranteed by the path rather than by the
  diligence of each handler.
- The cost is that every mutation needs a command, including small ones.

## Alternatives

A service layer with direct calls — rejected: it offers no single place for
policies, revisions and dry run.
