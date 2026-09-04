# The theme

```ts
await app.commands.execute('theme.update', {
  colors: { brand: '#2f3ba8', ink: '#12141c', surface: '#fbfbfd' },
  spacing: { xl: '7rem', '2xl': '10rem' },
  radius: { md: '0.875rem' },
})
```

That is the only way the look of a site changes. The caller may be a person in
Studio, a seed script, the SDK or an agent over MCP.

## Tokens

A block names a token, and the theme is where a name becomes a value.

```ts
await app.commands.execute('blocks.design', {
  id: page,
  blockId: hero,
  design: { spacingTop: 'xl', background: 'brand' },
})
```

Neither `xl` nor `brand` is a measurement or a colour. `@assemora/react` writes
them as references, and the stylesheet answers:

```html
<!-- what the renderer emits for that block -->
<div class="assemora-design" style="--assemora-space-top:var(--space-xl);--assemora-background:var(--brand)">
```

```css
/* what the theme declares */
:root { --space-xl: 7rem; --brand: #2f3ba8; }
```

That indirection is the whole design. A block author decides what a hero is made
of. A designer decides what the spacing scale is. An agent rearranges a page and
cannot invent a colour. None of them writes CSS. None of their APIs has a place
to put any.

## The five groups

Five groups (SPEC.md §62), and they are not the same kind of thing. This is the
resolved document an application has before anybody edits it, as `defaultTheme`
in `@assemora/theme` defines it:

```ts
const theme: ThemeTokens = {
  colors: {
    brand: '#4a5ed6',
    'brand-soft': '#e4e7fb',
    ink: '#16181d',
    'ink-soft': '#5b6070',
    line: '#dcdfe9',
    surface: '#ffffff',
    'surface-sunken': '#f6f7f9',
  },
  typography: {
    fonts: {
      body: ['ui-sans-serif', 'system-ui', '-apple-system', 'Segoe UI', 'sans-serif'],
      heading: ['ui-sans-serif', 'system-ui', '-apple-system', 'Segoe UI', 'sans-serif'],
      mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
    },
    sizes: { xs: '0.8125rem', sm: '0.9375rem', md: '1rem', lg: '1.25rem', xl: '1.75rem', '2xl': '2.5rem', '3xl': '3.5rem' },
    weights: { normal: 400, medium: 500, semibold: 600, bold: 700 },
    lineHeights: { tight: 1.15, normal: 1.55, loose: 1.8 },
  },
  spacing: { none: '0', xs: '0.5rem', sm: '1rem', md: '2rem', lg: '4rem', xl: '6rem', '2xl': '9rem' },
  radius: { none: '0', sm: '0.375rem', md: '0.75rem', lg: '1.25rem', full: '9999px' },
  container: { narrow: '34rem', normal: '48rem', wide: '68rem', full: '100%' },
}
```

`themeTokens()` is the schema behind that shape, and `ThemeTokens` is inferred from
it. Three groups have fixed keys and two are open.

## Spacing, radius and container

`spacing`, `radius` and `container` have fixed keys. They are the scales
`@assemora/schema` exports. The universal controls of §61 address them by name:

```ts
import { CONTAINER_WIDTHS, RADIUS_SCALE, SPACING_SCALE } from '@assemora/schema'

SPACING_SCALE    // ['none', 'xs', 'sm', 'md', 'lg', 'xl', '2xl']
RADIUS_SCALE     // ['none', 'sm', 'md', 'lg', 'full']
CONTAINER_WIDTHS // ['narrow', 'normal', 'wide', 'full']
```

A theme with no `xl` is a theme in which `spacingTop: 'xl'` renders nothing. That
failure lands in a visitor's browser, not at the edit that caused it. So you may
change what a step means, and you may not add or remove one:

```ts
await app.commands.execute('theme.update', { spacing: { xl: '7rem' } })
// ok

await app.commands.execute('theme.update', { spacing: { huge: '12rem' } })
// ValidationError: spacing.huge — Expected one of: none, xs, sm, md, lg, xl, 2xl
```

