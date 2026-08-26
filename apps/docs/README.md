# @assemora/docs

The documentation site (SPEC.md §117). It renders [`docs/guide/`](../../docs/guide) and
holds no copy of it.

```bash
pnpm --filter @assemora/docs dev     # on :4200
pnpm --filter @assemora/docs build   # static output in dist/
```

## Why it is this small

The guide is Markdown in the repository, because that is where it is reviewed, diffed
and read by anybody working in a checkout. This app exists to make it a path a person
can walk, and every design choice follows from not wanting a second copy of the guide:

- **The pages are read at build time**, with
  `import.meta.glob('../../../docs/guide/*.md', { query: '?raw', eager: true })`. There
  is no content directory here, no front matter and no manifest: adding
  `13-something.md` to the guide puts it in the navigation, in the right place, with no
  edit in `src/`.
- **The order and the titles come from the files themselves** — the numeric prefix
  orders them, the first `# ` heading names them. A list of pages kept here would be
  the one thing that had to be maintained twice.
- **Routing is the location hash.** A router would be a dependency, a build step and a
  server rewrite rule for twelve static pages. `#/03-models` works from a static host,
  from a subdirectory and from a `file://` path, which is why `base` is relative.
- **One Markdown library, `marked`, pinned like every other version here.** It is
  dependency-free, and this is an app rather than a package, so the rule that an
  implementation library has one owning package does not bind it.

## Links

The Markdown is written to be read in a checkout as well as here, so its links are
repository paths. `src/guide.ts` rewrites them as it renders: a link to another page of
the guide becomes a route, and anything else relative — `../adr/`, `../../SPEC.md` — is
a real file this site does not hold, so it goes to the repository rather than to a 404.

The rewrite happens on the parsed token rather than on the emitted HTML, so the default
renderer still does the escaping. A regular expression over finished HTML is the version
of this that eventually mangles a code sample.
