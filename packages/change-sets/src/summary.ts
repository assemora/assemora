/**
 * One line a person can read (SPEC.md §75).
 *
 * The screen §75 draws says "Hero — spacing: xl → md", not two documents. A patch
 * already holds the fields that differ, so the summary is a rendering of it rather
 * than a second source of truth.
 */
import type { Patch } from '@assemora/schema'

const readable = (value: unknown): string => {
  if (value === null || value === undefined) return 'nothing'
  if (typeof value === 'string') return value.length > 40 ? `${value.slice(0, 37)}…` : value
  if (typeof value === 'object') return Array.isArray(value) ? `${value.length} items` : 'an object'

  return String(value)
}

/** Bookkeeping every write touches. True, and not what anybody came to approve. */
const NOISE = new Set(['version', 'updatedAt', 'updatedBy', 'createdAt', 'createdBy'])

export const summarise = (entityType: string, patch: Patch): string => {
  const fields = Object.keys(patch).filter((name) => !NOISE.has(name))

  if (fields.length === 0) return `${entityType}: nothing anybody would notice`

  const shown = fields.slice(0, 3).map((name) => {
    const change = patch[name]

    return `${name}: ${readable(change?.from)} → ${readable(change?.to)}`
  })

  const rest = fields.length - shown.length

  return `${entityType} — ${shown.join(', ')}${rest > 0 ? `, and ${rest} more` : ''}`
}
