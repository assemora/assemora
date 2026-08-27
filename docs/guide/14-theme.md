# The theme

A block says `spacingTop: 'xl'` and `background: 'brand'`. Neither of those is a
measurement or a colour — they are **names**, and the theme is where a name becomes a
value.

That indirection is the whole design. A block author decides what a hero is made of; a
designer decides what the site's spacing scale is; an agent rearranges a page without
being able to invent a colour. All three are working on the same site and none of them
is writing CSS, because there is nowhere in any of their APIs to put any.

```ts
await commands.execute('theme.update', { colors: { brand: '#2f3ba8' } })
```

That is the only way the look of a site changes, whether the caller is a person in
Studio, a seed script, the SDK or an agent over MCP.

## The document

Five groups (SPEC.md §62):

```json
{
  "colors":     { "brand": "#2f3ba8", "ink": "#12141c", "surface": "#fbfbfd" },
  "typography": {
    "fonts":       { "body": ["Inter", "sans-serif"] },
    "sizes":       { "md": "1rem", "2xl": "2.5rem" },
    "weights":     { "semibold": 600 },
    "lineHeights": { "normal": 1.55 }
  },
  "spacing":    { "none": "0", "xs": "0.5rem", "…": "…", "2xl": "9rem" },
  "radius":     { "none": "0", "sm": "0.375rem", "…": "…", "full": "9999px" },
  "container":  { "narrow": "34rem", "normal": "48rem", "wide": "68rem", "full": "100%" }
}
```

They are not the same kind of thing, and the difference is worth understanding before
you edit one.

**`spacing`, `radius` and `container` have fixed keys.** They are the scales
`@assemora/schema` exports — `SPACING_SCALE`, `RADIUS_SCALE`, `CONTAINER_WIDTHS` — and
they are fixed because the universal controls of §61 address them *by name*. A theme
with no `xl` is a theme in which `spacingTop: 'xl'` renders nothing at all, and that
failure lands in a visitor's browser rather than at the edit that caused it. You may
change what a step means. You may not add a step, and you may not take one away.

**`colors` and `typography` are open.** A site invents `brand-soft` and `display`, and
no framework should have an opinion about how many greys a brand needs. Typography is
four maps rather than one, so every entry holds a single kind of value — a stack, a
length, a weight, a ratio — and is checked as that kind.

The two together close something §61 left open: a block's `background` names a colour,
and the theme is now the list of colours there are.

## A value is a kind, and the CSS is built rather than written

This is the second sentence of §62, and it is a security property rather than tidiness.

A colour matches a colour: hex in any of its four lengths, `transparent` or
`currentColor`. A length matches a number and a unit from a short list. A font stack is
a list of family names, each one matched, each one quoted on the way out. Nothing
anywhere concatenates a stored string into a declaration — every value is parsed into
its parts and the declaration is *rebuilt* from those, which is why `#FFF` comes back
as `#fff` and `1.50rem` as `1.5rem`.

So `font-family: ["x; } body { display: none"]` is not an escaping problem. It is a
refused command, with the offending token named.

Assume the stored document is hostile and you arrive at the same design: it is written
by whoever holds `theme.update`, and by any agent whose proposal a person applied. A
value that will not re-parse on the way out produces no declaration rather than a
stylesheet somebody else wrote.

## Changing it

`theme.update` **merges**. Tokens you do not name are left alone — anything else would
make changing one colour an instruction to delete the other twenty. A token set to
`null` stops being overridden:

```ts
await commands.execute('theme.update', {
  colors: { brand: '#0f766e', 'brand-soft': null },
  spacing: { xl: '7rem' },
  typography: { fonts: { heading: ['Fraunces', 'Georgia', 'serif'] } },
  expectedVersion: 4,
})
```

It answers with `{ version, overrides, tokens, cssVersion }`.

