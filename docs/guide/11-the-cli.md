# The CLI

```bash
assemora dev          # run the project, restarting when a file changes
assemora make:model Post
assemora db:generate add-posts
assemora db:migrate
assemora routes
```

## It is a client of your application, not a second one

The CLI never imports a feature package. It does not import `@assemora/auth`,
`@assemora/pages`, `@assemora/media`, `@assemora/resources`, `@assemora/http` or
`@assemora/mcp`, and `pnpm boundaries` fails the build if it ever does.

It gets the application by importing **your** code through `assemora.config.ts`, and
then asks it questions: `app.registry.describe()` for routes, models, resources, blocks,
commands and queries, and the Query Bus for anything that is data rather than
declaration. So `assemora routes` lists the routes your project actually registers
rather than a parse of its source, and `assemora agents` is authorized and audited like
any other read.

Two things follow, and they are the honest cost rather than bugs:

- **An application that cannot be constructed cannot be introspected.** `assemora
  routes` boots the app, which means it also opens a database connection.
- **`assemora agents` is subject to policies.** Run it as nobody and it lists nothing,
  which is correct and will surprise somebody at least once. `--actor <id>` is how you
  say who is asking.

The alternative was a CLI that parses your TypeScript, which would need a second
implementation of what a model, a resource and a block are.

## `assemora.config.ts`

```ts
import { defineConfig } from '@assemora/cli'

export default defineConfig({
  // Not booted: the CLI boots it, once per process, so two commands share one
  // application and one database pool.
  app: () => import('./src/app.ts').then((module) => module.createApp().app),
  server: 'src/server.ts',
  paths: {
    source: 'src',
    migrations: 'database/migrations',
    generated: '.assemora/generated',
  },
  openapi: { out: 'openapi.json', info: { title: 'My project', version: '0.1.0' } },
  sdk: { out: 'src/generated/sdk.ts' },
})
```

`defineConfig` is identity plus types. It exists so the object is checked where it is
written, which is the only place a mistake in it is cheap to fix.

Every path is relative to the directory holding the config, so `assemora db:migrate`
means the same thing typed from `src/` as from the root — the config is found by walking
up from the working directory. Node 24 strips TypeScript types natively, so a `.ts`
config is imported directly: no transpiler, no dependency, and the file you edit is the
file that runs.

Everything is optional except `app`.

## The commands

**Project** — `assemora new <name>` scaffolds one. It calls the same `scaffold()`
`pnpm create assemora` does; it is the convenience, not a second implementation.

**Run** — `assemora dev`, `assemora build`, `assemora start`, `assemora mcp`. `dev` and `start` spawn
`node [--watch] <config.server>` under the same Node the CLI is running under,
forwarding signals and exiting with its code; everything after `--` is node's, so
`assemora dev -- --inspect` works. The server is also handed the CLI's pid, and
stops itself when that process is gone — so a CLI killed outright, with no chance to
forward anything, does not leave a server listening behind it. `build` is "everything that must be current before
this is deployed": your own `build` script if you declare one, otherwise a typecheck
with your TypeScript and your `tsconfig.json`, then `api:openapi` and `sdk:generate`.

`assemora mcp` is the one that is not a process manager. It serves this project to an
agent over stdin and stdout, which is the transport Claude Code, Claude Desktop and
Cursor speak — a client starts the process and talks to it down a pipe. The endpoint is
the one `assemora({ mcp: true })` already built, so a stdio session is the same generated
tools past the same seven checks as a call to `POST /api/mcp`; nothing about the protocol
lives in the CLI.

It needs two things. `ASSEMORA_AGENT_TOKEN`, because a pipe carries no headers and an
anonymous session would reach every tool with no permissions at all — in `.env` is the
ordinary place, and `assemora agents:create --write-mcp-json` below puts it there. And a config whose
`app()` hands back the whole application rather than `createApp().app`: the `.app` on the
end drops the half that speaks the protocol, and the command says so if it finds one.

The HTTP endpoint is the other way in, and a client that speaks Streamable HTTP reaches
it directly — `GET` on it answers 405, which is how the specification spells "this server
pushes nothing", and the version the session settled on comes back on every answer.

```json
{
  "mcpServers": {
    "my-project": {
      "command": "pnpm",
      "args": ["assemora", "mcp"],
      "cwd": "/path/to/my-project"
    }
  }
}
```

