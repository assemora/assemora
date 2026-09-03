# Releasing

Nothing has been published. This is what the first release takes, in order, and what
each step is guarding against.

## Why the tree stays at `0.0.0`

Every manifest says `0.0.0`, and that is load-bearing rather than laziness.
`isUnreleased()` in `@assemora/create-assemora` reads it, and it is what makes the
scaffolder print the checkout route instead of `pnpm install` — an install that today
cannot resolve a single dependency. `packages/create-assemora/src/package-json.test.ts`
asserts that reading. So the version is set on release day, in the commit that also
makes the scaffolder's other branch true, and not before.

## What has to happen once, by hand

These need credentials and cannot be done from inside the repository.

1. **Claim the three names.** All three are free as of 2026-09-03: the organisation
   `assemora`, which is what owns the `@assemora` scope; the unscoped `assemora`, which
   is the umbrella of SPEC.md §9; and the unscoped `create-assemora`, which is what
   `pnpm create assemora` resolves to.

   The scope and the two unscoped names are claimed in different ways, and neither is
   `npm org create` — that command does not exist. `npm org` manages membership only
   (`set`, `rm`, `ls`).

   - **The organisation** is created on the website: <https://www.npmjs.com/org/create>,
     name `assemora`, the free plan, which is unlimited public packages. Creating it is
     what reserves the `@assemora` scope; nothing needs publishing for that.
   - **An unscoped name** has no reservation at all on npm. It is held by publishing to
     it and by nothing else. `placeholders/` beside this file is what to publish: two
     packages that install and print where the real thing is, so
     `pnpm create assemora my-project` answers with a sentence instead of a 404.

   ```bash
   npm login                                  # asks for the password and the second factor
   npm publish docs/placeholders/assemora --access public
   npm publish docs/placeholders/create-assemora --access public
   ```

   Publishing those two is the same act as a release, one version earlier and with
   nothing in it. If it is not wanted yet, the risk is worth stating plainly: an
   unscoped name is first-come, and the day this repository is on anybody's front page
   is the day somebody else can take it.

2. **An automation token** in the repository's secrets as `NPM_TOKEN`, and npm's
   two-factor policy for the scope set to allow automation tokens. The workflow also
   expects an environment named `npm`, which is where an approval gate goes if one is
   wanted.
3. **Decide the licence line for the tarballs.** Apache-2.0 with the root `NOTICE` is
   what the repository carries; pnpm hoists `LICENSE` into every tarball already.

## What the repository still needs

4. **Make the framework packages publishable.** All 24 under `packages/` carry
   `"private": true` except the umbrella, and `pnpm publish -r` skips a private
   manifest — so a publish today would push one package out of the 25 an installed
   project needs. Flip the field:

   ```bash
   pnpm -r --filter "./packages/**" exec npm pkg set private=false --json
   ```

   `apps/`, `starters/`, `examples/` and `tests/` stay private, which is correct.
   `apps/studio` is already public and must stay so: the umbrella loads it at run time
   by resolving `@assemora/studio/package.json` out of `node_modules`.

   Nothing else is missing. `exports`, `main`, `types`, `files`, `license` and
   `repository.directory` are already right on all of them, and `bin.mjs` is in `files`
   for the two packages that have an executable.

5. **Set every version together.** pnpm rewrites `workspace:*` to the *exact* version at
   pack time, so two packages that disagree publish tarballs depending on versions no
   sibling satisfies:

   ```bash
   pnpm -r --filter "./packages/**" --filter "./apps/studio" exec npm pkg set version=0.1.0-alpha.0
   ```

6. **Run the release workflow.** `.github/workflows/release.yml` is written and does
   nothing until somebody dispatches it: no tag trigger and no push trigger, because
   both turn a permanent act into a side effect of an ordinary git operation, and npm
   allows an unpublish for 72 hours and then never.

   It runs `pnpm verify`, checks that `dist/` is really there — `files` names `dist`,
   `dist` is gitignored, and a publish from an unbuilt checkout ships empty packages —
   checks that every publishable manifest carries the same version, and then publishes
   with provenance. `pnpm publish -r` skips a private manifest itself, rewrites
   `workspace:*` to the exact version, and runs `create-assemora`'s `prepack`.

   Dispatch it with the `next` tag until the public API stops moving. `latest` is what
   `npm install assemora` resolves to, and it should not point at an alpha.

## Why `pnpm publish -r` rather than changesets

All the packages ship in lockstep, so changesets' per-package version graph solves a
problem this repository does not have. It would also add a dependency, and its
generated changelogs would sit badly beside `docs/architecture/roadmap.md`, which is
deliberate prose.

## After the first release

- `pnpm create assemora` starts working. Move it back to the top of the README and of
  `docs/guide/02-getting-started.md`, both of which currently lead with the checkout.
- The scaffolder's `nextSteps` switches to `cd / pnpm install / pnpm dev` on its own,
  because the version it reads is no longer `0.0.0`.
- Add an npm badge to the README beside the CI one.
