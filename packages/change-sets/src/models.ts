/**
 * Where a proposal waits (SPEC.md §74).
 *
 * A change set is a list of commands somebody has asked for, the diff they would
 * produce, and the versions the diff was computed against. Nothing in it has
 * happened: production state does not change before Apply (SPEC.md §75).
 */
import { json, model, string, timestamp, uuid } from '@assemora/data'
import type { Patch } from '@assemora/schema'

/** SPEC.md §74. */
export type ChangeSetStatus = 'pending' | 'applied' | 'rejected' | 'expired' | 'conflicted'

export type ProposedCommand = {
  readonly command: string
  readonly input: unknown
}

/** One entity the proposal would touch. */
export type ProposedChange = {
  readonly entityType: string
  readonly entityId: string
  readonly patch: Patch
  /** One line a person can read, as SPEC.md §75 shows them. */
  readonly summary: string
}

export type ChangeSetDiff = {
  readonly changes: readonly ProposedChange[]
}

export const ChangeSet = model('assemora_change_sets', {
  id: uuid().primary().defaultRandom(),
  actorType: string().nullable(),
  actorId: string().nullable().index(),
  /** A title for the whole proposal, so a person knows what they are approving. */
  title: string(),
  commands: json<readonly ProposedCommand[]>(),
  diff: json<ChangeSetDiff>(),
  status: string().index(),
  /**
   * What each touched entity's version was when the diff was computed (SPEC.md §74).
   *
   * Apply refuses when one of them has moved: the diff a person approved describes a
   * state that no longer exists (SPEC.md §66).
   */
  baseVersions: json<Readonly<Record<string, number>>>(),
  expiresAt: timestamp(),
  createdAt: timestamp().created().index(),
  appliedAt: timestamp().nullable(),
})

export const changeSetModels = [ChangeSet] as const
