/**
 * `@assemora/theme` — the theme as structured tokens (SPEC.md §62).
 *
 * §62 is four lines and a JSON skeleton, and this is the contract behind it: five
 * groups of tokens, values validated by kind, and a stylesheet built from them by
 * construction. Nobody edits CSS — not a developer, not a person in Studio, not an
 * agent — because there is nowhere to put any.
 *
 * ```ts
 * const app = createApplication({ modules: [theme(), pages()] })
 *
 * await app.commands.execute('theme.update', {
 *   colors: { brand: '#0f766e', 'brand-soft': null },
 *   spacing: { xl: '7rem' },
 *   typography: { fonts: { heading: ['Fraunces', 'Georgia', 'serif'] } },
 * })
 *
 * const { tokens, cssVersion } = await app.queries.execute('theme.get', {})
 * const stylesheet = themeCss(tokens)
 * ```
 *
 * `brand-soft: null` clears an override; `xl: '7rem'` sets one; everything unnamed is
 * left alone. The stylesheet is served by the umbrella at a URL carrying
 * `cssVersion`, because this package may not depend on `@assemora/http` (ADR-0024).
 */

export { themeCommands, UpdateTheme } from './commands.js'
export { themeCss, themeVersion } from './css.js'
export { defaultTheme, resolveTheme } from './defaults.js'
export { THEME_ID, Theme, themeModels } from './models.js'
export { theme } from './module.js'
export { applyThemePatch } from './patch.js'
export { GetTheme, themeQueries } from './queries.js'
export {
  type ThemeOverrides,
  type ThemePatch,
  type ThemeTokens,
  type ThemeTypography,
  themeOverrides,
  themePatchShape,
  themeTokens,
} from './tokens.js'
export {
  colorCss,
  colorToken,
  fontStackCss,
  fontStackToken,
  fontWeightCss,
  fontWeightToken,
  LENGTH_UNITS,
  type LengthUnit,
  lengthCss,
  lengthToken,
  lineHeightCss,
  lineHeightToken,
} from './values.js'
