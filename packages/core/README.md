# `@assemora/core`

Application kernel: modules, container, context, Command Bus, Event Bus, errors.

**Implementation phase:** 1 — implemented.

Core owns the single mutation path of SPEC.md §14 and knows nothing about HTTP or a
database.

```ts
const PublishPage = command('pages.publish', {
  input: { id: uuid() },
  handle: async ({ id }, context) => {
    context.revise({ entityType: 'page', entityId: id, before, after })
    context.emit('page.published', { pageId: id })
    return { id }
  },
})

const app = createApplication({
  modules: [module('pages').commands(PublishPage)],
  authorization: permitAll(), // development only — the default denies everything
})

await app.run({ source: 'mcp', actor: { type: 'agent', id: 'writer' } }, () =>
  app.commands.execute(PublishPage, { id }),
)
```

Validation, authorization, transaction, handler, revisions, events and audit happen
in that order for every caller — Studio, REST, the SDK, the CLI and MCP alike.

Where a stage needs a layer above core, core owns the interface and the other
package registers an implementation (ADR-0008). Authorization defaults to
`denyAll()`: an application with no policy provider refuses every command instead of
running unauthorized.

## Workspace dependencies

- `@assemora/schema`

Dependency direction is fixed in `docs/architecture/package-graph.md` and enforced by
`pnpm boundaries`.
