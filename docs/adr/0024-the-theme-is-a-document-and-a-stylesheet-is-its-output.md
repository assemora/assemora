# 0024. The theme is a stored document; a stylesheet is what comes out of it

Status: accepted
Date: 2026-08-27

## Context

SPEC.md §62 is four lines and a JSON skeleton:

> The theme is stored as structured tokens.
> ```json
> { "colors": {}, "typography": {}, "spacing": {}, "radius": {}, "container": {} }
> ```
> AI must change theme tokens rather than generate arbitrary global CSS.

It names no table, no command and no route, which is why it outlasted every phase:
SPEC.md §58 lists **Design** in Studio's primary navigation, and there was nothing for
that screen to edit. Meanwhile §61's seven universal controls have shipped since phase
8 and they are already token *names* — a block says `spacingTop: 'xl'` and
`background: 'surface-sunken'`, and `@assemora/react` renders `var(--space-xl)` and
`var(--surface-sunken)`. What those mean has been a hand-written `theme.css` in each
application: exactly the "arbitrary global CSS" §62 exists to replace, one file below
where anybody was looking.

## Decision

**`@assemora/theme` owns the document.** A small package beside `revisions`, `audit`
and `change-sets`: a model, `theme.get`, `theme.update`, and the pure function that
renders tokens as CSS. It depends on `schema`, `core` and `data` and nothing else.

**The five groups of §62 are not all the same kind of thing.** `spacing`, `radius` and
`container` have **fixed, required keys**, because §61's controls address them by
name: a theme with no `xl` is a theme in which `spacingTop: 'xl'` renders nothing, and
the failure lands in a browser rather than at the edit. Their keys are the constants
`@assemora/schema` already exports — `SPACING_SCALE`, `CONTAINER_WIDTHS` — so the
scale a block chooses from and the scale a theme defines cannot drift apart.
`colors` and `typography` are **open**, because a site invents `brand-soft` and no
framework should have opinions about how many it needs.

That closes something §61 left open: a block's `background` names a colour, and the
theme is now the list of colours there are. A background token nothing declares is a
refused command, not a transparent section.

**A value is validated by kind and CSS is built by construction.** A colour matches a
colour; a length matches a number and a unit from a fixed list; a font stack is a list
of family names, each matched, and quoted when written. Nothing anywhere concatenates
a stored string into a declaration. This is not tidiness: the whole of §62's second
sentence is that a person or an agent editing the theme must not be able to author
CSS, and a `font-family` that accepts `x; } body { display: none` hands them a
stylesheet.

**The stylesheet is a route, and the umbrella declares it.** `@assemora/theme` may not
depend on `@assemora/http` (SPEC.md §8), so it exports `themeCss(tokens)` and the
umbrella mounts it — the same arrangement as the login route over `@assemora/auth` and
the media URLs over `@assemora/media` (ADR-0022). A stylesheet, rather than custom
properties injected into every page, because it is cacheable, it works for a
server-rendered page with no JavaScript, and it is the one artefact a designer can
open and read.

**A theme change applies at once, and is a revision.** No draft/published pair. Pages
have one because a page is edited over hours and published deliberately; a theme is a
handful of values and the person changing them is looking at the result. What
protects production is what protects it everywhere else: an agent proposes, a person
applies (SPEC.md §75), every change is a revision, and undo puts it back.

**An agent edits the theme because `theme.update` is a command.** It becomes an MCP
tool by generation (ADR-0020), it passes the seven checks of §76, and there is no tool
anywhere that takes CSS. §62's second sentence is therefore true by construction
rather than by instruction.

## Consequences

- An application that ships no theme still renders: `themeCss` writes the defaults,
  which are the values the examples' hand-written stylesheets already used. A site
  with no Design edits looks exactly as it did.
- A site's own rules stay in a stylesheet it writes. The theme owns the tokens §61 and
  §62 name and nothing else, so "make the header sticky" is still a developer's job —
  which is the line §61 draws and this decision keeps.
- The stylesheet has to be invalidated when the theme changes. It is served with a
  version in its URL rather than a cache header nobody can bust, and the version comes
  from the document.
- Two applications sharing a database share a theme. Multi-site is not part of v1
  (SPEC.md §5) and the table is deliberately single-row.

## Alternatives

**The theme inside `@assemora/pages`** — rejected. A theme is not a page, and pages
already own the largest surface in the framework; a site with no page builder still
has colours.

**Tokens injected as inline custom properties by the renderer** — rejected. It puts
the whole theme in every document, defeats caching, and does nothing for a page
rendered without the React renderer.

**A free-form `Record<string, string>` for every group** — rejected. It is what makes
`font-family` an injection point, and it lets a theme silently lack the token a block
asks for.
