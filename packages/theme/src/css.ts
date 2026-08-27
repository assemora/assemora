/**
 * The stylesheet a token document renders to (SPEC.md §62, ADR-0024).
 *
 * Pure: no HTTP, no database, no clock. `@assemora/theme` may not depend on
 * `@assemora/http` (SPEC.md §8), so this is what it hands the umbrella, which mounts
 * the route — the same arrangement as the login route over `@assemora/auth`.
 *
 * Not one line here concatenates a stored string into a declaration. Every value
 * reaches the output through a renderer in `values.ts`, which parses it and writes
 * from what it parsed, and a value that will not parse produces no declaration at
 * all. That is why the document can be treated as hostile: it is never trusted, only
 * read.
 *
 * The custom property names are not a choice this file gets to make. `--space-<token>`
 * and the bare `--<colour>` are what `@assemora/react` already emits for the controls
 * of §61, and `--width-<token>` is what the block rules below key on.
 */

import { createHash } from 'node:crypto'
import { CONTAINER_WIDTHS, RADIUS_SCALE, SPACING_SCALE } from '@assemora/schema'

import type { ThemeTokens } from './tokens.js'
import { colorCss, fontStackCss, fontWeightCss, lengthCss, lineHeightCss } from './values.js'

/** A custom property name, checked on the way out like every declaration value. */
const PROPERTY_NAME = /^--[a-z0-9]+(?:-[a-z0-9]+)*$/

const declaration = (name: string, value: string | undefined): string | undefined =>
  value === undefined || !PROPERTY_NAME.test(name) ? undefined : `${name}: ${value};`

const present = (lines: readonly (string | undefined)[]): string[] =>
  lines.filter((line): line is string => line !== undefined)

/**
 * A group, whatever was actually there.
 *
 * The parameter type says every group is present; a document read out of JSONB says
 * whatever it likes. A missing group renders as an absent group rather than a thrown
 * request, which is the same answer this file gives to every other kind of nonsense.
 */
const groupOf = (values: unknown): Readonly<Record<string, unknown>> =>
  typeof values === 'object' && values !== null && !Array.isArray(values)
    ? (values as Readonly<Record<string, unknown>>)
    : {}

/**
 * Open groups are written in key order.
 *
 * Not cosmetic: the version is a hash of this output, and a theme whose stylesheet
 * changed because two keys were stored in a different order would invalidate every
 * cached copy for nothing.
 */
const openGroup = (
  prefix: string,
  values: unknown,
  render: (value: unknown) => string | undefined,
): string[] => {
  const group = groupOf(values)

  return present(
    Object.keys(group)
      .sort()
      .map((key) => declaration(`--${prefix}${key}`, render(group[key]))),
  )
}

const scaleGroup = (prefix: string, keys: readonly string[], values: unknown): string[] => {
  const group = groupOf(values)

  return present(keys.map((key) => declaration(`--${prefix}${key}`, lengthCss(group[key]))))
}

/**
 * Everything that is the same in every Assemora site.
 *
 * It is here rather than in each application's own stylesheet because it is the
 * contract `@assemora/react` renders against: the wrapper it draws is inert until
 * these rules exist, and asking every project to paste them is asking for exactly the
 * hand-written global CSS §62 exists to remove. Nothing in it comes from the
 * document — it is constant text, and the tokens reach it only through `var()`.
 */
