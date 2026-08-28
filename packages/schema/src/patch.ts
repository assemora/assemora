/**
 * What changed between two states (SPEC.md §64, §65, §75).
 *
 * Studio shows this, not the whole document: "spacing: xl → md" is what a person can
 * act on. It lives here because three layers need it and none of them may depend on
 * the others — a revision records one, a dry run builds one, and a change set stores
 * one. Two implementations over the same two snapshots would eventually disagree on
 * a screen that shows both (ADR-0019).
 */

/** A field-level diff of two snapshots. */
export type Patch = Readonly<Record<string, { readonly from: unknown; readonly to: unknown }>>

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/**
 * One value out of a snapshot, read only where the snapshot has it.
 *
 * A snapshot is keyed by field names somebody chose (SPEC.md §37, §86), and
 * `constructor`, `toString`, `valueOf` and `hasOwnProperty` are all legal ones —
 * answered by `Object.prototype` on any plain object that was never given the key.
 */
const own = (record: Readonly<Record<string, unknown>>, key: string): unknown =>
  Object.hasOwn(record, key) ? record[key] : undefined

const same = (left: unknown, right: unknown): boolean => {
  if (left === right) return true
  if (left instanceof Date && right instanceof Date) return left.getTime() === right.getTime()

  return JSON.stringify(left ?? null) === JSON.stringify(right ?? null)
}

/** A field-level diff of two snapshots. Keys present in either side are considered. */
export const diff = (before: unknown, after: unknown): Patch => {
  const from = isRecord(before) ? before : {}
  const to = isRecord(after) ? after : {}
  const patch: Record<string, { from: unknown; to: unknown }> = {}

  for (const key of new Set([...Object.keys(from), ...Object.keys(to)])) {
    // Own keys only. A key is an own key of *one* side here, not of both, so the other
    // side answers it from `Object.prototype` — a field called `constructor` that was
    // cleared read as having changed to a function.
    const was = own(from, key)
    const is = own(to, key)

    if (!same(was, is)) patch[key] = { from: was, to: is }
  }

  return patch
}

export const changedFields = (patch: Patch): readonly string[] => Object.keys(patch)
