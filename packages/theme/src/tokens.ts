/**
 * The token document (SPEC.md §62, ADR-0024).
 *
 * Five groups, and they are not the same kind of thing. `spacing`, `radius` and
 * `container` have fixed, required keys, because the universal controls of §61
 * address them by name: a theme with no `xl` is a theme in which `spacingTop: 'xl'`
 * renders nothing, and the failure lands in a browser rather than at the edit. Their
 * keys are the scales `@assemora/schema` already exports, so the scale a block
 * chooses from and the scale a theme defines cannot drift apart. `colors` and
 * `typography` are open, because a site invents `brand-soft` and no framework should
 * have an opinion about how many it needs.
 *
 * What a row stores is the *overrides*, not the resolved document, and `null` in a
 * patch means one thing everywhere — "stop overriding this". That is the answer a
 * properties panel needs and the one omission cannot express: it is the distinction
 * `blockDesignPatch` already draws for the controls of §61.
 */
import {
  CONTAINER_WIDTHS,
  type ContainerWidth,
  failWith,
  type InferShape,
  type Issue,
  type JsonSchema,
  nest,
  type ObjectSchema,
  type OptionalSchema,
  object,
  ok,
  type ParseResult,
  RADIUS_SCALE,
  type RadiusScale,
  type Schema,
  SPACING_SCALE,
  type SpacingScale,
} from '@assemora/schema'

import {
  COLOR_TOKEN_NAME,
  colorToken,
  fontStackToken,
  fontWeightToken,
  lengthToken,
  lineHeightToken,
  nameIssue,
  SCALE_TOKEN_NAME,
} from './values.js'

// --- maps of tokens ----------------------------------------------------------

/**
 * An open group: a site's own token names, all holding one kind of value.
 *
 * `colors` and the four typography maps are these. A framework that fixed their keys
 * would be a framework with an opinion about how many greys a brand needs.
 */
type OpenGroup<T> = Record<string, T>

/** A fixed group: exactly the members of a scale `@assemora/schema` exports. */
type ScaleGroup<K extends string> = Record<K, string>

/** The same group in a patch, where naming a token is how you change it. */
type ScaleGroupPatch<K extends string> = Partial<Record<K, string | null>>

type MapOptions<T> = {
  readonly value: Schema<T>
  /** Which keys this map admits. A key it refuses is an error, never a silent drop. */
  readonly allows: (key: string) => Issue | undefined
  /** Keys that must be present. Empty for a patch and for an open group. */
  readonly required: readonly string[]
  readonly json: JsonSchema
  readonly description: string
}

/**
 * A map of token names to values of one kind.
 *
 * An unknown key is refused rather than dropped, which is where this deliberately
 * differs from `object()` in `@assemora/schema`: dropping an unrecognised field is
 * the right answer to mass assignment and the wrong answer to an agent that believes
 * it just set `spacing.huge`. Inside a group, a key is either a token or a mistake.
 */
const tokenMap = <T>(options: MapOptions<T>): Schema<Record<string, T>> => ({
  kind: 'object',
  isOptional: false,
  isNullable: false,
  description: options.description,

  parse: (value: unknown): ParseResult<Record<string, T>> => {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      return failWith([{ path: [], code: 'type', message: 'Expected an object' }])
    }

    const source = value as Record<string, unknown>
    const issues: Issue[] = []
    const parsed: Record<string, T> = {}

    for (const [key, entry] of Object.entries(source)) {
      // Every name pattern here already refuses it — an underscore is not a token
      // name — but the assignment below is where it would matter, so the refusal is
      // stated where the risk is rather than inferred from a regex two files away.
      if (key === '__proto__') continue

      const rejected = options.allows(key)

      if (rejected !== undefined) {
        issues.push(rejected)
        continue
      }

      const result = options.value.parse(entry)

      if (result.ok) parsed[key] = result.value
      else issues.push(...nest(key, result.issues))
    }

    for (const key of options.required) {
      if (!(key in parsed) && !issues.some((issue) => issue.path[0] === key)) {
        issues.push({ path: [key], code: 'required', message: `The "${key}" token is required` })
      }
    }

    return issues.length > 0 ? failWith(issues) : ok(parsed)
  },

  toJsonSchema: () => options.json,
})

const openMap = <T>(
  value: Schema<T>,
  pattern: RegExp,
  description: string,
): Schema<Record<string, T>> =>
  tokenMap({
    value,
    allows: (key) => nameIssue(key, pattern),
    required: [],
    json: {
      type: 'object',
      additionalProperties: value.toJsonSchema(),
      propertyNames: { pattern: pattern.source },
      description,
    },
    description,
  })