## Colours

`colors` is open: a site invents `brand-soft`. The framework has no opinion about
how many greys a brand needs. A token name is spelled the way `blockDesign.background`
spells one. So the theme is the list of colours there are, which closes something §61
left open.

```ts
await app.commands.execute('theme.update', {
  colors: { 'brand-soft': '#dfe3fb', accent: '#c2410c' },
})
```

A colour is hex in any of its four lengths, `transparent` or `currentColor`:

```ts
'#fff'          // ok
'#4a5ed6'       // ok
'#4a5ed680'     // ok, with alpha
'transparent'   // ok
'rgb(0, 0, 0)'  // refused: Expected a hex colour such as #4a5ed6, or transparent, or currentColor
```

## Typography

`typography` is open too, and it is four maps rather than one. Each map holds a single
kind of value and is checked as that kind.

```ts
await app.commands.execute('theme.update', {
  typography: {
    fonts: { heading: ['Fraunces', 'Georgia', 'serif'] }, // a font stack
    sizes: { display: '4rem' },                            // a length
    weights: { black: 900 },                               // an integer, 1 to 1000
    lineHeights: { snug: 1.3 },                            // a unitless ratio
  },
})
```

## Values

Every value is validated by kind, and the CSS is built rather than written. That is
the second sentence of §62, and it is a security property.

| Kind | What it accepts | What it renders |
| --- | --- | --- |
| Colour | `#rgb`, `#rgba`, `#rrggbb`, `#rrggbbaa`, `transparent`, `currentColor` | `--brand: #0f766e;` |
| Length | a number and one of `px rem em ch % vw vh`, or a bare `0` | `--space-xl: 7rem;` |
| Font stack | a list of family names, each matched, each quoted on the way out | `--font-body: "Inter", sans-serif;` |
| Weight | an integer, 1 to 1000 | `--weight-bold: 700;` |
| Line height | a unitless ratio | `--leading-normal: 1.55;` |

Nothing concatenates a stored string into a declaration. Every value is parsed into
its parts and the declaration is rebuilt from those parts:

```ts
colorCss('#FFF')          // '#fff'
lengthCss('1.50rem')      // '1.5rem'
lengthCss('0rem')         // '0'
fontStackCss(['Inter', 'sans-serif'])  // '"Inter", sans-serif'
```

So an injection is not an escaping problem. It is a refused command, and the refusal
names the token:

```ts
await app.commands.execute('theme.update', {
  typography: { fonts: { body: ['x; } body { display: none'] } },
})
// ValidationError: typography.fonts.body.0 — Expected a font family name such as Inter or ui-sans-serif
```

Assume the stored document is hostile and you arrive at the same design. It is
written by whoever holds `theme.update`, and by any agent whose proposal a person
applied. A value that will not re-parse on the way out produces no declaration:

```ts
themeCss({ ...theme, colors: { brand: 'red; position: fixed' } })
// the :root block has no --brand line
```

## theme.update

`theme.update` merges. Tokens you do not name are left alone, and a token set to
`null` stops being overridden.

```ts
const result = await app.commands.execute('theme.update', {
  colors: { brand: '#0f766e', 'brand-soft': null },
  spacing: { xl: '7rem' },
  typography: { fonts: { heading: ['Fraunces', 'Georgia', 'serif'] } },
  expectedVersion: 4,
})

result
// {
//   version: 5,
//   overrides: { colors: { brand: '#0f766e' }, spacing: { xl: '7rem' }, typography: { fonts: { heading: [...] } } },
//   tokens: { ...the defaults with those on top },
//   cssVersion: '9c1f4e2a7b3d5f60',
// }
```

A row stores the overrides, not the resolved document. What somebody decided is a
short list. What the site renders is that list on top of the framework's defaults.
That is what makes `null` mean one thing everywhere. It also keeps an agent's proposal
readable. A change set says `colors.brand → #0f766e`, not the whole document. One
consequence follows. You can override a default colour, and you cannot delete one.

