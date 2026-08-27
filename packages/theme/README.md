# @assemora/theme

The theme, as structured tokens, and the stylesheet they render to (SPEC.md §62).

```ts
const app = createApplication({ modules: [theme(), pages()] })

await app.commands.execute('theme.update', {
  colors: { brand: '#0f766e', 'brand-soft': null },
  spacing: { xl: '7rem' },
  typography: { fonts: { heading: ['Fraunces', 'Georgia', 'serif'] } },
})
```

`brand-soft: null` clears an override, `xl: '7rem'` sets one, and every token nobody
named is left alone. There is no `css` field anywhere in that call, and there is
nowhere to put one.

## Five groups, two kinds of group

§62 prints five: `colors`, `typography`, `spacing`, `radius`, `container`. They are
not the same kind of thing.

`spacing`, `radius` and `container` have **fixed, required keys**, because the
universal controls of §61 address them by name. A block that says `spacingTop: 'xl'`
is asking the theme a question, and a theme with no `xl` answers it with nothing —
in a browser, long after the edit that caused it. Their keys are the scales
`@assemora/schema` exports (`SPACING_SCALE`, `RADIUS_SCALE`, `CONTAINER_WIDTHS`), so
the list a block chooses from and the list a theme defines cannot drift apart.

`colors` and `typography` are **open**. A site invents `brand-soft`, and no framework
should have an opinion about how many greys it needs. A colour's token name is spelled
exactly as `blockDesign.background` spells one, which closes something §61 left open:
the theme is now the list of colours there are.

`typography` is four maps rather than one — `fonts`, `sizes`, `weights`,
`lineHeights` — so that each holds a single kind of value. That is what makes
"validated by kind" a property of the document instead of a rule somebody remembers.

## A value is validated by kind, and CSS is built by construction

This is the whole of §62's second sentence, and it is a security property.

| Kind | What it is | What it renders |
| --- | --- | --- |
| Colour | `#rgb`, `#rgba`, `#rrggbb`, `#rrggbbaa`, `transparent`, `currentColor` | `--brand: #0f766e;` |
| Length | a number and one of `px rem em ch % vw vh`, or a bare `0` | `--space-xl: 7rem;` |
| Font stack | a list of family names, each matched, each quoted on the way out | `--font-body: "Inter", sans-serif;` |
| Weight | an integer, 1 to 1000 | `--weight-bold: 700;` |
| Line height | a unitless ratio | `--leading-normal: 1.55;` |

Nothing anywhere concatenates a stored string into a declaration. Every value reaches
the stylesheet through a renderer that **parses it and writes from what it parsed**,
and the text it produced is checked once more before it is written. `#FFF` comes out
as `#fff` and `1.50rem` as `1.5rem` for that reason: those are rebuilt values, not
echoed ones.

The document is treated as hostile, because it is one edit away from being hostile:
whoever holds `theme.update` writes it, and so does any agent whose proposal a person
applied. `font-family` that accepted `x; } body { display: none` would hand them a
stylesheet, which is precisely what §62 forbids. The refusal happens **at the
command** — `src/theme.test.ts` carries the attempts, and `themeCss` refuses the same
values a second time in case one reached the row another way.

## An update is a merge, and `null` clears

A properties panel needs to say two different things: "leave this alone" and "put it
back the way it was". Omission says the first, so `null` says the second — the same
distinction `blockDesignPatch` draws for the controls of §61.

What a row stores is therefore the **overrides**, not the resolved document. The
defaults live in code, so "reset this token" has something to reset to, a revision
diff is the short list of what somebody actually decided, and an application that has
never opened Design has no row at all.

```ts
const { version, overrides, tokens, cssVersion } = await app.queries.execute('theme.get', {})
```

`overrides` is what Studio's Design panel edits. `tokens` is the resolved document.

## The stylesheet is a route, and the umbrella declares it

This package may not depend on `@assemora/http` (SPEC.md §8), so it exports the pure
function and the umbrella mounts it — the same arrangement as the login route over
`@assemora/auth` and the media URLs over `@assemora/media` (ADR-0022).

```ts
server.route(
  route('GET', '/theme.css', {
    handle: async () => {
      const { tokens } = await queries.execute('theme.get', {})

      return bytes(Buffer.from(themeCss(tokens)), 'text/css; charset=utf-8')
    },
  }),
)
```

The URL carries `cssVersion` rather than trusting a cache header, because the one
thing a generated stylesheet must never be is stale. The version is a hash of the
rendered CSS, not of the row: it changes when and only when what a browser receives
changes, so re-saving a theme unchanged costs nobody a download.

The output is wrapped in `@layer assemora`, so a site's own stylesheet always wins
without anybody counting selectors. It carries the `:root` tokens **and** the
`.assemora-design` rules the controls of §61 need — those are constant in every
Assemora site, and asking each project to paste them is asking for the hand-written
global CSS §62 exists to replace.

## An agent edits the theme because it is a command

`theme.update` becomes an MCP tool by generation (ADR-0020) and passes the seven
checks of §76 like every other tool. There is no tool anywhere that takes CSS,
because there is no command anywhere that takes CSS — which is how §62's second
sentence is true by construction rather than by instruction.

## One row, deliberately

Multi-site is not part of v1 (SPEC.md §5). A table that could hold two themes would
need a way to say which one a request meant — in the stylesheet URL, in Studio, in
every tool — so the id is the constant `THEME_ID` and a second row is something
nothing here can produce.
