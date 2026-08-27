/**
 * What is left of a document once everything unusable is taken out of it.
 *
 * The row is JSONB. Its TypeScript type is a claim rather than a guarantee, and
 * anyone who reaches the database reaches the document — a seed script, a migration,
 * a person with `psql`. So `theme.update` merges a validated patch onto a row nobody
 * validated, and has to decide what to do when the result holds something the schema
 * refuses.
 *
 * Refusing the command was the obvious answer and the wrong one: a single token
 * nobody named then refused *every* command, including the one that would have
 * cleared it, and the only way back was the database again. A command must be refused
 * for what it does, never for what it found.
 *
 * So the unusable part is dropped instead, and the caller's own patch is applied on
 * top of what survives. Nothing is lost by that: a token this drops is a token
 * `themeCss` already writes no declaration for, so it was never part of the site's
 * stylesheet — and the revision the command writes still records the row exactly as
 * it was, so `revisions.undo` puts even the damage back.
 *
 * The subset is found by asking the schema and reading its answer, rather than by a
 * second description of what a document may hold. An issue names the path it is
 * about; dropping those paths and asking again converges on the largest subset the
 * schema accepts, and the schema stays the only place that says what one is.
 */
import type { Issue } from '@assemora/schema'

import { type ThemeOverrides, themeOverrides } from './tokens.js'

/**
 * The deepest path a document has is `typography.fonts.body`, and every round removes
 * at least one entry from the flattest level up. A handful of rounds is far past what
 * convergence needs; the bound is here so a schema that ever reports an issue at a
 * path it will not let go of ends as a refusal rather than as a hung request.
 */
const ROUNDS = 8

export type Repaired =
  /** The largest subset of the document the schema accepts. */
  | { readonly ok: true; readonly overrides: ThemeOverrides }
  /** Nothing could be removed that would help, so the caller has to be told. */
  | { readonly ok: false; readonly issues: readonly Issue[] }

const isMap = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/** Whatever `path` names, gone. False when there was nothing there to remove. */
const removeAt = (
  document: Record<string, unknown>,
  path: readonly (string | number)[],
): boolean => {
  const last = path.at(-1)

  if (last === undefined) return false

  let parent: unknown = document

  for (const step of path.slice(0, -1)) {
    if (!isMap(parent)) return false
    parent = parent[String(step)]
  }

  // `Object.hasOwn` rather than `in`, so a path naming `constructor` or `toString`
  // cannot be reported as removed when what was found belongs to every object.
  if (!isMap(parent) || !Object.hasOwn(parent, String(last))) return false

  delete parent[String(last)]

  return true
}

/**
 * A group that has lost its last token is dropped rather than left as `{}`.
 *
 * The same rule `applyThemePatch` follows, and for the same reason: two ways of
 * saying "no overrides here" would be two different rows and two different cache
 * versions of one identical stylesheet.
 */
const pruneEmpty = (node: Record<string, unknown>): void => {
  for (const [key, value] of Object.entries(node)) {
    if (!isMap(value)) continue

    pruneEmpty(value)

    if (Object.keys(value).length === 0) delete node[key]
  }
}

export const usableOverrides = (overrides: ThemeOverrides): Repaired => {
  let document: Record<string, unknown> = overrides
  let cloned = false

  for (let round = 0; round < ROUNDS; round += 1) {
    const parsed = themeOverrides().parse(document)

    // The schema's own answer, so what is stored is exactly what it accepted rather
    // than a copy this file assembled.
    if (parsed.ok) return { ok: true, overrides: parsed.value }

    // Copied before the first removal and never before that: an unremarkable update
    // is by far the common case, and it must not pay for this.
    //
    // Through JSON, because that is what the row is. It also matters that the copy is
    // deep: a group the patch did not name is the *instance's* own object, and the
    // revision's `before` holds a reference to it — removing a token in place would
    // quietly edit the history that records what was removed.
    if (!cloned) {
      document = JSON.parse(JSON.stringify(document)) as Record<string, unknown>
      cloned = true
    }

    let removed = false

    for (const issue of parsed.issues) removed = removeAt(document, issue.path) || removed

    if (!removed) return { ok: false, issues: parsed.issues }

    pruneEmpty(document)
  }

  const parsed = themeOverrides().parse(document)

  return parsed.ok ? { ok: true, overrides: parsed.value } : { ok: false, issues: parsed.issues }
}