```ts
// brand-soft goes back to the default, #e4e7fb. It does not disappear.
await app.commands.execute('theme.update', { colors: { 'brand-soft': null } })
```

A theme change is a revision, so `revisions.undo` puts it back. There is no
draft/published pair. A page is edited over hours and published deliberately. A theme
is a handful of values. The person changing them is looking at the result.

```ts
await app.commands.execute('revisions.undo', { entityType: 'theme', entityId: THEME_ID })
```

## Versions

`expectedVersion` is optional, and Studio always sends it. Stating it turns a lost
update into a 409 rather than a silent overwrite (SPEC.md §66).

```ts
const { version } = await app.queries.execute('theme.get', {}) // 4

await app.commands.execute('theme.update', { colors: { brand: '#0f766e' }, expectedVersion: 4 })
// ok: version 5

await app.commands.execute('theme.update', { colors: { brand: '#b91c1c' }, expectedVersion: 4 })
// ConflictError: The theme has changed since it was read
//   { expectedVersion: 4, currentVersion: 5 }
```

The write enforces that, not a comparison made after the read. The version you were
editing is a condition on the statement. The database answers with how many rows it
changed:

```ts
// packages/theme/src/write.ts, in outline
const changed = await adapter.execute({
  ...Theme.where('id', THEME_ID).where('version', expected).toAst(),
  operation: 'update',
  data: { tokens, version: expected + 1, updatedBy, updatedAt },
})

return changed === 1
```

Two callers who both read version 4 come out as one 409 and one success. Not as two
successes both claiming they wrote version 5.

Stating no version means "apply this on top of whatever is there". Somebody may commit
between your read and your write. Then your patch is re-applied to the row they left,
and the command answers with the version it really wrote. A merge is never a
conditional edit by accident. A conditional edit is never a merge by accident.

```ts
await app.commands.execute('theme.update', { colors: { brand: '#0f766e' } })
// { version: 6, ... } — whatever the row held, plus brand
```

A token nothing could have written is dropped, not defended. The row is JSONB. A seed
script, a migration or `psql` can put something in it that `theme.update` would
refuse. `themeCss` already writes no declaration for it. The next successful
`theme.update` takes it out of the row as well:

```ts
// the row holds colors.brand = 'red; position: fixed', put there out of band
await app.commands.execute('theme.update', {})
// ok — names nothing, cleans everything; brand is back to the default
```

The revision written for that edit still holds the row exactly as it was, so
`revisions.undo` puts even the damage back. A command is never refused for something it
did not do.

## The seed

`examples/company/src/seed.ts` sets the site's palette with the same command. Every
line of it used to be a line in a hand-written stylesheet.

```ts
const brand = (app: Application) =>
  app.commands.execute('theme.update', {
    colors: {
      brand: '#2f3ba8',
      ink: '#12141c',
      'ink-soft': '#5a6076',
      surface: '#fbfbfd',
      'surface-sunken': '#eef0f7',
    },
    // Roomier than the default scale: this site is mostly whitespace and one idea.
    spacing: { xl: '7rem', '2xl': '10rem' },
    container: { narrow: '32rem', normal: '46rem', wide: '72rem' },
    radius: { md: '0.875rem' },
  })
```

Only the differences are set. `brand-soft` and `line` are absent because the defaults
are already what this site wanted.

## theme.get

`theme.get` answers with both halves, because they answer different questions.

```ts
const { version, overrides, tokens, cssVersion, updatedAt } = await app.queries.execute('theme.get', {})

version     // 5, or 0 when nobody has edited the theme
overrides   // { colors: { brand: '#2f3ba8' }, spacing: { xl: '7rem', '2xl': '10rem' } }
tokens      // the whole document: the defaults with those on top
cssVersion  // '9c1f4e2a7b3d5f60'
updatedAt   // a Date, or null
```

