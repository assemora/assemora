/**
 * The document type, at the type level (docs/rules/testing.md).
 *
 * `ThemeTokens` is read off `themeTokens()` rather than written beside it, so there
 * is nothing here about the two agreeing — there is only one of them. What is worth
 * proving is the shape that decision produced: which keys are fixed, which are open,
 * what kind each value is, and where `null` is allowed.
 */
import type { ContainerWidth, RadiusScale, SpacingScale } from '@assemora/schema'
import { expectTypeOf, it } from 'vitest'

import { defaultTheme, resolveTheme } from './defaults.js'
import { applyThemePatch } from './patch.js'
import type { ThemeOverrides, ThemePatch, ThemeTokens } from './tokens.js'

it('fixes the keys §61 addresses by name', () => {
  expectTypeOf<keyof ThemeTokens['spacing']>().toEqualTypeOf<SpacingScale>()
  expectTypeOf<keyof ThemeTokens['radius']>().toEqualTypeOf<RadiusScale>()
  expectTypeOf<keyof ThemeTokens['container']>().toEqualTypeOf<ContainerWidth>()

  // Resolving always produces every one of them, which is what the fixed keys are
  // for: no control can end up rendering nothing.
  expectTypeOf(resolveTheme().spacing['2xl']).toEqualTypeOf<string>()
})

it('leaves colours and typography open, and typed by kind', () => {
  expectTypeOf<ThemeTokens['colors']>().toEqualTypeOf<Record<string, string>>()
  expectTypeOf<ThemeTokens['typography']['weights']>().toEqualTypeOf<Record<string, number>>()
  expectTypeOf<ThemeTokens['typography']['fonts'][string]>().toEqualTypeOf<readonly string[]>()
  expectTypeOf<ThemeTokens['typography']['sizes'][string]>().toEqualTypeOf<string>()
})

it('accepts null in a patch and never in the document', () => {
  expectTypeOf<NonNullable<ThemePatch['colors']>[string]>().toEqualTypeOf<string | null>()
  expectTypeOf<ThemeTokens['colors'][string]>().toEqualTypeOf<string>()

  applyThemePatch({}, { colors: { brand: null }, spacing: { xl: null } })

  // @ts-expect-error a resolved document has no way to say "not set"
  const cleared: ThemeTokens = { ...defaultTheme, colors: { brand: null } }
  expectTypeOf(cleared).toEqualTypeOf<ThemeTokens>()
})

it('holds overrides, not a whole document', () => {
  // Every group optional, so an untouched theme is an empty object rather than a
  // copy of the defaults frozen at install time.
  expectTypeOf<ThemeOverrides>().toEqualTypeOf<Partial<ThemeOverrides>>()
  applyThemePatch({}, {})

  // @ts-expect-error an override is a value, never a null — clearing removes the key
  const stored: ThemeOverrides = { colors: { brand: null } }
  expectTypeOf(stored).toEqualTypeOf<ThemeOverrides>()
})

it('refuses a step that is not on the scale', () => {
  // @ts-expect-error `huge` is not a spacing step
  applyThemePatch({}, { spacing: { huge: '1rem' } })

  // @ts-expect-error `xs` is not a container width
  applyThemePatch({}, { container: { xs: '1rem' } })
})
