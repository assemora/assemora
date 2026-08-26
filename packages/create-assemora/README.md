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

A starter is an ordinary workspace package. Four conventions turn it into a template.

**A dotfile is carried under a leading `_`.** npm strips a real `.gitignore` out of a
published tarball, so a template holding one would scaffold a project without it, and
the same is true of `.npmrc`. Any path segment beginning `_` becomes `.`:

```text
_gitignore              →  .gitignore
_npmrc                  →  .npmrc
_github/workflows/ci.yml → .github/workflows/ci.yml
```

`.env.example` needs no such treatment and is copied as it stands. A `.env` is written
only when a database URL was actually given, and it holds that one variable — an
example's values are placeholders, and a `.env` full of placeholder credentials is a
file somebody eventually commits believing it to be real.

**`package.json` is rewritten, not copied.** The project takes its own name, every
`workspace:*` becomes a range a package manager outside this repository can resolve,
and `private` is left exactly as the starter declared it. A `package.json` below the
root keeps its own name and still loses its workspace ranges.

**A file or a dependency that only exists for one answer is named in
`template.json`.**

```json
{
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

`package.json` is the one file markers stay out of, since JSON cannot carry a comment.
That is what the manifest is for.

Three yes/no questions make one starter eight projects, and every one of them has to
compile: no import of a file that was left out, no dependency on a package that was
left out. `src/scaffold.test.ts` asserts all eight, mechanically.

## What a generated project can install today

`workspace:*` becomes `^<this package's own version>`: the scaffolder and the
framework ship from the same repository at the same version, so `create-assemora@0.4.2`
writes a project against `^0.4.2`. `dependencyRange()` in `src/package-json.ts` is the
one line to change if that is ever wrong.

Today that version is `0.0.0` and none of the `@assemora` packages are on npm, so a
generated project cannot be installed yet at all. The command says so in as many words
rather than leaving somebody to read it out of a resolver error, and that line goes the
day there is a release.
