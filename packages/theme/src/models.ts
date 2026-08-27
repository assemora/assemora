/**
 * Where the theme lives (SPEC.md §62).
 *
 * One row, deliberately. Multi-site is not part of v1 (SPEC.md §5), and a table that
 * could hold two themes would need a way to say which one a request meant — in the
 * stylesheet URL, in Studio, in every MCP tool. The id is a constant rather than a
 * generated one so that "the theme" is addressable without a lookup, and so that a
 * second row is something nothing in this package can produce.
 */
import { integer, json, model, string, timestamp, uuid } from '@assemora/data'

import type { ThemeOverrides } from './tokens.js'

export const THEME_ID = 'default'

export const Theme = model('assemora_theme', {
  id: string().primary(),
  /**
   * What somebody changed, not the whole document.
   *
   * The defaults live in code (see `defaults.ts`), so this row stays the short list
   * of decisions a person actually made — which is what a revision diff and a change
   * set preview show them (SPEC.md §75).
   */
  tokens: json<ThemeOverrides>(),
  /** Bumped on every write; an update may state which one it expected (SPEC.md §66). */
  version: integer().default(1),
  updatedBy: uuid().nullable(),
  createdAt: timestamp().created(),
  updatedAt: timestamp().updated(),
})

export const themeModels = [Theme] as const
