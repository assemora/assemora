/**
 * The `theme()` module (SPEC.md §13, §62).
 *
 * Registering it is what gives an application a theme it can edit. An application
 * that does not register it still renders: `themeCss(defaultTheme)` is a complete
 * stylesheet, and the defaults are the values the examples already used.
 */
import { type ModuleBuilder, module, registerRestorer } from '@assemora/core'

import { themeCommands } from './commands.js'
import { THEME_ID, Theme, themeModels } from './models.js'
import { themeQueries } from './queries.js'
import type { ThemeOverrides } from './tokens.js'

export const theme = (): ModuleBuilder =>
  module('theme')
    .models(...themeModels)
    .commands(...themeCommands)
    .queries(...themeQueries)
    .boot(() => {
      // How the theme goes back to an earlier state. `@assemora/revisions` calls this
      // and never learns what a theme is (SPEC.md §65).
      registerRestorer('theme', async (_entityId, state) => {
        const existing = await Theme.find(THEME_ID)
        const replaced = existing === null ? null : existing.toJSON()

        // `null` is the state before the first edit — no row, and the defaults. Undoing
        // the very first theme change has to be able to reach it (SPEC.md §65).
        if (state === null || state === undefined) {
          if (existing !== null) await existing.delete()

          return { replaced, version: 0 }
        }

        const snapshot = state as { readonly tokens?: unknown }
        const tokens = (snapshot.tokens ?? {}) as ThemeOverrides

        if (existing === null) {
          const recreated = await Theme.create({
            id: THEME_ID,
            tokens,
            version: 1,
            updatedBy: null,
          })

          return { replaced, version: recreated.version }
        }

        await existing.update({ tokens, version: existing.version + 1 })

        // The caller's next command carries this as `expectedVersion` (SPEC.md §66).
        return { replaced, version: existing.version }
      })
    })