**A row stores the overrides, not the resolved document.** What somebody decided is a
short list; what the site renders is that list on top of the framework's defaults. That
is what makes `null` mean exactly one thing everywhere — "stop overriding this" — and
what keeps an agent's proposal readable: a change set says `colors.brand → #0f766e`
rather than handing a person the whole document to approve. It also has one consequence
worth stating plainly: you can override a default colour, but you cannot delete one.

**`expectedVersion` is optional and Studio always sends it.** Stating it turns a lost
update into a 409 rather than a silent overwrite (SPEC.md §66).

It is the *write* that enforces that, not a comparison made after the read. The version
you were editing is a condition on the statement — "change this row while it still says
version 4" — and the database answers with how many rows it actually changed. That is
what makes two callers who both read version 1 come out as one 409 and one success,
rather than as two successes both claiming they wrote version 2.

Not stating one means what it says: apply this on top of whatever is there. If somebody
commits between your read and your write, your patch is re-applied to the row they left
and the command answers with the version it really wrote. So a merge is never a
conditional edit by accident, and a conditional edit is never a merge by accident.

**A token nothing could have written is dropped, not defended.** A row is JSONB, so a
seed script, a migration or `psql` can put something in it that `theme.update` would
never have accepted. `themeCss` already writes no declaration for such a value, and the
next successful `theme.update` takes it out of the row as well — so a document that has
been damaged out of band is repaired by editing the theme, and in the worst case by
`theme.update({})`, which names nothing and cleans everything. The revision written for
that edit still holds the row exactly as it was, so `revisions.undo` puts even the
damage back. What a command is never refused for is something it did not do.

**A theme change is a revision**, so `revisions.undo` puts it back, and there is no
draft/published pair. Pages have one because a page is edited over hours and published
deliberately; a theme is a handful of values and the person changing them is looking at
the result.

`examples/company/src/seed.ts` is a real one — every line of it used to be a line in a
hand-written stylesheet:

```ts
await app.commands.execute('theme.update', {
  colors: { brand: '#2f3ba8', ink: '#12141c', surface: '#fbfbfd' },
  // Roomier than the default scale: this site is mostly whitespace and one idea.
  spacing: { xl: '7rem', '2xl': '10rem' },
  container: { narrow: '32rem', normal: '46rem', wide: '72rem' },
  radius: { md: '0.875rem' },
})
```

Only the differences are set. `brand-soft` and `line` are absent because the defaults
are already what this site wanted.

## Reading it

```ts
const { version, overrides, tokens, cssVersion } = await queries.execute('theme.get', {})
```

Both halves, because they answer different questions. `overrides` is what this site
decided, which is what an editor edits and what a diff shows. `tokens` is the resolved
document — the defaults with those overrides on top — which is what a stylesheet is
rendered from.

`cssVersion` is a hash of the **rendered stylesheet**, not of the document. That is the
difference between "changes when the CSS changes" and "changes when the row does":
re-saving a theme unchanged must not cost every visitor a download.

## The stylesheet

`themeCss(tokens)` is a pure function, and `@assemora/theme` may not depend on
`@assemora/http` (SPEC.md §8), so the addresses are mounted one layer up. `assemora()`
does it for you, and there are two of them:

```text
GET /api/theme.css              a redirect, never cached
GET /api/theme/<version>.css    the bytes, cached for a year
```

A document cannot know the version — `index.html` was built long before anybody chose a
colour — so it links the address that never changes, and that address answers with the
one that never goes stale:

```html
<link rel="stylesheet" href="/api/theme.css" />
```

What comes back is the tokens as `:root` custom properties, followed by the rules the
universal controls of §61 need, all inside `@layer assemora`. Those block rules are
constant in every Assemora site and were never a project's to write; before ADR-0024
every application pasted them into a `theme.css` of its own, which is precisely the
arbitrary global CSS §62 exists to remove.

