/**
 * Changing the theme (SPEC.md §62, §64, §66, §75).
 *
 * One command, and everything else follows from that. It validates like any other, it
 * is authorized like any other, it writes a revision so undo works, and it becomes an
 * MCP tool by generation (ADR-0020) — which is how §62's "AI must change theme tokens
 * rather than generate arbitrary global CSS" becomes true by construction: there is no
 * tool anywhere that takes CSS, because there is no command anywhere that takes CSS.
 */
import { type CommandContext, ConflictError, command, ValidationError } from '@assemora/core'
import { number, string } from '@assemora/schema'

import { themeVersion } from './css.js'
import { resolveTheme } from './defaults.js'
import { THEME_ID, Theme } from './models.js'
import { applyThemePatch } from './patch.js'
import { usableOverrides } from './repair.js'
import {
  type ThemeOverrides,
  type ThemePatch,
  themeOverrides,
  themePatchShape,
  themeTokens,
} from './tokens.js'
import { writeThemeIfUnchanged } from './write.js'

declare module '@assemora/core' {
  interface AssemoraEventPayloads {
    'theme.updated': { readonly version: number }
  }
}

/**
 * How many times a caller who stated no version is put back on the horse.
 *
 * Stating nothing means "apply this on top of whatever is there", so losing the race
 * is not the caller's problem to hear about — it is one more read and one more write.
 * Three, because a fourth would only mean the row is being written continuously, and
 * a request that never answers is worse than one that says it could not.
 */
const ATTEMPTS = 3

const patchOf = (values: ThemePatch & { readonly expectedVersion?: number }): ThemePatch => ({
  ...(values.colors === undefined ? {} : { colors: values.colors }),
  ...(values.typography === undefined ? {} : { typography: values.typography }),
  ...(values.spacing === undefined ? {} : { spacing: values.spacing }),
  ...(values.radius === undefined ? {} : { radius: values.radius }),
  ...(values.container === undefined ? {} : { container: values.container }),
})

/** Read again, so the caller is told what the theme actually is now, not what it was. */
const conflict = async (expected: number | undefined): Promise<never> => {
  const current = await Theme.find(THEME_ID)

  throw new ConflictError('The theme has changed since it was read', {
    expectedVersion: expected,
    currentVersion: current?.version ?? 0,
  })
}

/**
 * The revision, the event and the answer.
 *
 * The resolved document comes back with the new version, so a properties panel
 * redraws what it just did without a second read — the same reason every tree command
 * answers with the tree it produced.
 */
const answer = (
  version: number,
  overrides: ThemeOverrides,
  before: Record<string, unknown> | null,
  after: Record<string, unknown>,
  context: CommandContext,
) => {
  context.revise({ entityType: 'theme', entityId: THEME_ID, before, after })
  context.emit('theme.updated', { version })

  // Valid by construction: the defaults are, and the overrides written over them have
  // just been through the schema.
  const tokens = resolveTheme(overrides)

  return { version, overrides, tokens, cssVersion: themeVersion(tokens) }
}

export const UpdateTheme = command('theme.update', {
  description:
    'Sets theme tokens (SPEC.md §62). Tokens not named are left alone; a token set to null goes back to the default',
  input: { ...themePatchShape, expectedVersion: number().integer().optional() },
  output: {
    version: number().integer(),
    overrides: themeOverrides(),
    tokens: themeTokens(),
    cssVersion: string(),
  },
  handle: async (values, context) => {
    for (let attempt = 1; attempt <= ATTEMPTS; attempt += 1) {
      const existing = await Theme.find(THEME_ID)
      const before = existing === null ? null : existing.toJSON()
      const current = existing?.version ?? 0

      // The stale read: what this caller was looking at is already not the theme. It
      // is worth answering before the work, but it is not what makes `expectedVersion`
      // mean anything — the condition on the write below is (SPEC.md §66).
      if (values.expectedVersion !== undefined && current !== values.expectedVersion) {
        return conflict(values.expectedVersion)
      }

      await context.authorize('theme', 'update', before)

      // The patch was validated on the way in; the row it lands on was not, because a
      // row is JSONB and whoever reaches the database reaches it. Whatever the merged
      // document holds that would not render is dropped here rather than refused, so
      // one bad token cannot hold the command shut — see `repair.ts`.
      const usable = usableOverrides(applyThemePatch(existing?.tokens ?? {}, patchOf(values)))

      if (!usable.ok) throw new ValidationError(usable.issues)

      const overrides = usable.overrides
      const updatedBy = context.actor?.id ?? null

      // The row is created on first edit rather than seeded at install: an application
      // that has never opened Design has no theme, which is exactly what it means.
      //
      // Two callers racing to create it is the one case the condition below cannot
      // cover, because an insert has nothing to be conditional on. The primary key is
      // a constant, so the loser is refused by the database rather than allowed to
      // overwrite — the right outcome, reported as a database error rather than as a
      // conflict.
      if (existing === null) {
        const created = await Theme.create({
          id: THEME_ID,
          tokens: overrides,
          version: 1,
          updatedBy,
        })

        return answer(created.version, overrides, before, created.toJSON(), context)
      }

      const updatedAt = new Date()
      const version = current + 1
      const written = await writeThemeIfUnchanged(current, {
        tokens: overrides,
        version,
        updatedBy,
        updatedAt,
      })

      if (written) {
        // The statement above wrote the row, so the instance is brought up to date
        // here rather than by a second read; nothing calls `save()` on it again.
        existing.tokens = overrides
        existing.version = version
        existing.updatedBy = updatedBy
        existing.updatedAt = updatedAt

        return answer(version, overrides, before, existing.toJSON(), context)
      }

      // Somebody committed between the read and the write. A caller who stated the
      // version they were editing is told; a caller who did not gets their patch
      // applied to what is there now, which is what a merge means.
      if (values.expectedVersion !== undefined) return conflict(values.expectedVersion)
    }

    return conflict(undefined)
  },
})

export const themeCommands = [UpdateTheme] as const
