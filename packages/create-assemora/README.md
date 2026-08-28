# create-assemora

How a project starts (SPEC.md §78, and the first line of §124).

```bash
pnpm create assemora my-project
```

```text
Project name          my-project
Database URL          postgres://localhost:5432/my_project
Include Studio?       (Y/n)
Include Pages?        (Y/n)
Include MCP?          (Y/n)
```

Every question has a flag that answers it — `--database`, `--no-studio`, `--no-pages`,
`--no-mcp` — and `--yes` answers all of them. When stdin is not a terminal nothing is
asked at all: it takes the defaults and says on stdout which ones it took, because a
scaffolder that blocks for ever waiting for an answer nobody can type is a scaffolder
that hangs a build.

It finishes by printing the three commands to run next, in order.

## It has no dependencies

Not few — none, and `pnpm boundaries` fails the build if one appears, in
`devDependencies` too. `pnpm create` runs this package before anything is installed,
so a dependency of its own would have to be fetched first. Node 24 builtins are the
whole toolkit: `node:fs/promises`, `node:path`, `node:readline/promises`, `node:url`.

## The public API

```ts
import { scaffold } from 'create-assemora'

const { directory, files } = await scaffold({
  name: 'my-project',
  directory: '/Users/ada/my-project',
  database: 'postgres://localhost:5432/my_project',
  studio: true,
  pages: true,
  mcp: false,
})
```

`assemora new` in `@assemora/cli` calls exactly this. It is the convenience, not a
second implementation: two scaffolders would disagree about what a project is the
first time either one changed.

`template` takes a starter's name or an absolute path to one, and `force` writes into
a directory that is not empty.

## Where the template comes from

`starters/<name>` in the framework repository, which is a real workspace package so
that CI proves it still compiles (ADR-0021). A published tarball cannot reach outside
itself, so `prepack` copies `starters/` into `templates/` and the resolver looks there
first — the packed copy is what a published install has, the workspace copy is what a
checkout has. `templates/` is machine-made and gitignored; every edit belongs in the
starter.

## Writing a starter

A starter is an ordinary workspace package. Five conventions turn it into a template.

**A dotfile is carried under a leading `_`, at the root.** npm strips a real
`.gitignore` out of a published tarball, so a template holding one would scaffold a
project without it, and the same is true of `.npmrc`. A leading `_` on the *first*
path segment becomes `.`:

```text
_gitignore               →  .gitignore
_npmrc                   →  .npmrc
_github/workflows/ci.yml →  .github/workflows/ci.yml
src/_internal.ts         →  src/_internal.ts     (unchanged)
pages/_app.tsx           →  pages/_app.tsx       (unchanged)
```

Only the root, because every dotfile npm strips is a root-level one and `_` means
something else everywhere below it: `pages/_app.tsx` is Next.js's own spelling and
`app/_components/` is an ordinary private-folder convention. Rewriting those produced
dotfiles that nothing could import.

`.env.example` needs no such treatment and is copied as it stands. A `.env` is written
only when a database URL was actually given, and it holds that one variable — an
example's values are placeholders, and a `.env` full of placeholder credentials is a
file somebody eventually commits believing it to be real.

**`package.json` is rewritten, not copied.** The project takes its own name, every
`workspace:*` becomes a range a package manager outside this repository can resolve,
and `private` is left exactly as the starter declared it. A `package.json` below the
root keeps its own name and still loses its workspace ranges.

**A file or a dependency that only exists for one answer is named in
`template.json`, and so is the line the template says about itself.**

```json
{
  "description": "an empty project: authentication, Studio and nothing declared yet",
  "features": {
    "studio": { "files": ["src/studio.ts"], "dependencies": ["@assemora/studio"] },
    "pages": { "files": ["src/blocks"], "dependencies": ["@assemora/pages"] },
    "mcp": { "files": ["src/mcp-routes.ts"], "dependencies": ["@assemora/mcp"] }
  }
}
```

Paths are template-relative and a directory counts. `template.json` is never copied
into a project. A feature name it does not recognise is a failed scaffold, not a
silently ignored line.

