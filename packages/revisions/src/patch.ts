/**
 * What changed between two states (SPEC.md §64, §65).
 *
 * Studio shows this, not the whole document: "spacing: xl → md" is what a person can
 * act on, and it is also what a change set diff is built from (SPEC.md §75).
 */
import type { RevisionPatch } from './models.js'

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const same = (left: unknown, right: unknown): boolean => {
  if (left === right) return true
  if (left instanceof Date && right instanceof Date) return left.getTime() === right.getTime()

  return JSON.stringify(left ?? null) === JSON.stringify(right ?? null)
}

/** A field-level diff of two snapshots. Keys present in either side are considered. */
export const diff = (before: unknown, after: unknown): RevisionPatch => {
  const from = isRecord(before) ? before : {}
  const to = isRecord(after) ? after : {}
  const patch: Record<string, { from: unknown; to: unknown }> = {}

  for (const key of new Set([...Object.keys(from), ...Object.keys(to)])) {
    if (!same(from[key], to[key])) patch[key] = { from: from[key], to: to[key] }
  }

  return patch
}

export const changedFields = (patch: RevisionPatch): readonly string[] => Object.keys(patch)
