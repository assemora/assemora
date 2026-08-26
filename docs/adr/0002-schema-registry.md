# 0002. The Schema Registry as the single source of descriptions

Status: accepted
Date: 2026-08-26

## Context

The same entity gets described in six places: the TypeScript type, runtime
validation, the database schema, the Studio form, the OpenAPI schema and the MCP
tool schema. Keeping those in sync by hand is the primary source of drift in CMS
frameworks.

## Decision

A single declaration (`model()`, `resource()`, `block()`, `route()`) registers
itself in a central runtime registry. OpenAPI, Studio, the SDK, MCP and validation
read the registry (SPEC.md §42). Duplicate schemas are forbidden (SPEC.md §125.8,
§125.9).

## Consequences

- A new route appears in OpenAPI, the API Explorer and the SDK automatically, which
  is verified by a contract test (SPEC.md §98).
- The registry becomes a critical component: its own data shape needs tests.
- Any subsystem that needs descriptions must read the registry rather than keep a
  copy.

## Alternatives

Swagger-style annotations — rejected (SPEC.md §44): manual duplication that goes
stale silently.
