# What Assemora is

Assemora is a TypeScript framework and a CMS in one piece. You declare what your
project is — models, resources, blocks, routes, policies — and that single set of
declarations becomes the database schema, the runtime validation, the TypeScript
types, the REST API, the OpenAPI document, the typed SDK, the forms in the visual
editor and the tools an AI agent calls. There is no second description of an article
anywhere: adding a column changes all of them at once.

The one architectural fact underneath everything else is that there is **exactly one
mutation path**. Every state change goes through the Command Bus:

```text
Command Bus → validation → authorization → transaction → handler → revision → events → audit → database
```

Studio, REST, the SDK, the CLI and MCP are all callers of that bus. None of them has
business logic of its own, and none of them can shortcut the pipeline. That is why an
agent's write passes exactly the checks a person's click passes, and why "can an agent
do this?" has the same answer as "can this person do this?" without anybody
implementing the question twice.

## Who it is for

- **A developer** who wants an Eloquent-shaped data layer, typed routes and a real
  CMS, without hand-writing a Zod schema, a Drizzle table, a form component, an
  OpenAPI path and an MCP tool that all describe the same field.
- **An editor**, who gets Studio: lists, forms, media, a page builder and a revision
  history — none of it configured, because Studio reads the Schema Registry rather
  than a list somebody maintains.
- **An AI agent**, which gets every registered command and query as an MCP tool, and
  whose mutations are proposals a person applies rather than writes that already
  happened.

## The three callers, and what they share

| | Developer | Editor | Agent |
| --- | --- | --- | --- |
| Reads | `Article.published().take(10)` | Studio lists | `assemora.entries.list` |
| Writes | `commands.execute('entries.create', …)` | a form | `assemora.entries.create` |
| Validation | the same schema | the same schema | the same schema |
| Authorization | permissions, then policies | the same | the same |
| History | a revision | a revision | a revision |

## What it is not

It is not a headless CMS you integrate with, and not a framework you bolt a CMS on
to. The application layer is the product; Studio and MCP are clients of it. That
ordering is deliberate and not reversible — Studio was built after the layer it
drives, so that the editor could never become the thing that defines the backend.

It is also not finished. Nothing is published to npm yet, and the public API is still
free to change. What exists today runs: the framework, Studio, and an agent driving
the same application over MCP.

## Where to look next

- [Getting started](02-getting-started.md) — a project on your machine in five
  minutes.
- [`SPEC.md`](../../SPEC.md) is the product and architecture source of truth.
  [`docs/adr/`](../adr/) records the decisions already taken and why.
