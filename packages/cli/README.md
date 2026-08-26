# @assemora/cli

The `assemora` executable (SPEC.md §77).

```bash
assemora dev          # run the project, restarting when a file changes
assemora make:model Post
assemora db:generate add-posts
assemora db:migrate
assemora routes
```

## It is a client of the application, not a second one

The CLI never imports a feature package. It does not import `@assemora/auth`,
`@assemora/pages`, `@assemora/media`, `@assemora/resources`, `@assemora/http` or
`@assemora/mcp`, and `pnpm boundaries` fails the build if it ever does.

It gets the application by importing the *project's own code* at runtime through
`assemora.config.ts`, and then asks it questions: `app.registry.describe()` for
routes, models, resources, blocks, commands and queries, and
`app.queries.execute('auth.agents.list', …)` for anything that is data rather than
declaration. Listing agents therefore goes through the Query Bus, is authorized and is
audited, exactly as it would be from Studio or from an agent. The CLI is one more
client of the application layer (ADR-0021).

Two things follow, and they are the honest cost rather than bugs. An application that
cannot be constructed cannot be introspected: `assemora routes` boots the app, which
means it also opens a database connection. And `assemora agents` is subject to
policies — run it as nobody and it lists nothing, which is correct and will surprise
somebody at least once. `--actor <id>` is how you say who is asking.

The alternative was a CLI that parses the project's TypeScript, which would need a
second implementation of what a model, a resource and a block are. The Schema Registry
exists so that no subsystem keeps its own copy.

## `assemora.config.ts`

