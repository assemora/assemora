/**
 * What a token value may be, and how it becomes CSS (SPEC.md §62, ADR-0024).
 *
 * This file is the whole of §62's second sentence. A person or an agent editing the
 * theme must not be able to author CSS, so a value is never a fragment of a
 * stylesheet that we agree to trust: it is a colour, a length, a font stack, a weight
 * or a ratio, parsed into its parts, and the declaration is *built* from those parts.
 *
 * Every kind therefore comes in two halves that must stay together — a schema that
 * refuses anything else at the command, and a `…Css` renderer that parses again and
 * writes from what it parsed. The second half exists because the first cannot protect
 * a stored document: the row is JSONB, its TypeScript type is a claim rather than a
 * guarantee, and anyone who reaches the database reaches the stylesheet. Nothing in
 * `css.ts` touches a stored string except through a renderer here, and no renderer
 * ever returns a string it did not construct.
 */
import {
  type ArraySchema,
  array,
  type Issue,
  type NumberSchema,
  number,
  type StringSchema,
  string,
} from '@assemora/schema'

/**
 * Everything these renderers can possibly produce.
 *
 * The last gate, and deliberately paranoid: a declaration value is checked against
 * this after it has been built, so a mistake in a renderer becomes a missing
 * declaration rather than an injection. `;`, `{`, `}`, `<`, `(`, `)`, `\`, `/`, `:`
 * and every whitespace character other than a space are outside it, which rules out
 * ending a declaration, opening a block or a comment, closing a `<style>` element and
 * writing a `url()` — the six shapes an attack takes.
 */