`overrides` is what this site decided: what an editor edits and what a diff shows.
`tokens` is the resolved document a stylesheet is rendered from.

`cssVersion` is a hash of the rendered stylesheet, not of the document. That is the
difference between "changes when the CSS changes" and "changes when the row does".
Re-saving a theme unchanged must not cost every visitor a download.

## The stylesheet

`themeCss(tokens)` is a pure function, and the umbrella serves it. `@assemora/theme`
may not depend on `@assemora/http` (SPEC.md §8). So the addresses are mounted one
layer up, by `assemora()`. There are two of them:

```text
GET /api/theme.css              a redirect, never cached
GET /api/theme/<version>.css    the bytes, cached for a year
```

A document cannot know the version. `index.html` was built long before anybody chose
a colour. So it links the address that never changes, and that address answers with
the one that never goes stale:

```html
<link rel="stylesheet" href="/api/theme.css" />
```

```text
GET /api/theme.css
302 Location: /api/theme/9c1f4e2a7b3d5f60.css
Cache-Control: no-store

GET /api/theme/9c1f4e2a7b3d5f60.css
200 Content-Type: text/css; charset=utf-8
Cache-Control: public, max-age=31536000, immutable
```

What comes back is the tokens as `:root` custom properties, then the rules the
universal controls of §61 need, all inside `@layer assemora`:

```css
/* Generated from the theme (SPEC.md §62). Change tokens, not this file. */
@layer assemora {
  :root {
    --space-none: 0;
    --space-xs: 0.5rem;
    --space-sm: 1rem;
    --space-md: 2rem;
    --space-lg: 4rem;
    --space-xl: 7rem;
    --space-2xl: 10rem;
    --width-narrow: 32rem;
    --width-normal: 46rem;
    --width-wide: 72rem;
    --width-full: 100%;
    --radius-none: 0;
    --radius-sm: 0.375rem;
    --radius-md: 0.875rem;
    --radius-lg: 1.25rem;
    --radius-full: 9999px;
    --brand: #2f3ba8;
    --brand-soft: #e4e7fb;
    --ink: #12141c;
    --ink-soft: #5a6076;
    --line: #dcdfe9;
    --surface: #fbfbfd;
    --surface-sunken: #eef0f7;
    --font-body: ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
    --font-heading: ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
    --font-mono: ui-monospace, "SFMono-Regular", "Menlo", monospace;
    --text-xs: 0.8125rem;
    /* … one --text-* per size … */
    --text-3xl: 3.5rem;
    --weight-normal: 400;
    /* … one --weight-* per weight, one --leading-* per line height … */
    --leading-loose: 1.8;
  }

  body {
    margin: 0;
    font-family: var(--font-body);
    font-size: var(--text-md);
    line-height: var(--leading-normal);
    color: var(--ink);
    background-color: var(--surface);
  }

  .assemora-design {
    padding-top: var(--assemora-space-top, 0);
    padding-bottom: var(--assemora-space-bottom, 0);
    background-color: var(--assemora-background, transparent);
  }

  .assemora-design[data-width="narrow"] > * { max-width: var(--width-narrow); }
  .assemora-design[data-width="full"] > * { max-width: var(--width-full); }
  .assemora-design[data-container="wide"] { --container: var(--width-wide); }
  /* … alignment, the other widths, and responsive visibility … */
}
```

Those block rules are constant in every Assemora site and were never a project's to
write. Before ADR-0024 every application pasted them into a `theme.css` of its own.
That is the arbitrary global CSS §62 exists to remove.

`data-width="full"` reads `--width-full`, exactly as the other three widths read
theirs. Its default is `100%`, the width of the container itself. It is a token, so a
theme may change what "full" means. It cannot be `none`. A container width is a
length, and a keyword would be the one value in this document that is not one. A child
wider than its section is brought back to the section's width. It no longer overflows.

## Your own stylesheet

