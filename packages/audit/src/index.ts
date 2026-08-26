/**
 * `@assemora/audit` — who did what (SPEC.md §67).
 *
 * Separate from `@assemora/revisions`, and deliberately. A revision says what a
 * thing looked like before and puts it back; an audit entry says who asked, from
 * where, and whether they were allowed — including the attempts that were refused
 * and therefore left no revision at all.
 *
 * ```ts
 * const app = createApplication({
 *   modules: [auditModule(), blog()],
 *   audit: audit(),
 * })
 * ```
 */

export { AuditLog, auditModels } from './models.js'
export { auditModule } from './module.js'
export { auditQueries, ListAuditLog } from './queries.js'
export { type AuditOptions, audit } from './store.js'
