# The Assemora guide

A path through the framework, in order. Each page says what the thing is, gives the
smallest example that is real, names the two or three decisions a reader would
otherwise get wrong, and points at where to look next.

It is not a reference. `SPEC.md` is the source of truth for what Assemora is meant to
be, `docs/adr/` records the decisions already taken, and each package's own README is
the detail behind the page that mentions it.

| | |
| --- | --- |
| [1. What Assemora is](01-what-assemora-is.md) | One application layer for developers, editors and agents, and who it is for |
| [2. Getting started](02-getting-started.md) | `pnpm create assemora`, and the first five minutes |
| [3. Models](03-models.md) | `model()`, the column DSL, relations, scopes |
| [4. Querying](04-querying.md) | The query builder, the Query AST, transactions |
| [5. Resources](05-resources.md) | `resource()`, fields, and what Studio does with them |
| [6. Commands and queries](06-commands-and-queries.md) | The Command Bus, the single mutation path, policies |
| [7. Pages and blocks](07-pages-and-blocks.md) | `block()`, the tree, the builder, the renderer |
| [8. Authentication and authorization](08-authentication.md) | Users, roles, permissions, policies, tokens, agents |
| [9. HTTP and the SDK](09-http-and-the-sdk.md) | `route()`, generated CRUD, OpenAPI, the SDK |
| [10. Agents and MCP](10-agents-and-mcp.md) | The tools, dry run, change sets, the audit log |
| [11. The CLI](11-the-cli.md) | The commands, `assemora.config.ts`, migrations |
| [12. Deploying](12-deploying.md) | The database, storage, the security defaults |
| [13. Jobs](13-jobs.md) | `job()`, `dispatch()`, the queue adapter, the worker process |
| [14. The theme](14-theme.md) | Tokens, the five groups, the generated stylesheet, the Design section |

## Reading it in less than fourteen pages

- **"Is this for me?"** — [1](01-what-assemora-is.md), then
  [2](02-getting-started.md).
- **"I want to model some data."** — [3](03-models.md), [4](04-querying.md),
  [5](05-resources.md).
- **"I want to change something safely."** —
  [6](06-commands-and-queries.md), then [8](08-authentication.md).
- **"I want a page builder."** — [7](07-pages-and-blocks.md), with
  [5](05-resources.md) for the field kinds a block uses.
- **"I want it to look like us."** — [14](14-theme.md), then [7](07-pages-and-blocks.md)
  for the controls that spend the tokens it defines.
- **"I want an agent to edit my site."** — [10](10-agents-and-mcp.md), and
  [6](06-commands-and-queries.md) for the pipeline it goes through.
- **"I want work to happen after the response."** — [13](13-jobs.md), with
  [6](06-commands-and-queries.md) for the commit it waits for.
- **"I want to put this somewhere."** — [11](11-the-cli.md), [12](12-deploying.md).

## The code this guide is written against

- `starters/bare/` — the project `pnpm create assemora` writes, with every decision
  commented in place.
- `examples/blog/` — relations, scopes, and a policy that lets an author edit their own
  article and nobody else's.
- `examples/company/` — the block tree, nesting rules, the universal design controls, and
  a theme set by a command rather than written as CSS.
- `apps/playground/` — the reference application Studio is developed against.
