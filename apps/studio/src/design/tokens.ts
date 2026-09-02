/**
 * The five groups of SPEC.md §62, and what each token is called in CSS.
 *
 * The property names are not this file's choice. `--space-<step>` and the bare
 * `--<colour>` are what `@assemora/react` already emits for the universal controls of
 * §61, and the generated stylesheet defines exactly those names. The preview sets the
 * same ones, which is what keeps it from becoming a second opinion about what a token
 * means: it plants values under the names a browser will look them up by, and every
 * sample reads them with `var()`.
 *
 * The groups are not the same kind of thing, and the screen has to show that.
 * `spacing`, `radius` and `container` have fixed keys, because a block addresses them
 * by name and a theme missing `xl` is a theme in which `spacingTop: 'xl'` renders
 * nothing. `colors` and `typography` are open, because a site invents `brand-soft`.
 */
import { CONTAINER_WIDTHS, RADIUS_SCALE, SPACING_SCALE } from '@assemora/schema'

import type { TokenValue } from '../api/theme.ts'
import type { MessageKey } from '../i18n/messages.ts'

export type TokenKind = 'color' | 'length' | 'fontStack' | 'weight' | 'lineHeight'

/**
 * The keys a group may be headed by.
 *
 * Narrowed to the `design.group.` family rather than left as `MessageKey`, because `t`
 * asks for a message's parameters at the call site and so cannot be handed a key that
 * could be *any* of them. Written as an `Extract` so the set follows the catalogue.
 */
type GroupMessage = Extract<MessageKey, `design.group.${string}`>

export type TokenGroup = {
  /** Where it lives in the document: `['colors']`, `['typography', 'sizes']`. */
  readonly path: readonly string[]
  /** Named rather than written: a group is headed in the language Studio is read in. */
  readonly title: GroupMessage
  readonly help: GroupMessage
  readonly kind: TokenKind
  /** The keys it must have and may never gain or lose. Absent means a site decides. */
  readonly keys?: readonly string[]
  /** `--space-xl` for `xl`. What the generated stylesheet declares. */
  readonly property: (name: string) => string
}

const prefixed =
  (prefix: string) =>
  (name: string): string =>
    `--${prefix}${name}`

export const COLORS: TokenGroup = {
  path: ['colors'],
  title: 'design.group.colours',
  help: 'design.group.coloursHelp',
  kind: 'color',
  // Bare, with no prefix: `background: 'brand'` on a block renders `var(--brand)`.
  property: prefixed(''),
}

export const FONTS: TokenGroup = {
  path: ['typography', 'fonts'],
  title: 'design.group.fonts',
  help: 'design.group.fontsHelp',
  kind: 'fontStack',
  property: prefixed('font-'),
}

export const SIZES: TokenGroup = {
  path: ['typography', 'sizes'],
  title: 'design.group.sizes',
  help: 'design.group.sizesHelp',
  kind: 'length',
  property: prefixed('text-'),
}

export const WEIGHTS: TokenGroup = {
  path: ['typography', 'weights'],
  title: 'design.group.weights',
  help: 'design.group.weightsHelp',
  kind: 'weight',
  property: prefixed('weight-'),
}

export const LINE_HEIGHTS: TokenGroup = {
  path: ['typography', 'lineHeights'],
  title: 'design.group.lineHeights',
  help: 'design.group.lineHeightsHelp',
  kind: 'lineHeight',
  property: prefixed('leading-'),
}

export const SPACING: TokenGroup = {
  path: ['spacing'],
  title: 'design.group.spacing',
  help: 'design.group.spacingHelp',
  kind: 'length',
  keys: SPACING_SCALE,
  property: prefixed('space-'),
}

export const RADIUS: TokenGroup = {
  path: ['radius'],
  title: 'design.group.radius',
  help: 'design.group.radiusHelp',
  kind: 'length',
  keys: RADIUS_SCALE,
  property: prefixed('radius-'),
}

