# 0012. How the resource layer is shaped

Status: accepted
Date: 2026-08-26

## Context

Phase 4 (SPEC.md §111) adds static resources, dynamic resources, the field registry,
CRUD commands, filtering and pagination. Four questions had to be settled, and each
one is visible from outside the package.

## Decision

**One set of CRUD commands, not one per resource.** `entries.create`,
`entries.update` and `entries.delete` take the resource by name. SPEC.md §70 gives
MCP exactly that shape (`assemora.entries.create`), and §14 names the commands the
same way. Per-resource commands would multiply the registry by three for every
collection and give an agent a different vocabulary from Studio's.

**Reads go through the resource; writes go only through the commands.** `list()` and
`find()` are ordinary reads and never touch the Command Bus (SPEC.md §15). Writing
is reachable only through the commands, and the persistence side of a resource sits
behind a symbol (`PERSISTENCE`) so that bypassing the one mutation path is a visible,
deliberate act rather than an autocomplete away (SPEC.md §2).

**A list query is untrusted input.** Filters, sort and search arrive from a URL, a
form or an agent. Every field they name is checked against what the resource declared
— `filterable()`, `sortable()`, `searchable()` — and the value is parsed by the
field's own schema before anything reaches the query builder. An unknown or
undeclared field is a `VALIDATION_ERROR`, never a query. Page size is capped, because
Studio must never be able to ask for the whole dataset (SPEC.md §89).

**A dynamic definition is declarative data, and its field kinds are a registry.**
A stored definition is parsed against a schema that has no place for a function, an
expression or a code string, and every key outside that schema is dropped. The
`kind` it names must be registered in the field registry, which is also the extension
point plugins use (SPEC.md §39). There is therefore no path from stored data to
executable code, which is what SPEC.md §86 asks for.

**A resource field must be a column of its model.** `ResourceFieldMap<F>` is keyed by
the model's field names, so a field for a column that does not exist is a TypeScript
error. A resource presents a model; it does not invent data.

**A read returns the resource, not the row behind it.** `list()` and `find()` project
each entry down to the fields the resource declared, minus anything marked
`hidden()`, plus the identifier. Returning the model row exposed columns the resource
never mentioned — a password hash sits one careless serializer away (SPEC.md §28,
§35). `hidden()` carries a literal type marker, so the field is absent from the
record type as well as from the output; a guarantee that only holds at runtime is
half a guarantee.

## Consequences

- MCP in phase 9 gets its entry tools for free: they are the same three commands.
- Adding a field kind is `registerFieldKind`, and it immediately becomes available to
  dynamic definitions, to Studio and to OpenAPI.
- Dynamic entries sort by their own columns (`createdAt`, `updatedAt`, `publishedAt`,
  `status`) only. Sorting by a key inside the JSONB document needs an ordering term
  in the Query AST, which is not there yet.
- Optimistic concurrency (SPEC.md §66) is not enforced yet: `version` is stored and
  incremented, but no mutation carries `expectedVersion`. That arrives with pages in
  phase 7, where the conflict actually matters.
- `list()` is `async` even though its validation is synchronous, so a rejected query
  arrives as a rejected promise rather than as a throw a `.catch()` would miss.

## Alternatives

Per-resource commands (`articles.create`) — rejected: it contradicts §70 and gives
agents a vocabulary that grows with the content model. Letting resources write
directly — rejected against §2.
