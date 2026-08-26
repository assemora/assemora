/**
 * The audit log (SPEC.md §67).
 *
 * Separate from revisions, and the separation is the point. A revision answers "what
 * did this look like before, and how do I put it back". An audit entry answers "who
 * did this, from where, and did it work" — including for the attempts that changed
 * nothing because they were refused.
 */
import { json, model, string, timestamp, uuid } from '@assemora/data'

export const AuditLog = model('assemora_audit_logs', {
  id: uuid().primary().defaultRandom(),
  /** `user`, `agent` or `api`. Null for something the system did to itself. */
  actorType: string().nullable().index(),
  actorId: string().nullable().index(),
  /** Where it came from: `rest`, `studio`, `mcp`, `cli`, `internal`. */
  source: string().index(),
  /** The command or query name, which is also its permission name (ADR-0015). */
  action: string().index(),
  entityType: string().nullable().index(),
  entityId: string().nullable(),
  requestId: string().index(),
  metadata: json<Record<string, unknown>>(),
  createdAt: timestamp().created().index(),
})

export const auditModels = [AuditLog] as const
