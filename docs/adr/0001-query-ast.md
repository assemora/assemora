# 0001. Query AST as the internal contract

Status: accepted
Date: 2026-08-26

## Context

The query builder could construct Drizzle queries directly — shorter to write and
faster to ship. But then four subsystems lose their shared language: the policy
layer cannot constrain a query, the AI layer cannot express intent except as SQL,
and swapping the database adapter means rewriting the builder.

## Decision

The query builder produces a framework-neutral Query AST (SPEC.md §30). The
database adapter is the only component that turns the AST into a concrete dialect.
Nothing bypasses the AST to reach an adapter.

## Consequences

- The policy layer operates on the AST and can add constraints before execution.
- AI expresses selection as structure rather than a SQL string (SPEC.md §85 forbids
  arbitrary SQL for agents).
- An extra translation layer appears, and the AST needs tests independent of the
  adapter (SPEC.md §93).
- Adding or replacing a database engine does not touch the public API.

## Alternatives

Generating Drizzle queries directly — rejected: it makes Drizzle the de facto public
contract and closes the door on the policy and AI layers.
