/**
 * One line a person can read (SPEC.md §75).
 *
 * The screen §75 draws says "Hero — spacing: xl → md", not two documents. A patch
 * already holds the fields that differ, so the summary is a rendering of it rather
 * than a second source of truth.
 */
import { type BlockTree, diffTrees, type Patch } from '@assemora/schema'

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

const isTree = (value: unknown): value is BlockTree =>
  typeof value === 'object' && value !== null && Array.isArray((value as BlockTree).blocks)

/** The block-tree columns. A change to one of these is a change to a page. */
const TREES = new Set(['draftTree', 'publishedTree'])

/**
 * A page's changes, block by block (SPEC.md §75).
 *
 * A field-level patch says `draftTree` changed and hands over two whole trees, which
 * is true and useless to somebody deciding whether to approve it. §75's screen shows
 * "Hero — spacing: xl → md", so the tree is asked what happened to it — by the same
 * `diffTrees` the revision history uses, over the same two snapshots (ADR-0019).
 */
export const summariseTree = (patch: Patch): string[] => {
  for (const field of TREES) {
    const change = patch[field]

    if (change === undefined || !isTree(change.from) || !isTree(change.to)) continue

    const moved = diffTrees(change.from, change.to)

    return [
      ...moved.added.map((block) => `${block.type} — new block`),
      ...moved.removed.map((block) => `${block.type} — removed`),
      ...moved.moved.map((block) => `${block.type} — moved`),
      ...moved.changed.map((block) =>
        block.fields.length > 0
          ? `${block.type} — ${block.fields.join(', ')} changed`
          : block.hidden
            ? `${block.type} — hidden or shown`
            : `${block.type} — restyled`,
      ),
    ]
  }

  return []
}