Your own stylesheet still exists, and it still wins. Unlayered rules beat layered
ones whatever their specificity. Nothing you write fights the generated file. What is
left in `examples/company/app/theme.css` is the part that was always the site's:

```css
.button {
  padding: 0.7rem 1.4rem;
  border-radius: var(--radius-full);
  background: var(--brand);
  color: var(--surface);
  font-weight: var(--weight-semibold);
}

.hero h1 {
  font-size: clamp(2.25rem, 5.5vw, 3.75rem);
  margin: 0 0 var(--space-xs);
}

.section {
  max-width: var(--container, var(--width-wide));
  padding-inline: var(--space-sm);
}
```

That is the line §62 draws. The theme owns what a token means. What a hero looks
like is a developer's job, and it reads the tokens by name.

## The table

Upgrading an existing project adds a table. `theme: true` is the default, so an
application that had no theme before now has `assemora_theme` in its schema.

```bash
assemora db:generate
assemora db:migrate
```

If you forget, the stylesheet does not fail. The route answers with the defaults and
writes an error to the log:

```json
{
  "level": "error",
  "message": "The theme could not be read; serving the default tokens",
  "error": "relation \"assemora_theme\" does not exist"
}
```

The tokens and the block rules of §61 are now served from here. A stylesheet that
500s is a site with no styling at all. A stylesheet of defaults is a site with the
framework's colours.

An application that never opens Design still gets a stylesheet. The defaults are in
code, not in a seeded row, so a project with no theme edits renders exactly as it did.
A project that answered no to an editable theme still gets one too:

```ts
assemora({ theme: false })
// GET /api/theme.css still answers, with the defaults, and reads no table
```

Both addresses sit under the API prefix. So `api: { rateLimit }` covers the public
stylesheet as well. It is one request per navigation at most. The redirect has no
body, and the bytes it points at are fetched once and cached for a year. Still, a very
low ceiling meant for an API is a low ceiling for a page load. Set it with that in
mind.

## The Design section

Studio's Design screen is the five groups, each editable, beside a sample drawn from
the tokens as you change them. The fixed groups are listed by their scale, with no
way to add or remove one. The open groups have both. Every edit is staged, and one
**Save** sends one `theme.update`. A theme is read as a whole, so it is changed as a
whole. What is unsaved is listed rather than implied.

```ts
// what Save sends, for a session that changed two tokens and removed one
await app.commands.execute('theme.update', {
  colors: { brand: '#0f766e', accent: null },
  spacing: { xl: '7rem' },
  expectedVersion: 5,
})
```

Two things it is careful about:

- A colour that stops existing is a colour a block can still name. Removing one says
  so before it saves. The builder's background list is this same document. It keeps
  showing a token a block names after the theme has dropped it, marked
  `not in the theme` rather than silently reading as "theme default".
- A concurrent edit is a 409, not a merge. Somebody else's newer theme comes back as a
  conflict with a reload, exactly as it does in the builder.

The preview is a panel rather than the builder canvas, and the reason is not weight.
The canvas renders against the served stylesheet. Previewing an unsaved theme there
would mean turning the document into CSS a second time, in the browser. That is a
second path from tokens to a stylesheet, which is the surface §62 exists to close. A
theme is also not a page, and an application can have no pages at all.

## What an agent may do

`theme.update` is a command, so it is an MCP tool by generation. `assemora.theme.update`
appears with its JSON Schema and passes the seven checks of §76. Like every other
mutation tool, it proposes. A person applies the change set (SPEC.md §75).

```json
{
  "name": "assemora.theme.update",
  "inputSchema": {
    "type": "object",
    "properties": {
      "colors": { "type": "object", "additionalProperties": { "type": "string", "nullable": true } },
      "spacing": {
        "type": "object",
        "properties": { "none": {}, "xs": {}, "sm": {}, "md": {}, "lg": {}, "xl": {}, "2xl": {} },
        "additionalProperties": false
      },
      "expectedVersion": { "type": "integer" }
    }
  }
}
```

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
