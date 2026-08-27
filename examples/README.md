# Examples

Two applications, for a reader who has already been through `starters/bare`.

A starter is the smallest thing that works, and it is what `pnpm create assemora`
writes. An example is the opposite errand: it shows one real shape of site, densely
and with fewer comments, and its job is to answer "how would I do that here". Neither
is a tutorial.

| | |
| --- | --- |
| [`blog/`](blog) | **Relations, scopes and policies.** Articles that belong to authors and categories, three scopes, and a policy that lets an author edit their own article and nobody else's. Two accounts are seeded so that the policy actually decides something. Public reading is two routes, and the README says why it cannot be a policy. |
| [`company/`](company) | **The block tree and the builder.** A landing page, a team listing and careers, assembled from seven blocks with a nesting rule, the universal design controls of SPEC.md §61 and a theme that says what every token means. Two of the blocks read live data. |

Between them they cover what the starter leaves out, and they deliberately do not
overlap: relations, scopes and policies are only in `blog/`; nesting, design tokens,
the theme and serving pages to anonymous visitors are only in `company/`.

## Running one

```bash
pnpm install
pnpm --filter @assemora/example-blog build   # the site bundle Studio's canvas frames
pnpm --filter @assemora/example-blog dev
```

Both fall back to an in-memory database when `DATABASE_URL` is unset, and seed *that*
database on first boot — a real one is seeded by `pnpm seed`, deliberately, because
`assemora start` runs the same `src/server.ts` a deployment does. They print the
addresses they created and put the password in `.env`, as `ASSEMORA_SEED_PASSWORD`.

Both serve Studio at `/studio` and the API at `/api`. `company` serves its pages
publicly at `/preview`; `blog` reads pages through the authorized query, so its
`/preview` is the builder's preview and asks you to sign in.

They are workspace packages, so CI typechecks and builds them on every commit: an
example that no longer compiles is worse than no example at all.