`description` is one line, lower case, no full stop — it is read as the tail of a line
rather than as a sentence. `--help` prints it beside the name, and so does the block
after a scaffold that took the default template, which is how somebody who wanted the
worked example rather than the empty default finds out it exists. Which starter to copy
is deliberately *not* a sixth question: SPEC.md §78 fixes the five, and asking everybody
about something most people want the default of buys nothing that a printed line does
not. `listTemplates()` reads the list off disk, so a starter added to `starters/` is
listed the day it lands.

**The template's own `.gitignore` says what its tooling writes.** A starter carries it
as `_gitignore`, and everything it names is excluded from the project — `.next/`,
`out/`, `.svelte-kit/`, whatever the starter's build tool happens to produce. That is
the list the starter's author already maintains, and reading it is what makes a new
starter correct on the day it lands rather than the day somebody remembers to teach
this package another name.

The other half of the rule is `NEVER_COPIED` in `src/exclusions.ts`, which is one
list, exported, and read by `scripts/copy-templates.mjs` too. It names only what no
`.gitignore` can be asked to name: what a checkout of a *workspace package*
accumulates (`node_modules/`, `dist/`, `.turbo/`, `coverage/`, `*.tsbuildinfo`,
`.git/`), and what running an Assemora project writes (`.assemora/`,
`database/migrations/*.sql`, `openapi.json`, `src/generated/`). A real project commits
those four, so no `.gitignore` can exclude them — and a project that inherited them
would begin life with a migration it did not generate, whose first `db:generate`
writes every table a second time.

It also names the third kind, which points the other way: `*.test.ts`, `*.test.tsx`
and their `*.test-d.*` siblings. A starter's tests belong to this repository rather
than to the project made from it — they are how CI proves the template still works,
and they import a test runner a scaffolded project has no dependency on, so a project
that inherited one would not typecheck. A `.gitignore` cannot say this: a real project
commits its tests.

**Anything smaller than a file is fenced with a marker comment.** A marker is
recognised by its text rather than by its comment syntax, and the whole line goes — so
the same two words work in TypeScript, in Markdown, in an `.env.example` and in YAML:

```ts
// assemora:if studio
import { studio } from './studio.js'
// assemora:end
```

```html
<!-- assemora:if !pages -->
This project has no page builder.
<!-- assemora:end -->
```

`!` inverts. Regions nest. A misspelt feature name, an unclosed region and an
`assemora:end` that closes nothing are all refused with the file and the line, because
each of them would otherwise delete a region for ever — or keep one for ever — and
nothing downstream would notice.

A marker owns its line: with anything but comment punctuation beside it, the line is
content. A bundle or a source map quoting a fenced file is copied rather than edited,
which is what a scaffolder's *user* needs — they cannot fix a template they have never
seen. And `assemora:\if` is the escape, written into the project without its
backslash, so a document explaining this mechanism can print the syntax it explains:

```text
    // assemora:\if studio      in the template
    // assemora:if studio       in the project
```

`package.json` is the one file markers stay out of, since JSON cannot carry a comment.
That is what the manifest is for.

Three yes/no questions make one starter eight projects, and every one of them has to
compile: no import of a file that was left out, no dependency on a package that was
left out. `src/scaffold.test.ts` asserts all eight against a synthetic template, and
`src/starters.test.ts` asserts all eight against every real starter in `starters/`, in
whatever state this checkout has left it — built, installed, or run. `--template
nextjs` shipped unable to scaffold at all because nothing did the second one. That
second list is read off disk rather than written out, so a starter added to `starters/`
is covered by all eight the day it lands.

## What a generated project can install today

`workspace:*` becomes `^<this package's own version>`: the scaffolder and the
framework ship from the same repository at the same version, so `create-assemora@0.4.2`
writes a project against `^0.4.2`. `dependencyRange()` in `src/package-json.ts` is the
one line to change if that is ever wrong.

Today that version is `0.0.0` and none of the `@assemora` packages are on npm, so a
generated project cannot be installed yet at all. The command says so in as many words
rather than leaving somebody to read it out of a resolver error, and that line goes the
day there is a release.
