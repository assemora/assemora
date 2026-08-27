/**
 * The theme an application has before anybody opens Design.
 *
 * These are the values the examples' hand-written stylesheets already used, so a site
 * that has never been edited looks exactly as it did (ADR-0024). Where the two
 * examples disagreed the reference application won — `apps/playground` is what Studio
 * is developed against — and the tokens only one of them declared are kept, because
 * a custom property nobody references costs a line and a missing one breaks a page.
 *
 * Defaults live in code rather than in a seeded row. A row would freeze this list at
 * the moment a project was created, and "reset this token" would then have nothing to
 * reset to.
 */
import type { ThemeOverrides, ThemeTokens, ThemeTypography } from './tokens.js'

const SANS = ['ui-sans-serif', 'system-ui', '-apple-system', 'Segoe UI', 'sans-serif'] as const
const MONO = ['ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'] as const

export const defaultTheme: ThemeTokens = {
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
    fonts: { body: SANS, heading: SANS, mono: MONO },
    sizes: {
      xs: '0.8125rem',
      sm: '0.9375rem',
      md: '1rem',
      lg: '1.25rem',
      xl: '1.75rem',
      '2xl': '2.5rem',
      '3xl': '3.5rem',
    },
    weights: { normal: 400, medium: 500, semibold: 600, bold: 700 },
    lineHeights: { tight: 1.15, normal: 1.55, loose: 1.8 },
  },
  spacing: {
    none: '0',
    xs: '0.5rem',
    sm: '1rem',
    md: '2rem',
    lg: '4rem',
    xl: '6rem',
    '2xl': '9rem',
  },
  radius: {
    none: '0',
    sm: '0.375rem',
    md: '0.75rem',
    lg: '1.25rem',
    // A pill, and the circle a round avatar needs. Large enough that no element
    // reaches it, which is what the idiom relies on.
    full: '9999px',
  },
  container: {
    narrow: '34rem',
    normal: '48rem',
    wide: '68rem',
    // `max-width: 100%` rather than `none`, because a container width is a length and
    // a keyword would be the one value in the document that is not one.
    full: '100%',
  },
}

const merge = <T>(
  base: Readonly<Record<string, T>>,
  over: Readonly<Record<string, T>> | undefined,
): Readonly<Record<string, T>> => (over === undefined ? base : { ...base, ...over })

const typographyOf = (over: ThemeOverrides['typography']): ThemeTypography => ({
  fonts: merge(defaultTheme.typography.fonts, over?.fonts),
  sizes: merge(defaultTheme.typography.sizes, over?.sizes),
  weights: merge(defaultTheme.typography.weights, over?.weights),
  lineHeights: merge(defaultTheme.typography.lineHeights, over?.lineHeights),
})

/**
 * The document a stylesheet is rendered from: the defaults, with the overrides on top.
 *
 * Resolution happens on the way out rather than on the way in, so the row stays the
 * short list of what somebody actually decided — which is what a revision diff, a
 * change-set preview and a person reading the JSON all want to see.
 */
export const resolveTheme = (overrides?: ThemeOverrides): ThemeTokens => ({
  colors: merge(defaultTheme.colors, overrides?.colors),
  typography: typographyOf(overrides?.typography),
  spacing: { ...defaultTheme.spacing, ...overrides?.spacing },
  radius: { ...defaultTheme.radius, ...overrides?.radius },
  container: { ...defaultTheme.container, ...overrides?.container },
})