const fixedMap = <T>(
  keys: readonly string[],
  value: Schema<T>,
  required: boolean,
  description: string,
): Schema<Record<string, T>> =>
  tokenMap({
    value,
    allows: (key) =>
      keys.includes(key)
        ? undefined
        : { path: [key], code: 'enum', message: `Expected one of: ${keys.join(', ')}` },
    required: required ? keys : [],
    json: {
      type: 'object',
      properties: Object.fromEntries(keys.map((key) => [key, value.toJsonSchema()])),
      ...(required ? { required: [...keys] } : {}),
      additionalProperties: false,
      description,
    },
    description,
  })

/**
 * A value that may also be `null`, meaning "stop overriding this".
 *
 * `clearable` in `@assemora/schema` makes a key optional as well, because a block's
 * controls live in a fixed shape. A token map has no fixed keys to make optional:
 * absence here is already expressed by not naming the token.
 */
const clearable = <T>(inner: Schema<T>): Schema<T | null> => ({
  ...inner,
  isNullable: true,
  parse: (value) => (value === null ? ok(null) : inner.parse(value)),
  toJsonSchema: () => ({ ...inner.toJsonSchema(), nullable: true }),
})

const optional = <T>(inner: Schema<T>): OptionalSchema<T> => ({
  ...inner,
  isOptional: true,
  parse: (value) => (value === undefined ? ok(undefined) : inner.parse(value)),
})

/**
 * A map's key type is erased the moment it is built from a list of names, and no
 * arrangement of generics brings it back — `Object.fromEntries` returns
 * `Record<string, …>` and a tuple mapped to schemas loses which member produced
 * which. The assertion is made once, here, against the scale that built the map;
 * every caller downstream is checked against the result.
 */
const keyedBy = <T>(schema: Schema<Record<string, unknown>>): Schema<T> => schema as Schema<T>

const scale = <K extends string>(keys: readonly K[], what: string): Schema<ScaleGroup<K>> =>
  keyedBy(fixedMap(keys, lengthToken(), true, what))

const partialScale = <K extends string>(
  keys: readonly K[],
  what: string,
): Schema<Partial<ScaleGroup<K>>> => keyedBy(fixedMap(keys, lengthToken(), false, what))

const scalePatch = <K extends string>(
  keys: readonly K[],
  what: string,
): Schema<ScaleGroupPatch<K>> => keyedBy(fixedMap(keys, clearable(lengthToken()), false, what))

// --- the three schemas -------------------------------------------------------

/**
 * Every type this package exports is read off one of these shapes.
 *
 * The document is declared once, as a schema, and the TypeScript type is inferred
 * from it — the rule the whole framework runs on (SPEC.md §3.4). Writing
 * `ThemeTokens` by hand beside `themeTokens()` would be the same description twice,
 * and the two would disagree the first time somebody added a group.
 */
type ThemeShape = {
  colors: Schema<OpenGroup<string>>
  typography: ObjectSchema<TypographyShape>
  spacing: Schema<ScaleGroup<SpacingScale>>
  radius: Schema<ScaleGroup<RadiusScale>>
  container: Schema<ScaleGroup<ContainerWidth>>
}

/**
 * Typography, as four maps rather than one.
 *
 * Each holds a single kind of value, which is what makes "validated by kind" a
 * property of the document rather than a rule somebody has to remember. A site names
 * its own entries — `body`, `display`, `mono`, `2xl` — and each map becomes one
 * prefixed family of custom properties.
 */
type TypographyShape = {
  fonts: Schema<OpenGroup<readonly string[]>>
  sizes: Schema<OpenGroup<string>>
  weights: Schema<OpenGroup<number>>
  lineHeights: Schema<OpenGroup<number>>
}

type TypographyOverrideShape = {
  fonts: OptionalSchema<OpenGroup<readonly string[]>>
  sizes: OptionalSchema<OpenGroup<string>>
  weights: OptionalSchema<OpenGroup<number>>
  lineHeights: OptionalSchema<OpenGroup<number>>
}

type TypographyPatchShape = {
  fonts: OptionalSchema<OpenGroup<readonly string[] | null>>
  sizes: OptionalSchema<OpenGroup<string | null>>
  weights: OptionalSchema<OpenGroup<number | null>>
  lineHeights: OptionalSchema<OpenGroup<number | null>>
}