export const CONTAINER: TokenGroup = {
  path: ['container'],
  title: 'design.group.container',
  help: 'design.group.containerHelp',
  kind: 'length',
  keys: CONTAINER_WIDTHS,
  property: prefixed('width-'),
}

export const TYPOGRAPHY: readonly TokenGroup[] = [FONTS, SIZES, WEIGHTS, LINE_HEIGHTS]

/** The five groups of §62, flattened: typography is four maps rather than one. */
export const GROUPS: readonly TokenGroup[] = [COLORS, ...TYPOGRAPHY, SPACING, RADIUS, CONTAINER]

/** How one token is addressed across a whole document: `typography.sizes.2xl`. */
export const keyOf = (group: TokenGroup, name: string): string => [...group.path, name].join('.')

/**
 * The group a key belongs to.
 *
 * Unambiguous because a token name is letters, digits and dashes — never a dot — so
 * the group is always the whole key but its last segment.
 */
export const groupOfKey = (key: string): TokenGroup | undefined =>
  GROUPS.find((group) => key.startsWith(`${group.path.join('.')}.`))

/**
 * One group's tokens, out of a document or out of a set of overrides.
 *
 * Deliberately total and deliberately untyped at the entrance: overrides are a
 * partial document, and both shapes arrived over the wire. A group that is not there
 * is an empty group, never a thrown render.
 */
export const valuesOf = (
  document: unknown,
  group: TokenGroup,
): Readonly<Record<string, TokenValue>> => {
  let node: unknown = document

  for (const step of group.path) {
    if (typeof node !== 'object' || node === null) return {}

    node = (node as Readonly<Record<string, unknown>>)[step]
  }

  return typeof node === 'object' && node !== null && !Array.isArray(node)
    ? (node as Readonly<Record<string, TokenValue>>)
    : {}
}

/**
 * The tokens a group shows, in order.
 *
 * A fixed group is listed by its scale, so a step somebody's database is missing
 * still appears — as an empty row to fill in rather than a token that quietly is not
 * there. An open group is listed by what it holds, sorted the way the generated
 * stylesheet writes it.
 */
export const namesOf = (
  group: TokenGroup,
  values: Readonly<Record<string, TokenValue>>,
): readonly string[] => group.keys ?? Object.keys(values).sort()

/** True when this site has decided this token, rather than inheriting it. */
export const isOverridden = (overrides: unknown, group: TokenGroup, name: string): boolean =>
  name in valuesOf(overrides, group)

/** Two token values, compared. A font stack is a list, so `===` is not enough. */
export const sameValue = (left: TokenValue | undefined, right: TokenValue | undefined): boolean => {
  if (Array.isArray(left) && Array.isArray(right)) {
    return left.length === right.length && left.every((family, at) => family === right[at])
  }

  return left === right
}

/** What a person types into a new token before they have decided anything. */
export const blankValue = (kind: TokenKind): TokenValue => {
  switch (kind) {
    case 'color':
      return '#000000'
    case 'length':
      return '1rem'
    case 'fontStack':
      return ['sans-serif']
    case 'weight':
      return 400
    case 'lineHeight':
      return 1.5
  }
}

/**
 * A token name, as the command spells it.
 *
 * Studio checks it to keep the "Add" button from offering a save that cannot work;
 * the command is what actually decides, and a name it refuses comes back as a field
 * error like any other.
 */
const TOKEN_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

/** A colour becomes a bare custom property, so its name may not open with a digit. */
const COLOR_NAME = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/

export const nameProblem = (
  group: TokenGroup,
  name: string,
): 'design.name.colour' | 'design.name.token' | undefined => {
  if (name === '') return undefined

  const pattern = group.kind === 'color' ? COLOR_NAME : TOKEN_NAME

  if (!pattern.test(name)) {
    return group.kind === 'color' ? 'design.name.colour' : 'design.name.token'
  }

  return undefined
}
