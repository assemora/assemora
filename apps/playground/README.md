# @assemora/playground

A real application built on Assemora, and the one Studio is developed against.

It is deliberately small — a model, a resource, three blocks, one hand-written route
and a module — because SPEC.md §99 says an application file should be short enough to
read. If this stops being true, the framework has drifted.

```bash
pnpm --filter @assemora/playground dev
```

It listens on `:4000`, keeps everything in memory, and seeds three articles, two pages
and two users on first boot:

```text
ada@assemora.dev
correct horse battery staple
```

What it composes:

| File | What it shows |
| --- | --- |
| `src/blog.ts` | `model()`, `resource()`, `block()`, `route()`, `module()` |
| `src/main.ts` | `assemora()`: the whole application in one call (SPEC.md §9) |
| `src/seed.ts` | Content created through commands, not through the database |
| `web/src/views.tsx` | What this application's blocks look like (SPEC.md §57) |
| `web/src/theme.css` | What a design token means here (SPEC.md §61, §62) |

Everything else — CRUD, OpenAPI, the introspection endpoint, the session endpoints,
the media URLs, the MCP endpoint, policies, revisions, the audit log, the command
endpoints and the query endpoints — is wiring the `assemora` package owns (ADR-0022).
This application used to declare it by hand, and every generated project would have
carried the same copy.

The frontend bundle is built by `pnpm --filter @assemora/playground build` and served
at `/preview` — at the origin root, beside the API rather than inside it, because a
bundle is not an endpoint. Studio's builder canvas is an iframe pointed at it, which
is what makes the preview the real thing rather than an imitation (SPEC.md §59).

Two things a deployed project would not do, and why this one does:

- It names `http://localhost:5173` as an allowed origin and as an allowed framer.
  Studio has its own dev server here; a deployed project serves Studio beside its API
  on one origin and names nothing.
- It does not serve Studio itself. `assemora({ studio: true })` serves a *built*
  bundle, and the point of this application is the Studio being rebuilt next to it.