type OverridesShape = {
  colors: OptionalSchema<OpenGroup<string>>
  typography: OptionalSchema<InferShape<TypographyOverrideShape>>
  spacing: OptionalSchema<Partial<ScaleGroup<SpacingScale>>>
  radius: OptionalSchema<Partial<ScaleGroup<RadiusScale>>>
  container: OptionalSchema<Partial<ScaleGroup<ContainerWidth>>>
}

type PatchShape = {
  colors: OptionalSchema<OpenGroup<string | null>>
  typography: OptionalSchema<InferShape<TypographyPatchShape>>
  spacing: OptionalSchema<ScaleGroupPatch<SpacingScale>>
  radius: OptionalSchema<ScaleGroupPatch<RadiusScale>>
  container: OptionalSchema<ScaleGroupPatch<ContainerWidth>>
}

/** The resolved theme: the defaults with whatever somebody set written over them. */
export type ThemeTokens = InferShape<ThemeShape>

export type ThemeTypography = ThemeTokens['typography']

/** What a row holds: only what somebody actually changed. */
export type ThemeOverrides = InferShape<OverridesShape>

/** What `theme.update` accepts: every key optional, every value clearable with `null`. */
export type ThemePatch = InferShape<PatchShape>

const colours = <T>(value: Schema<T>, what: string) => openMap(value, COLOR_TOKEN_NAME, what)

const typography = <T>(value: Schema<T>, what: string) => openMap(value, SCALE_TOKEN_NAME, what)

/**
 * The whole document, with every fixed key required.
 *
 * This is what `theme.get` answers with and what `themeCss` is handed. A theme that
 * does not satisfy it is a theme in which some block renders nothing.
 */
export const themeTokens = (): ObjectSchema<ThemeShape> =>
  object({
    colors: colours(colorToken(), 'Colours by token name, as a block names one'),
    typography: object({
      fonts: typography(fontStackToken(), 'Font stacks, by name'),
      sizes: typography(lengthToken(), 'The type scale, by name'),
      weights: typography(fontWeightToken(), 'Font weights, by name'),
      lineHeights: typography(lineHeightToken(), 'Line heights, by name'),
    }),
    spacing: scale<SpacingScale>(SPACING_SCALE, 'Spacing, one per step of the scale'),
    radius: scale<RadiusScale>(RADIUS_SCALE, 'Corner radii, one per step of the scale'),
    container: scale<ContainerWidth>(CONTAINER_WIDTHS, 'Container widths, one per width'),
  })

/** The overrides a row holds. Every group and every token optional. */
export const themeOverrides = (): ObjectSchema<OverridesShape> =>
  object({
    colors: optional(colours(colorToken(), 'Colour overrides')),
    typography: optional(
      object({
        fonts: optional(typography(fontStackToken(), 'Font stack overrides')),
        sizes: optional(typography(lengthToken(), 'Type scale overrides')),
        weights: optional(typography(fontWeightToken(), 'Font weight overrides')),
        lineHeights: optional(typography(lineHeightToken(), 'Line height overrides')),
      }),
    ),
    spacing: optional(partialScale<SpacingScale>(SPACING_SCALE, 'Spacing overrides')),
    radius: optional(partialScale<RadiusScale>(RADIUS_SCALE, 'Radius overrides')),
    container: optional(partialScale<ContainerWidth>(CONTAINER_WIDTHS, 'Container overrides')),
  })

/**
 * What `theme.update` takes, as a command input shape.
 *
 * Spread into the command rather than nested under a `tokens` key, so an agent writes
 * `{ colors: { brand: '#0f766e' } }` — the shape §62 prints, and one level shallower
 * than a wrapper would make it.
 */
export const themePatchShape: PatchShape = {
  colors: optional(colours(clearable(colorToken()), 'Colours to set, or null to reset')),
  typography: optional(
    object({
      fonts: optional(typography(clearable(fontStackToken()), 'Font stacks to set, or null')),
      sizes: optional(typography(clearable(lengthToken()), 'Type scale steps to set, or null')),
      weights: optional(typography(clearable(fontWeightToken()), 'Font weights to set, or null')),
      lineHeights: optional(
        typography(clearable(lineHeightToken()), 'Line heights to set, or null'),
      ),
    }),
  ),
  spacing: optional(scalePatch<SpacingScale>(SPACING_SCALE, 'Spacing steps to set, or null')),
  radius: optional(scalePatch<RadiusScale>(RADIUS_SCALE, 'Radii to set, or null')),
  container: optional(scalePatch<ContainerWidth>(CONTAINER_WIDTHS, 'Container widths, or null')),
}
