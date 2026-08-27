/**
 * Writing a patch onto the overrides a row holds.
 *
 * An update is a merge, not a replacement, for the reason a properties panel exists:
 * somebody changes the brand colour, and the twenty tokens they did not touch are not
 * an instruction to delete them. Replacement would also make every agent proposal a
 * whole-document rewrite, and a diff nobody can read is a diff nobody approves
 * (SPEC.md §75).
 *
 * `null` is the other half of that decision. Omitting a token means "leave it alone",
 * so something else has to mean "stop overriding it" — the same distinction
 * `blockDesignPatch` draws for the controls of §61, and the same answer.
 */
import type { ThemeOverrides, ThemePatch } from './tokens.js'

type AnyMap = Readonly<Record<string, unknown>>

const patchedMap = (current: AnyMap | undefined, patch: AnyMap | undefined): AnyMap | undefined => {
  if (patch === undefined) return current

  const next: Record<string, unknown> = { ...current }

  for (const [key, value] of Object.entries(patch)) {
    if (value === null) delete next[key]
    else if (value !== undefined) next[key] = value
  }

  // An emptied group is dropped rather than left as `{}`, so two ways of saying "no
  // overrides here" cannot produce two different rows and two different versions.
  return Object.keys(next).length === 0 ? undefined : next
}

/**
 * The key type of a token map is erased by `Object.entries`, exactly as it is in
 * `tokens.ts`. The assertion is made here, once, on a value whose every entry came
 * from a schema that validated it against that key type.
 */
const group = <T>(map: AnyMap | undefined): T | undefined => map as T | undefined

const withGroup = <K extends string, T>(key: K, value: T | undefined) =>
  value === undefined ? {} : { [key]: value }

const typographyPatch = (
  current: ThemeOverrides['typography'],
  patch: ThemePatch['typography'],
): ThemeOverrides['typography'] => {
  if (patch === undefined) return current

  const next = {
    ...withGroup(
      'fonts',
      group<Readonly<Record<string, readonly string[]>>>(patchedMap(current?.fonts, patch.fonts)),
    ),
    ...withGroup(
      'sizes',
      group<Readonly<Record<string, string>>>(patchedMap(current?.sizes, patch.sizes)),
    ),
    ...withGroup(
      'weights',
      group<Readonly<Record<string, number>>>(patchedMap(current?.weights, patch.weights)),
    ),
    ...withGroup(
      'lineHeights',
      group<Readonly<Record<string, number>>>(patchedMap(current?.lineHeights, patch.lineHeights)),
    ),
  }

  return Object.keys(next).length === 0 ? undefined : next
}

/** The overrides a row should hold once this patch has been applied. */
export const applyThemePatch = (current: ThemeOverrides, patch: ThemePatch): ThemeOverrides => ({
  ...withGroup(
    'colors',
    group<NonNullable<ThemeOverrides['colors']>>(patchedMap(current.colors, patch.colors)),
  ),
  ...withGroup('typography', typographyPatch(current.typography, patch.typography)),
  ...withGroup(
    'spacing',
    group<NonNullable<ThemeOverrides['spacing']>>(patchedMap(current.spacing, patch.spacing)),
  ),
  ...withGroup(
    'radius',
    group<NonNullable<ThemeOverrides['radius']>>(patchedMap(current.radius, patch.radius)),
  ),
  ...withGroup(
    'container',
    group<NonNullable<ThemeOverrides['container']>>(patchedMap(current.container, patch.container)),
  ),
})
