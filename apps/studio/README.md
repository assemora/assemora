# @assemora/studio

Studio: a React SPA and a client of the application layer (SPEC.md §58).

```bash
pnpm --filter @assemora/playground dev   # the API, on :4000
pnpm --filter @assemora/studio dev       # Studio, on :5173
```

Vite proxies `/api` to the application, so the session cookie is first-party in
development exactly as it is in production.

## What is built

All of SPEC.md §115: login, navigation, resource CRUD, media, the API Explorer,
pages, the block builder, revision history, users, the developer section — and Design,
the five groups of theme tokens of SPEC.md §62.

The builder's canvas is an iframe running the *application's* frontend — the real
renderer, its block views, its theme (SPEC.md §59). Studio sends the tree in and gets
geometry and clicks back, and draws its selection outline over the frame, so nothing
it does changes what the page looks like.

## The rule that shapes everything here

Studio holds no knowledge of any particular application. It asks
`/api/_introspection` what exists and renders that:

- the navigation's collections are the registry's resources
- a table's columns, its search box and its sort options are the resource's fields
- a form is the field list, one input per `kind`
- the API Explorer is the registry's routes, with their real schemas
- the builder's block palette is the registry's blocks, with their nesting rules
- a block's properties panel is its own fields, drawn by the same inputs as a resource
  form — plus the seven universal design controls every block has (SPEC.md §61)
- the backgrounds those controls offer are the colours the generated stylesheet
  declares — a public artefact, so a person who may edit a block's design needs no
  permission over the theme — and Design is the five groups of the document that
  stylesheet is rendered from: Studio decides what no token means (SPEC.md §62)

So a `resource()` or a `block()` added to an application appears here with no Studio
change at all. Every write goes to a command through the API — never to the database,
and never past a policy (SPEC.md §14, §58). That includes every builder operation:
undo and redo are `revisions.undo` and `revisions.redo`, and an agent can call them.
