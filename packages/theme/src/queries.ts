/**
 * Reading the theme (SPEC.md §62).
 *
 * A read like any other: through the Query Bus, validated and authorized. It takes no
 * input because there is one theme (SPEC.md §5), and it answers with both halves —
 * the overrides somebody set, which is what Studio's Design panel edits, and the
 * document they resolve to, which is what a stylesheet is rendered from.
 */
import { query } from '@assemora/core'
import { number, string, timestamp } from '@assemora/schema'

import { themeVersion } from './css.js'
import { resolveTheme } from './defaults.js'
import { THEME_ID, Theme } from './models.js'
import { type ThemeOverrides, themeOverrides, themeTokens } from './tokens.js'

export const GetTheme = query('theme.get', {
  description: 'The theme: the tokens somebody set, and the document they resolve to',
  input: {},
  output: {
    version: number().integer(),
    overrides: themeOverrides(),
    tokens: themeTokens(),
    cssVersion: string(),
    updatedAt: timestamp().nullable(),
  },
  handle: async () => {
    const stored = await Theme.find(THEME_ID)
    const overrides: ThemeOverrides = stored?.tokens ?? {}
    const tokens = resolveTheme(overrides)

    return {
      // Zero when no row exists, which is a version an update may state: "I read a
      // theme nobody had edited" is a claim the next write has to be able to check.
      version: stored?.version ?? 0,
      overrides,
      tokens,
      cssVersion: themeVersion(tokens),
      updatedAt: stored?.updatedAt ?? null,
    }
  },
})

export const themeQueries = [GetTheme] as const