```ts
import { defineConfig } from '@assemora/cli'

export default defineConfig({
  // How the CLI gets an application. It is NOT booted — the CLI boots it, once.
  app: () => import('./src/app.ts').then((module) => module.createApp()),

  // What `assemora dev` and `assemora start` run, relative to this file.
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
means the same thing typed from `src/` as from the root — the config is found by
walking up from the working directory, `assemora.config.ts` first and then
`assemora.config.js`. Node 24 strips TypeScript types natively, so a `.ts` config is
imported directly: no transpiler, no dependency, and the file the developer edits is
the file that runs.

`app` hands back an application that has *not* been booted. The CLI boots it once per
process, so two commands in one process — and `console`, which is many — share a
single application and a single database pool.

Everything is optional except `app`. `paths` defaults to the three values above;
`api:openapi` falls back to `openapi.json` and takes its title and version from the
project's `package.json`; `sdk:generate` falls back to `<source>/generated/sdk.ts`.

## The commands

Grouped as SPEC.md §77 groups them, which is how `assemora` with no arguments prints
them.

### Project

| | |
| --- | --- |
| `assemora new <name>` | scaffold a new project |

It calls `scaffold()` from `create-assemora` — the same code path as
`pnpm create assemora`. This is the convenience, not a second implementation.

### Run

| | |
| --- | --- |
| `assemora dev` | run the server and restart it when a file changes |
| `assemora build` | typecheck the project and regenerate what the config declares |
| `assemora start` | run the server |

`dev` and `start` spawn `node [--watch] <config.server>` under the same Node the CLI is
running under, streaming its output, forwarding SIGINT and SIGTERM and exiting with
its code. Everything after `--` is node's: `assemora dev -- --inspect` runs
`node --watch --inspect src/server.ts`.

`build` is "everything that must be current before this is deployed". If the project
declares its own `build` script it runs that instead and says so, with the package
manager the project names. Otherwise it typechecks with the project's own TypeScript
and its own `tsconfig.json`, then regenerates exactly what the config declares — by
running `api:openapi` and `sdk:generate`, rather than by generating anything itself.

### Generate

| | |
| --- | --- |
| `assemora make:model Post` | `src/models/post.ts` |
| `assemora make:resource Post` | `src/resources/posts.ts` |
| `assemora make:block hero` | `src/blocks/hero.ts` |
| `assemora make:module blog` | `src/modules/blog.ts` |
| `assemora make:command posts.publish` | `src/commands/publish-post.ts` |
| `assemora make:policy posts` | `src/policies/posts.ts` |

One file into `paths.source`, refusing to overwrite unless `--force`. `BlogPost`,
`blog_post`, `blog-post` and `blogPost` produce a byte-identical file, so nobody has
to remember which spelling the generator wanted.

The path goes to stdout and the next step goes to stderr, so
`assemora make:model Post` can be piped into an editor. What is generated compiles
against the real APIs, and `make.test.ts` is what proves it: a generator that emits
code the framework rejects is worse than no generator.

### Database

| | |
| --- | --- |
| `assemora db:generate [name]` | write a migration for everything the models changed |
| `assemora db:migrate` | apply every migration that has not run yet |
| `assemora db:rollback` | undo the most recently applied migration |
| `assemora db:status` | list every migration and whether it is applied |

`db:generate` diffs the snapshot at `<generated>/schema.json` against the booted
application's model registry, writes `<migrations>/<NNNN>_<name>.sql` and moves the
snapshot forward — in that order, so a snapshot never runs ahead of a migration that
was not written. Every destructive change is printed as a warning naming the table and
the column. `--check` writes nothing and exits `1` if a migration would be generated,
which is what CI runs.

The diff is taken against the snapshot rather than against a live database, so
generation is deterministic, works offline, and produces the same migration for two
developers whose databases have drifted. `db:status` is where drift against a real
database is reported.

A pending migration that changes or destroys stored data needs `--force` outside
development, and so does any rollback (SPEC.md §34). The CLI has `NODE_ENV` and
nothing else to go on, so the question is answered the safe way round: `development`
and `test` are development, and everything else — staging, a typo, an unset variable
— is treated as production.

#### The migration file format

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

A plain `.sql` file, because the whole point of generating one is that a person reads
it in a pull request before it ever reaches a database. One rule makes it both
parseable and reviewable: **a comment beginning `-- +` is a directive, and every other
comment is prose**. There are two directives — `+migration up` / `+migration down`
open a section, and `+destructive <sentence>` is what `db:migrate` prints before it
runs. A directive that is not recognised is refused rather than ignored, because a
typo in `-- +migration down` would otherwise put a `drop` in the section that runs
forwards.

Statements are separated by `;`, exactly as anybody would write them, so the file is
also runnable with `psql -f`. A semicolon inside a string, a quoted identifier or a
dollar-quoted body is part of the statement rather than the end of it.

The filename is `<number>_<name>.sql`. The number decides the order, so a file without
one is refused rather than sorted somewhere arbitrary, and two files sharing a number
— two branches that each generated `0004` — are refused by name rather than resolved
by whatever order the filesystem offers. A file with no `-- +migration` marker at all
is read as an `up` migration, which is what somebody who dropped a `.sql` file into
the directory meant. A migration with no `down` section is refused by
`db:rollback` by name, rather than quietly running nothing and marking itself undone.

### Inspect

| | |
| --- | --- |
| `assemora routes` | the HTTP routes this application registers |
| `assemora models` | the models it declares, with their tables and relations |
| `assemora resources` | the resources it declares, and the models behind them |
| `assemora blocks` | the block types a page can be assembled from |
| `assemora agents` | the agent identities this application knows |

All five take `--json`, because the next thing anybody does with a listing is pipe it.
`agents` additionally takes `--actor <id>`, `--page` and `--per-page`. An application
built without `@assemora/auth` registers no `auth.agents.list`, and `agents` says that
plainly rather than failing on an unknown query.

### Artifacts

| | |
| --- | --- |
| `assemora api:openapi` | write the OpenAPI 3.1 document |
| `assemora sdk:generate` | write the typed client |

`--out <file>` beats the config, the config beats the default, and `--stdout` beats
all three by naming no file at all — and writes nothing else, so it pipes.

### Console

| | |
| --- | --- |
| `assemora console` | open a REPL holding the booted application |

`app`, `commands`, `queries` and `registry` are in scope, plus
`as(actorId, operation)` which runs an operation inside a user context. There is no
database handle in scope and this package could not obtain one: a mutation typed here
passes validation, authorization, revisions and audit exactly as one typed anywhere
else does. `.exit` closes the application, so the pool it opened goes with it.

## Exit codes

`0` succeeded, `1` the command failed, `2` the invocation was wrong — an unknown
command, a missing argument, `--page two`. The distinction matters to a script: `2`
says the arguments were nonsense and retrying will not help, while `1` says the work
was attempted and did not finish.

Errors print one clear sentence to stderr. `--debug` adds the stack and every cause
below it.

`run(argv)` returns the exit code and never calls `process.exit`, so the whole CLI is
drivable from a test in-process. `bin.ts` is the only thing that ends the process, and
it sets `process.exitCode` rather than exiting, so a piped listing is flushed rather
than truncated mid-line.

## Adding a command

One `defineCommand` in the group that owns it, registered into the table in
`registry.ts`. The help is printed from the table rather than written out beside it,
so there is no second list to keep in step. A group reaches the table by being
imported from `commands/index.ts`, and a group needing a heavy import —
`@assemora/database-postgres` for `db:*`, the SDK generator for `sdk:generate` —
reaches for it inside its handler rather than at the top of its module, so
`assemora --help` stays instant.
