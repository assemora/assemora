/**
 * The revision port core has declared since phase 1 (ADR-0008).
 *
 * `@assemora/core` collects revisions inside the command's transaction and hands them
 * here; this package is what turns them into rows. Registering it is what makes
 * `discardRevisions()` unnecessary.
 */
import type { RevisionEntry, RevisionPort } from '@assemora/core'

import { diff } from '@assemora/schema'

import { Revision } from './models.js'

/**
 * The next position in one entity's history.
 *
 * Read inside the command's transaction, alongside the write it numbers. Two
 * commands racing on the same entity could read the same number — but they are also
 * both about to lose an update, which is what `expectedVersion` is for (SPEC.md §66).
 */
const nextSequence = async (entityType: string, entityId: string): Promise<number> => {
  const newest = await Revision.where('entityType', entityType)
    .where('entityId', entityId)
    .orderBy('sequence', 'desc')
    .first()

  return (newest?.sequence ?? 0) + 1
}

export const revisions = (): RevisionPort => ({
  async record(entries: readonly RevisionEntry[]) {
    for (const entry of entries) {
      await Revision.create({
        sequence: await nextSequence(entry.entityType, entry.entityId),
        entityType: entry.entityType,
        entityId: entry.entityId,
        actorType: entry.actor?.type ?? null,
        actorId: entry.actor?.id ?? null,
        command: entry.command,
        before: entry.before,
        after: entry.after,
        patch: diff(entry.before, entry.after),
        requestId: entry.requestId,
        metadata: entry.metadata ?? {},
      })
    }
  },
})
