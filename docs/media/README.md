# Screenshots

These are generated, not drawn, and they go stale the moment Studio changes. The steps
that produced them are here so the next person can produce them again rather than guess
which build a picture came from.

The subject is `examples/company`, because it is one process and it is what a deployed
project looks like: `assemora()` serves Studio at `/studio` beside the API, on one
origin, against an in-memory database that is seeded on every boot.

```bash
pnpm install
pnpm build
pnpm demo
```

That prints the address. Sign in at `/studio` as `admin@example.com`; the password is
generated on the first boot and written to `examples/company/.env`, which the boot line
says as well:

```bash
grep ASSEMORA_SEED_PASSWORD examples/company/.env
```

Two things to set before the first capture, both of which have produced unusable
pictures before:

- **Pin the language.** Studio guesses it from `navigator.languages` on a first visit
  and ships English, Ukrainian and Russian, so a machine set to anything else silently
  produces screenshots nobody outside this repository can read. Either use the language
  buttons on the sign-in screen, or set it before the first render with
  `localStorage.setItem('assemora.studio.language', 'en')`.
- **Capture at 1440x900 with a device pixel ratio of 2.** Anything narrower folds the
  builder's inspector away, which is the half that carries the argument.

| File | Screen |
| --- | --- |
| `studio-page-builder.png` | `/studio/pages`, then Home, with the hero block selected |
| `studio-proposals.png` | `/studio/proposals`, with a pending change set opened |
| `studio-dashboard.png` | `/studio` |
| `studio-api-explorer.png` | `/studio/developer` |
| `studio-sign-in.png` | `/studio`, signed out |
| `studio-theme.png` | `/studio/design` |

The proposal in `studio-proposals.png` is a real one, made over MCP rather than staged.
An agent identity is created through the Command Bus like anything else, and the token
it answers with is what the JSON-RPC endpoint authenticates:

```bash
# as a signed-in administrator, through the generic command endpoint
POST /api/commands/auth.agents.create
     { "name": "Content agent", "permissions": ["pages.read", "blocks.update", "changesets.propose"] }

# then, as that agent
POST /api/mcp   Authorization: Bearer <token>
     { "jsonrpc": "2.0", "id": 1, "method": "tools/call",
       "params": { "name": "assemora.blocks.update", "arguments": { … } } }
```

The tool answers `{ "status": "pending", "changes": [...] }` and writes nothing, which
is the row the screenshot shows.