const SAFE_DECLARATION_VALUE = /^[A-Za-z0-9 "#,.%-]+$/

/** True when this text is safe to write after a colon. Used on output, never on input. */
export const isSafeDeclarationValue = (value: string): boolean => SAFE_DECLARATION_VALUE.test(value)

/**
 * The gate itself. Exported so it can be tested as what it is.
 *
 * Nothing outside this file calls it, and `index.ts` does not re-export it: it is not
 * part of the package's API, it is the last line of its defence. A gate no test can
 * make refuse anything is a gate that can quietly stop being applied on one path —
 * which is exactly what happened to the keyword branch of `colorCss` below.
 */
export const guard = (built: string): string | undefined =>
  isSafeDeclarationValue(built) ? built : undefined

// --- colours -----------------------------------------------------------------

/**
 * Hex, in the four lengths CSS accepts, plus the two keywords a theme actually needs.
 *
 * No `rgb()`, `hsl()` or `oklch()`: each functional notation is a grammar of its own,
 * with its own component ranges and its own legacy comma form, and a parser per
 * function is five more places for a mistake to become a stylesheet. Alpha — the one
 * thing hex was missing — is covered by the four- and eight-digit forms, so the
 * omission costs a theme nothing it cannot say another way.
 */
const HEX = /^#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/

/**
 * `transparent` is a colour a section can be; `currentColor` is how a border follows
 * its text. Both are written from this table rather than echoed, so the casing a
 * theme stored cannot reach the output.
 *
 * A `Map` rather than an object literal, and that is not a style choice. An object
 * literal answers for every key on `Object.prototype` too, so a stored colour of
 * `constructor` — the one all-lowercase key there is — used to find a function, and
 * `__proto__` found the prototype itself. A `Map` holds what was put in it and
 * nothing else, so a lookup can only ever answer with a colour.
 */
const COLOR_KEYWORDS: ReadonlyMap<string, string> = new Map([
  ['transparent', 'transparent'],
  ['currentcolor', 'currentColor'],
])

export const colorToken = (): StringSchema =>
  string()
    .pattern(
      /^(?:#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})|[Tt]ransparent|[Cc]urrent[Cc]olor)$/,
      'Expected a hex colour such as #4a5ed6, or transparent, or currentColor',
    )
    .describe('A colour: #rgb, #rgba, #rrggbb, #rrggbbaa, transparent or currentColor')

export const colorCss = (value: unknown): string | undefined => {
  if (typeof value !== 'string') return undefined

  // Through the gate like every other path, rather than trusted because it came from
  // a table here: "the last gate" is only last if nothing walks past it.
  const keyword = COLOR_KEYWORDS.get(value.toLowerCase())
  if (keyword !== undefined) return guard(keyword)

  // Rebuilt from the digits, lower-cased, so `#FFF` and `#fff` are one stylesheet
  // and one cache version.
  return HEX.test(value) ? guard(`#${value.slice(1).toLowerCase()}`) : undefined
}

// --- lengths -----------------------------------------------------------------

/**
 * The units a theme may use.
 *
 * Short on purpose. Physical units (`cm`, `pt`) belong to print, and the viewport and
 * container query units beyond these two are a layout decision rather than a token.
 */
export const LENGTH_UNITS = ['px', 'rem', 'em', 'ch', '%', 'vw', 'vh'] as const

export type LengthUnit = (typeof LENGTH_UNITS)[number]

/**
 * `0`, or up to four digits and four decimals followed by a unit.
 *
 * The digit limits are not tidiness: they are what keeps `String(value)` out of
 * exponential notation, so the number written into the stylesheet is always the plain
 * decimal this matched.
 *
 * The size limit is *this pattern* and nothing else, which is the point. It used to
 * admit five digits and the parser then dropped anything past ten thousand, so the
 * schema accepted `20000px` at the command and the renderer wrote no `--space-xl` at
 * all: a required token deleted from the stylesheet by a 200 OK. Two halves of one
 * bound will disagree eventually, so there is one half. It is also the pattern
 * published in OpenAPI and in the MCP tool schema, so what an agent is told it may
 * write is exactly what will reach the CSS.
 */
const LENGTH = /^(?:0|(\d{1,4}(?:\.\d{1,4})?)(px|rem|em|ch|%|vw|vh))$/

type Length = { readonly value: number; readonly unit: LengthUnit }

const parseLength = (value: unknown): Length | undefined => {
  if (typeof value !== 'string') return undefined

  const match = LENGTH.exec(value)
  if (match === null) return undefined

  const [, digits, unit] = match

  // The `0` branch matched, which needs no unit and gets `rem` so the shape is total.
  if (digits === undefined || unit === undefined) return { value: 0, unit: 'rem' }

  return { value: Number(digits), unit: unit as LengthUnit }
}

export const lengthToken = (): StringSchema =>
  string()
    .pattern(LENGTH, 'Expected a length such as 1.5rem, 24px or 0')
    .describe(`A length: a number and one of ${LENGTH_UNITS.join(', ')}, or a bare 0`)

export const lengthCss = (value: unknown): string | undefined => {
  const length = parseLength(value)

  if (length === undefined) return undefined

  // A unitless zero, because `0rem` and `0` are the same length and only one of them
  // is what a person reading the stylesheet expects.
  return guard(length.value === 0 ? '0' : `${length.value}${length.unit}`)
}

// --- font stacks -------------------------------------------------------------

/**
 * One family name.
 *
 * Letters, digits, single spaces and single dashes, optionally opening with a dash so
 * that `-apple-system` is sayable. That excludes the quote and the backslash, which is
 * what makes quoting the name on the way out safe by construction rather than by
 * escaping, and it excludes `--`, so a family name cannot become a variable
 * reference.
 */
const FAMILY = /^-?[A-Za-z][A-Za-z0-9]*(?:[ -][A-Za-z0-9]+)*$/

/**
 * The names that must be written bare.
 *
 * A quoted string in `font-family` is a request for a font with that literal name, so
 * quoting a generic family or a system alias asks for a font nobody has installed.
 * Everything else is quoted, which is always valid for a real family.
 */
const UNQUOTED = new Set([
  'serif',
  'sans-serif',
  'monospace',
  'cursive',
  'fantasy',
  'system-ui',
  'ui-serif',
  'ui-sans-serif',
  'ui-monospace',
  'ui-rounded',
  'math',
  'emoji',
  'fangsong',
  '-apple-system',
  'BlinkMacSystemFont',
])

export const fontStackToken = (): ArraySchema<StringSchema> =>
  array(string().pattern(FAMILY, 'Expected a font family name such as Inter or ui-sans-serif'))
    .min(1)
    .max(12)
    .describe('A font stack, most preferred family first')

export const fontStackCss = (value: unknown): string | undefined => {
  if (!Array.isArray(value) || value.length === 0) return undefined

  const families: string[] = []

  for (const family of value) {
    if (typeof family !== 'string' || !FAMILY.test(family)) return undefined

    families.push(UNQUOTED.has(family) ? family : `"${family}"`)
  }

  return guard(families.join(', '))
}

// --- weights and ratios ------------------------------------------------------

export const fontWeightToken = (): NumberSchema =>
  number().integer().min(1).max(1000).describe('A font weight, 1 to 1000')

export const fontWeightCss = (value: unknown): string | undefined =>
  typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 1000
    ? guard(String(value))
    : undefined

export const lineHeightToken = (): NumberSchema =>
  number().min(0.5).max(10).describe('A unitless line height, such as 1.55')

export const lineHeightCss = (value: unknown): string | undefined => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined
  if (value < 0.5 || value > 10) return undefined

  // The text about to be written is checked, rather than the number: that is what
  // rules out `1e-7` and every other way `String` can surprise a reader.
  const written = String(value)

  return /^\d+(?:\.\d+)?$/.test(written) ? guard(written) : undefined
}

// --- token names -------------------------------------------------------------

/**
 * A colour token's name.
 *
 * Exactly what `blockDesign.background` accepts in `@assemora/schema`, because a
 * colour becomes the bare custom property `--brand` and a block names it by writing
 * `background: 'brand'`. A name this refuses is a name no block could ever ask for.
 */
export const COLOR_TOKEN_NAME = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/

/**
 * A name in a prefixed group — `--text-2xl`, `--weight-semibold`.
 *
 * A leading digit is allowed here and nowhere else: the group's prefix is what keeps
 * the property name well formed, and `2xl` is the name a type scale actually uses.
 */
export const SCALE_TOKEN_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

export const nameIssue = (key: string, pattern: RegExp): Issue | undefined =>
  pattern.test(key)
    ? undefined
    : {
        path: [key],
        code: 'token-name',
        message: 'A token name is lowercase letters, digits and single dashes',
      }
