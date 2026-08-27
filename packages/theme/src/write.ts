/**
 * The one write in this package that is not `instance.update()` (SPEC.md §66).
 *
 * `expectedVersion` is worth nothing unless the check and the write are the same
 * statement. Reading the row, comparing its version in JavaScript and then writing
 * `version + 1` is three steps with two gaps in them, and two handlers that both read
 * version 1 both walk straight through: both pass the comparison, both write version
 * 2, and both are told they wrote it. One person's change is gone, and the other now
 * holds an `expectedVersion` for a state that never existed. Reproduced on
 * PostgreSQL, and on the in-memory adapter — it is not an isolation level, it is a
 * missing condition.
 *
 * So the version somebody read is part of the `where`, and what the database answers
 * with — the number of rows it actually changed — is the answer to "did anybody get
 * there first". Zero means somebody did.
 *
 * The alternative was a row lock: `select … for update` before the read. It needs
 * `for update` in the Query AST, which means the AST, the builder, both adapters and
 * the conformance suite (ADR-0013) — a change to §66 across the framework, which is
 * where it belongs and not something the theme should land on its own. A conditional
 * write is also the stronger of the two here: a lock only orders the writers that
 * agree to take it, while a condition is checked by the database against the row, so
 * a writer that never read through this command still cannot overwrite a stated
 * version. And it holds no lock across the rest of the pipeline — revision, events,
 * audit — on the one row every theme edit in the application shares.
 *
 * This is a Query AST built by the query builder with its operation changed, not a
 * reach into an adapter's own API: the conditions are written as `Theme.where(…)`,
 * field names and all, and the AST is the contract every adapter already implements
 * (SPEC.md §31). `@assemora/data` has no conditional write of its own to call — when
 * it grows one, this is the file that disappears.
 */
import { currentAdapter } from '@assemora/data'

import { THEME_ID, Theme } from './models.js'
import type { ThemeOverrides } from './tokens.js'

export type ThemeWrite = {
  readonly tokens: ThemeOverrides
  readonly version: number
  readonly updatedBy: string | null
  readonly updatedAt: Date
}

/**
 * Writes the row only while it still holds `expected`.
 *
 * @returns whether it did. False is not an error here: it is the fact the caller
 *   asked about, and what it means — a conflict, or one more attempt — is the
 *   command's decision rather than this file's.
 */
export const writeThemeIfUnchanged = async (
  expected: number,
  write: ThemeWrite,
): Promise<boolean> => {
  const changed = await currentAdapter().execute<number>(
    {
      ...Theme.where('id', THEME_ID).where('version', expected).toAst(),
      operation: 'update',
      data: { ...write },
    },
    { table: Theme.descriptor },
  )

  return changed === 1
}
