# @assemora/playground

A real application built on Assemora, and the one Studio is developed against.

It is deliberately small — a model, a resource, three blocks, one hand-written route
and a module — because SPEC.md §99 says an application file should be short enough to
read. If this stops being true, the framework has drifted.

```bash
pnpm --filter @assemora/playground dev
```

It listens on `:4000`, keeps everything in memory, and seeds three articles, a page
and one user on first boot:

```text
ada@assemora.dev
correct horse battery staple
```

What it composes:

| File | What it shows |
| --- | --- |
| `src/blog.ts` | `model()`, `resource()`, `block()`, `route()`, `module()` |
| `src/auth-routes.ts` | The session endpoints Studio expects (ADR-0017) |
| `src/media-routes.ts` | Serving stored files, by path and by library id |
| `src/main.ts` | Ports, modules, and the whole HTTP surface in one screen |
| `src/preview-routes.ts` | Serving this application's own frontend, which the builder canvas renders inside |
| `src/seed.ts` | Content created through commands, not through the database |
| `web/src/views.tsx` | What this application's blocks look like (SPEC.md §57) |
| `web/src/theme.css` | What a design token means here (SPEC.md §61, §62) |

Everything else — CRUD, OpenAPI, the introspection endpoint, policies, revisions,
the command endpoints and the query endpoints — follows from those declarations.

The frontend bundle is built by `pnpm --filter @assemora/playground build` and served
at `/api/preview`. Studio's builder canvas is an iframe pointed at it, which is what
makes the preview the real thing rather than an imitation (SPEC.md §59).