const BLOCK_RULES = `/* The reset, minimal: a box model, and a body that is not inset. */
* {
  box-sizing: border-box;
}

body {
  margin: 0;
  font-family: var(--font-body);
  font-size: var(--text-md);
  line-height: var(--leading-normal);
  color: var(--ink);
  background-color: var(--surface);
}

/* The seven universal controls of SPEC.md §61, applied. */
.assemora-design {
  padding-top: var(--assemora-space-top, 0);
  padding-bottom: var(--assemora-space-bottom, 0);
  background-color: var(--assemora-background, transparent);
  background-image: var(--assemora-background-image, none);
  background-size: cover;
  background-position: center;
}

.assemora-design[data-width] > * {
  margin-inline: auto;
}

.assemora-design[data-width="narrow"] > * {
  max-width: var(--width-narrow);
}

.assemora-design[data-width="normal"] > * {
  max-width: var(--width-normal);
}

.assemora-design[data-width="wide"] > * {
  max-width: var(--width-wide);
}

/* "full" is the container's own width, and a token like the other three: a keyword
   here would be the one width a theme is not allowed to change. */
.assemora-design[data-width="full"] > * {
  max-width: var(--width-full);
}

.assemora-design[data-align="start"] {
  text-align: left;
}

.assemora-design[data-align="center"] {
  text-align: center;
}

.assemora-design[data-align="end"] {
  text-align: right;
}

.assemora-design[data-container="narrow"] {
  --container: var(--width-narrow);
}

.assemora-design[data-container="normal"] {
  --container: var(--width-normal);
}

.assemora-design[data-container="wide"] {
  --container: var(--width-wide);
}

.assemora-design[data-container="full"] {
  --container: var(--width-full);
}

@media (max-width: 640px) {
  .assemora-design[data-hidden-mobile] {
    display: none;
  }
}

@media (min-width: 641px) and (max-width: 1024px) {
  .assemora-design[data-hidden-tablet] {
    display: none;
  }
}

@media (min-width: 1025px) {
  .assemora-design[data-hidden-desktop] {
    display: none;
  }
}

/* An editor sees what it is about to unhide; a visitor never reaches this rule. */
[data-assemora-hidden="true"] {
  opacity: 0.4;
}`

const indent = (text: string, by: string): string =>
  text
    .split('\n')
    .map((line) => (line === '' ? '' : `${by}${line}`))
    .join('\n')

/**
 * The tokens, as `:root` declarations, then the rules that read them.
 *
 * Wrapped in a cascade layer so that a site's own stylesheet always wins without
 * anybody counting selectors: unlayered rules beat layered ones, whatever their
 * specificity. That is what keeps ADR-0024's promise that a site's own rules stay in
 * a stylesheet it writes, and it is why an application that still ships a
 * hand-written `theme.css` keeps looking exactly as it did.
 */
export const themeCss = (tokens: ThemeTokens): string => {
  const type = groupOf(tokens.typography)

  const properties = [
    ...scaleGroup('space-', SPACING_SCALE, tokens.spacing),
    ...scaleGroup('width-', CONTAINER_WIDTHS, tokens.container),
    ...scaleGroup('radius-', RADIUS_SCALE, tokens.radius),
    ...openGroup('', tokens.colors, colorCss),
    ...openGroup('font-', type.fonts, fontStackCss),
    ...openGroup('text-', type.sizes, lengthCss),
    ...openGroup('weight-', type.weights, fontWeightCss),
    ...openGroup('leading-', type.lineHeights, lineHeightCss),
  ]

  const root = `:root {\n${indent(properties.join('\n'), '  ')}\n}`

  return [
    '/* Generated from the theme (SPEC.md §62). Change tokens, not this file. */',
    '@layer assemora {',
    indent(`${root}\n\n${BLOCK_RULES}`, '  '),
    '}',
    '',
  ].join('\n')
}

/**
 * What goes in the stylesheet's URL.
 *
 * Taken from the rendered stylesheet rather than from the document, which is the
 * difference between "changes when the CSS changes" and "changes when the row does":
 * `1.50rem` and `1.5rem` are one stylesheet, and re-saving a theme unchanged must not
 * cost every visitor a download. A cache key, not a signature — sixteen hex
 * characters is far past the point where a collision matters and short enough to read
 * in a URL.
 */
export const themeVersion = (tokens: ThemeTokens): string =>
  createHash('sha256').update(themeCss(tokens)).digest('hex').slice(0, 16)
