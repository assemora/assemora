/**
 * Reading the log (SPEC.md §45, §67).
 *
 * Studio's developer section shows this. It is a read like any other: through the
 * Query Bus, authorized, and paginated — an audit log is the one table guaranteed to
 * grow forever.
 */
import { query } from '@assemora/core'
import { number, string } from '@assemora/schema'

import { AuditLog } from './models.js'

export const ListAuditLog = query('audit.list', {
  description: 'Who did what, newest first',
  input: {
    action: string().optional(),
    actorId: string().optional(),
    source: string().optional(),
    entityType: string().optional(),
    entityId: string().optional(),
    outcome: string().optional(),
    page: number().integer().optional(),
    perPage: number().integer().optional(),
  },
  handle: async ({ action, actorId, source, entityType, entityId, outcome, page, perPage }) => {
    let found = AuditLog.orderBy('createdAt', 'desc')

    if (action !== undefined && action !== '') found = found.whereLike('action', `${action}%`)
    if (actorId !== undefined) found = found.where('actorId', actorId)
    if (source !== undefined) found = found.where('source', source)
    if (entityType !== undefined) found = found.where('entityType', entityType)
    if (entityId !== undefined) found = found.where('entityId', entityId)

    const listed = await found.paginate(page ?? 1, Math.min(perPage ?? 50, 200))

    // The outcome lives inside `metadata`, which no adapter can filter on portably
    // yet — so it is narrowed here, on the page that was read.
    const data = listed.data
      .map((entry) => ({
        id: entry.id,
        actorType: entry.actorType,
        actorId: entry.actorId,
        source: entry.source,
        action: entry.action,
        entityType: entry.entityType,
        entityId: entry.entityId,
        requestId: entry.requestId,
        outcome: String(entry.metadata.outcome ?? 'succeeded'),
        durationMs: Number(entry.metadata.durationMs ?? 0),
        metadata: entry.metadata,
        createdAt: entry.createdAt,
      }))
      .filter((entry) => outcome === undefined || entry.outcome === outcome)

    return { ...listed, data }
  },
})

export const auditQueries = [ListAuditLog] as const
