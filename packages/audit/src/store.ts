/**
 * The audit port core has declared since phase 1 (ADR-0008).
 *
 * `@assemora/core` calls it at the end of every command, succeeded or failed, and
 * hands it what it knows; this package turns that into rows. Registering it is what
 * makes `discardAudit()` unnecessary — and until something does, SPEC.md §67's log
 * is collected and thrown away.
 */
import type { AuditEntry, AuditPort } from '@assemora/core'

import { AuditLog } from './models.js'

export type AuditOptions = {
  /**
   * Whether an attempt that changed nothing is still recorded.
   *
   * It is, by default. "Who tried to delete this and was refused" is exactly the
   * question an audit log exists to answer, and a log of only successes cannot
   * answer it (SPEC.md §67, §76).
   */
  readonly failures?: boolean
}

export const audit = (options: AuditOptions = {}): AuditPort => ({
  async record(entry: AuditEntry) {
    if (entry.outcome === 'failed' && options.failures === false) return

    await AuditLog.create({
      actorType: entry.actor?.type ?? null,
      actorId: entry.actor?.id ?? null,
      source: entry.source,
      action: entry.action,
      entityType: entry.entityType ?? null,
      entityId: entry.entityId ?? null,
      requestId: entry.requestId,
      metadata: {
        outcome: entry.outcome,
        durationMs: Math.round(entry.durationMs),
        ...entry.metadata,
      },
    })
  },
})