**Your own stylesheet still exists, and it still wins.** Unlayered rules beat layered
ones whatever their specificity, so nothing you write has to fight the generated file.
What is left in `examples/company/app/theme.css` after the theme took over is the part
that was always the site's:

```css
.hero h1 {
  font-size: clamp(2.25rem, 5.5vw, 3.75rem);
  margin: 0 0 var(--space-xs);
}

.section {
  max-width: var(--container, var(--width-wide));
  padding-inline: var(--space-sm);
}
```

That is the line §62 draws. The theme owns what a token means; what a hero looks like
is a developer's job, and it reads the tokens by name.

`data-width="full"` reads `--width-full`, exactly as the other three widths read theirs,
and its default is `100%` — the width of the container itself. That is a token, so a
theme may change what "full" means; what it cannot be is `none`, because a container
width is a length and a keyword would be the one value in this document that is not one.
The practical difference from a hand-written `max-width: none` is that a child wider
than its section is now brought back to the section's width instead of overflowing it.

**Upgrading an existing project adds a table.** `theme: true` is the default, so an
application that had no theme before now has `assemora_theme` in its schema — run
`assemora db:generate` and `assemora db:migrate` with the rest of the release. If you
forget, the stylesheet does not fail: the route answers with the defaults and writes an
error to the log, because the tokens and the block rules of §61 are now served from here
and a stylesheet that 500s is a site with no styling at all rather than a site with the
framework's colours.

**Both addresses sit under the API prefix**, so an application that tightens
`api: { rateLimit }` tightens it for its public stylesheet too. It is one request per
navigation at most — the redirect has no body, and the bytes it points at are fetched
once and then cached for a year — but a very low ceiling meant for an API is a low
ceiling for a page load, and worth setting with that in mind.

An application that never opens Design still gets a stylesheet: the defaults are in
code, not in a seeded row, so a project with no theme edits renders exactly as it did.
A project that answered no to an editable theme still gets one, because a site without
a spacing scale is not what "no Design section" meant.

## The Design section

Studio's Design screen is the five groups, each editable, beside a sample drawn from
the tokens as you change them. The fixed groups are listed by their scale with no way
to add or remove one; the open groups have both. Every edit is staged and one **Save**
sends one `theme.update` — a theme is read as a whole, so it is changed as a whole, and
what is unsaved is listed rather than implied.

Two things it is careful about:

- **A colour that stops existing is a colour a block can still name.** Removing one
  says so before it saves, and the builder's background list — which is this same
  document — keeps showing a token a block names even after the theme has dropped it,
  marked as missing rather than silently reading as "theme default".
- **A concurrent edit is a 409, not a merge.** Somebody else's newer theme comes back as
  a conflict with a reload, exactly as it does in the builder.

The preview is a panel rather than the builder canvas, and the reason is not weight: the
canvas renders against the *served* stylesheet, so previewing an unsaved theme would
mean turning the document into CSS a second time, in the browser — a second path from
tokens to a stylesheet, which is the surface §62 exists to close. A theme is also not a
page, and an application can have no pages at all.

## What an agent may do

`theme.update` is a command, so it is an MCP tool by generation: `assemora.theme.update`
appears with its JSON Schema, passes the seven checks of §76, and — like every other
mutation tool — **proposes**. A person applies the change set (SPEC.md §75).

There is no tool anywhere that takes CSS, because there is no command anywhere that
takes CSS. That is how "AI must change theme tokens rather than generate arbitrary
global CSS" became true by construction rather than by instruction.

## Where to look next

- [Pages and blocks](07-pages-and-blocks.md) — the universal controls, which are the
  names this document gives values to.
- [Agents and MCP](10-agents-and-mcp.md) — change sets, which is how a proposed theme
  reaches production.
- `docs/adr/0024-the-theme-is-a-document-and-a-stylesheet-is-its-output.md` — why the
  theme is a document and not a file.
- `examples/company/` — a site whose palette is a seed command and whose stylesheet is
  only its own rules.
