/**
 * Where a reversible change is kept (SPEC.md §64).
 *
 * A revision is what makes SPEC.md §3.6 true — any content mutation can be undone —
 * and it is written by the command pipeline itself, not by each handler in turn.
 */
import { integer, json, model, string, timestamp, uuid } from '@assemora/data'

import type { Patch } from '@assemora/schema'

/** The name this table has always used for it. One diff, one meaning (ADR-0019). */
export type RevisionPatch = Patch

export const Revision = model('assemora_revisions', {
  id: uuid().primary().defaultRandom(),
  // Every read of a timeline filters on these two and orders by the third, so they
  // are indexed rather than scanned.
  entityType: string().index(),
  entityId: string().index(),
  /**
   * Where this sits in one entity's history, counting from one.
   *
   * `createdAt` cannot answer that: two commands can commit inside the same
   * millisecond, and undo depends entirely on knowing which came first (SPEC.md §65).
   */
  sequence: integer().index(),
  actorType: string().nullable(),
  actorId: string().nullable(),
  command: string(),
  before: json<unknown>(),
  after: json<unknown>(),
  /** Only what changed, so a person can read the entry without diffing it (SPEC.md §65). */
  patch: json<RevisionPatch>(),
  requestId: string(),
  metadata: json<Record<string, unknown>>(),
  createdAt: timestamp().created().index(),
})

export const revisionModels = [Revision] as const
