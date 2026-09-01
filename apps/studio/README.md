# @assemora/studio

Studio: a React SPA and a client of the application layer (SPEC.md §58).

```bash
pnpm --filter @assemora/playground dev   # the API, on :4000
pnpm --filter @assemora/studio dev       # Studio, on :5173
```

Vite proxies `/api` to the application, so the session cookie is first-party in
development exactly as it is in production.

## What is built

All of SPEC.md §115: login, navigation, resource CRUD, media, the API Explorer,
pages, the block builder, revision history, users, the developer section — and Design,
the five groups of theme tokens of SPEC.md §62.

The builder's canvas is an iframe running the *application's* frontend — the real
renderer, its block views, its theme (SPEC.md §59). Studio sends the tree in and gets
geometry and clicks back, and draws its selection outline over the frame, so nothing
it does changes what the page looks like.

## The rule that shapes everything here

Studio holds no knowledge of any particular application. It asks
`/api/_introspection` what exists and renders that:

- the navigation's collections are the registry's resources
- a table's columns, its search box and its sort options are the resource's fields
- a form is the field list, one input per `kind`
- the API Explorer is the registry's routes, with their real schemas
- the builder's block palette is the registry's blocks, with their nesting rules
- a block's properties panel is its own fields, drawn by the same inputs as a resource
  form — plus the seven universal design controls every block has (SPEC.md §61)
- the backgrounds those controls offer are the colours the generated stylesheet
  declares — a public artefact, so a person who may edit a block's design needs no
  permission over the theme — and Design is the five groups of the document that
  stylesheet is rendered from: Studio decides what no token means (SPEC.md §62)

So a `resource()` or a `block()` added to an application appears here with no Studio
change at all. Every write goes to a command through the API — never to the database,
and never past a policy (SPEC.md §14, §58). That includes every builder operation:
undo and redo are `revisions.undo` and `revisions.redo`, and an agent can call them.

## How it is drawn

`design_handoff_studio_redesign/` in the repository root is the visual source of truth,
and this application is built from it. What lives where:

- `src/styles.css` — the tokens. Every colour is the handoff's hex rather than a
  generated ramp: the palette is a fixed set of neutrals with one accent, so naming a
  colour in a perceptual space would only put a rounding error between the design and
  the screen. Base type is 13/1.4615, so `text-base` is 13px, `text-sm` is a 12px
  caption and `text-xs` is an 11px overline — not Tailwind's default scale.
- `src/ui/index.tsx` — the design system and the forms kit as one small vocabulary:
  buttons, fields, switch, checkbox, radio, segmented, badges, banners, skeletons.
  Anything a screen needs that is not here belongs here first.
- `src/ui/overlay.tsx` — menus, dialogs and toasts. Every menu is `position: fixed`
  against the viewport and flips above its trigger when the space below is short: the
  tables and panels are scrollers, and a menu positioned inside one is clipped by it.
- `src/ui/layout.tsx` — the shape of a screen: a header that stays, one scroller, and a
  footer or save bar pinned to the panel.
- `src/app/shell.tsx` — the 52px chrome bar, the 240px sidebar and its 56px rail, and
  the white content panel every screen but one is drawn inside.

The page builder is that one screen. It is a mode rather than a page, so it sits outside
the shell — see `shellRoute` in `src/app/router.tsx` — and takes the window edge to edge:
its own chrome bar, a 280px rail, the page as a sheet on the canvas, and an inspector
floating over the canvas that collapses to a pill when nothing is selected.

Four of the handoff's screens are deliberately not built, and each for the same reason:
the application has no command behind them. Sign-in draws one of its five states,
because `@assemora/auth` has no second factor, no reset link and no SSO, and no length
to attach to "keep me signed in". The Settings screen is not here at all: its ten groups
describe an editorial workflow, a plan, builds and deploys that no package declares, and
a settings form whose Save reaches nothing is worse than an absent one. The dashboard
takes four of the handoff's thirty-five widgets — the ones the Schema Registry can fill —
because a chart with no analytics port behind it is a plausible-looking fiction. They
arrive with the commands they need.