An in-memory database is worth a word here: `assemora mcp` boots the project's own
application, so with no `DATABASE_URL` it gets a fresh empty world of its own — and no
agent token can exist in it. Point it at the database the rest of the project uses.

**Identity** — `assemora agents:create <name> --permissions <a,b>`. An agent identity
and the token that *is* it (SPEC.md §72). It runs `auth.agents.create` on the Command
Bus, so it is authorized and audited like anything else — pass `--actor <user id>`, and
an actor cannot hand an agent a permission it does not hold itself.

The token is printed once and stored as a digest, so nothing can print it again.
`--write-mcp-json` writes two files, and the split is the point: the token goes into
`.env`, at mode 0600, where this project already keeps its secrets and where it is read
as the project is imported; and `.mcp.json` — the client configuration, which is the
same for everybody working here and is the sort of file that gets committed — holds no
credential at all.

```bash
assemora agents:create "Content agent" \
  --permissions pages.read,blocks.update,changesets.propose \
  --actor 7edda944-… --write-mcp-json
```

Studio does the same thing on Users → Agents, for somebody who is not in a terminal.

**Generate** — `make:model`, `make:resource`, `make:block`, `make:module`,
`make:command`, `make:policy`. One file into `paths.source`, refusing to overwrite
unless `--force`. `BlogPost`, `blog_post`, `blog-post` and `blogPost` produce a
byte-identical file. The path goes to stdout and the next step to stderr, so the output
can be piped into an editor. What is generated compiles against the real APIs, and a
test proves it.

**Database** — `db:generate`, `db:migrate`, `db:rollback`, `db:status`.

**Inspect** — `routes`, `models`, `resources`, `blocks`, `agents`. All five take
`--json`, because the next thing anybody does with a listing is pipe it.

**Artifacts** — `api:openapi`, `sdk:generate`. `--out <file>` beats the config, the
config beats the default, and `--stdout` beats all three by naming no file at all — and
writes nothing else, so it pipes.

**Console** — `assemora console` opens a REPL holding the booted application, with
`app`, `commands`, `queries`, `registry` and `as(actorId, operation)` in scope. There is
no database handle there and this package could not obtain one: a mutation typed here
passes validation, authorization, revisions and audit exactly as one typed anywhere else
does.

## Migrations

`db:generate` diffs the snapshot at `<generated>/schema.json` against the booted
application's model registry, writes `<migrations>/<NNNN>_<name>.sql` and moves the
snapshot forward — in that order, so a snapshot never runs ahead of a migration that was
not written.

**The diff is taken against the snapshot, not against a live database.** That makes
generation deterministic, offline and identical for two developers whose databases have
drifted. Drift against a real database is what `db:status` is for.

The file is plain SQL, because the whole point of generating one is that a person reads
it in a pull request before it ever reaches a database:

```sql
-- 0002_add-sku
-- Written by `assemora db:generate`. A comment beginning `-- +` is read back by
-- `assemora db:migrate`; every other comment in this file is for you.
-- +destructive drops column products.legacy_sku

-- +migration up
alter table "products" add column "sku" varchar(255);

-- +migration down
alter table "products" drop column "sku";
```

One rule makes it both parseable and reviewable: **a comment beginning `-- +` is a
directive, and every other comment is prose.** There are two directives. An unrecognised
one is refused rather than ignored, because a typo in `-- +migration down` would
otherwise put a `drop` in the section that runs forwards.

Statements are separated by `;` exactly as anybody would write them, so the file is also
runnable with `psql -f`. The filename's number decides the order: a file without one is
refused, and two files sharing a number — two branches that each generated `0004` — are
refused by name rather than resolved by whatever order the filesystem offers.

A pending migration that changes or destroys stored data needs `--force` outside
development, and so does any rollback. The CLI has `NODE_ENV` and nothing else to go on,
so the question is answered the safe way round: `development` and `test` are
development, and everything else — staging, a typo, an unset variable — is treated as
production.

`--check` writes nothing and exits `1` if a migration would be generated, which is what
CI runs.

## Exit codes

`0` succeeded, `1` the command failed, `2` the invocation was wrong. The distinction
matters to a script: `2` says the arguments were nonsense and retrying will not help,
while `1` says the work was attempted and did not finish. Errors print one clear
sentence to stderr; `--debug` adds the stack and every cause below it.

## Where to look next

- [Deploying](12-deploying.md) — what to run, and in what order.
- `packages/cli/README.md` for the full command table and how to add one.
