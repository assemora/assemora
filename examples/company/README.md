# Company

A marketing site: a landing page, a team listing and a careers page, assembled from
seven blocks. Almost no content modelling — two small lists — and a lot of
composition, a nesting rule, the universal design controls and a theme.

It assumes you have already read `starters/bare`. `examples/blog` is where relations,
scopes and policies are; this one is where the block tree and the builder are.

## Run it

```bash
pnpm install
pnpm --filter @assemora/example-company build   # the site bundle
pnpm --filter @assemora/example-company dev
```

Three pages are seeded and published. `/preview` is the site — no session, no query
parameter; `/preview?slug=team` and `/preview?slug=careers` are the other two. Studio
is at `/studio`, and the administrator's password is written into `.env` as
`ASSEMORA_SEED_PASSWORD` rather than printed. Against a real database nothing is
seeded until you type `pnpm seed`.

## Read in this order

| | |
| --- | --- |
| `src/blocks.ts` | seven declarations, and the rule about what nests in what |
| `src/server.ts` | the three pages, assembled with the builder's own commands |
| `src/seed.ts` | the palette, set with `theme.update` rather than written in CSS |
| `app/theme.css` | what a hero and a feature card look like — and nothing else |
| `app/blocks.tsx` | one React view per block |
| `src/routes.ts` | how a page reaches somebody with no account |

## A page is a tree

`src/server.ts` builds the landing page the way a person would, because there is no
other way to build one:

```ts
const what = await add(app, home, 'section', { heading: 'What we build', columns: 'three' })

await add(app, home, 'feature', { title: 'One declaration', … }, what)
```

`blocks.add` answers with the new block's id, which is what the next call nests
inside. Every builder operation in Studio — add, move, nest, duplicate, remove, edit,
hide, publish, undo — is one of these commands, so anything a person can do in the
builder an agent can propose over MCP, and both are recorded identically.

`section` accepts children and names which ones (`allowedChildren`) and how many
(`maxChildren`). Dropping a hero inside a section is refused by that declaration, not
by anything Studio knows about this site.

## Design is tokens, never CSS

Every block carries the same seven controls without asking for them: spacing top and
bottom, width, alignment, background, container width and responsive visibility
(SPEC.md §61). They are set with `blocks.design`, and every value is a *token*:

```ts
await design(app, home, hero, {
  spacingTop: 'xl',
  align: 'center',
  background: 'surface-sunken',
})
```

`xl` and `surface-sunken` mean whatever the *theme* says they mean, and nothing in a
page tree can express a colour, a pixel or a rule. That is what makes it safe to let
an agent set them.

The theme is a document too (SPEC.md §62). This site's palette is set in `src/seed.ts`
with `theme.update` — one command, validated, authorized and undoable like every other
— and the application renders it as a stylesheet at `/api/theme.css`, which
`app/index.html` links. Nobody, not a person and not an agent, can put CSS in it:
there is no command anywhere that takes any. `app/theme.css` is what is left over,
and it is only what a hero, a section and a feature card look like here.

## Two blocks that read live data

`team` and `openings` carry a heading and nothing else. The people and the roles are
fetched at render time from `GET /api/site/team` and `GET /api/site/openings`. A team
pasted into a page tree is wrong the first time somebody joins, and nobody is watching
for that; closing a role here is a toggle on the Open roles screen and no deploy.

The seed includes one closed role, which is why the careers page shows two.

## Serving a site to people with no account

Authorization denies by default, so a public site is a set of deliberate openings —
three routes in `src/routes.ts`, each opening exactly one thing.

The page tree cannot be opened with a policy. `pages.get` accepts `mode=draft`, and a
policy is asked "may this actor read pages" without being told which mode was
requested, so `read: () => true` would publish every unfinished draft on the site.
`GET /site/pages/:slug` insists instead: `status` published, and the published tree
rather than the draft beside it.

`app/preview.tsx` is therefore one document with two readers. The canvas asks for a
page by id, in draft, through the authorized query it already has a session for;
everybody else asks for a slug through the public route. One bundle, one renderer, one
set of block views — which is what makes the builder's preview accurate rather than
approximate (SPEC.md §59).

## No media, on purpose

Images here are paths into the site's own bundle, not entries in the media library.
`GET /api/media/*` runs the `media.get` query and therefore the policy for `media`,
which is right for an editor's uploads and wrong for a logo: a visitor with no session
gets a 403 where an image belongs. Opening that policy would also open `media.list` —
`list` and `get` are both `read` on the same subject — and publish the whole library
listing. Marketing images ship with the bundle; the library is for content.
