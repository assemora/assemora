/**
 * The authorization provider (SPEC.md §50, §51, ADR-0008).
 *
 * `@assemora/core` declares the port and calls it inside the command pipeline; this
 * is the implementation that consults roles, permissions and policies. Registering
 * it is what makes `permitAll()` unnecessary.
 *
 * The check happens in two stages, because a rule about a record cannot be answered
 * before the record is read:
 *
 * 1. `authorize` — permissions. Does this actor hold `articles.update` at all?
 * 2. `authorizeRecord` — the policy rule, with the row in hand.
 *
 * Actions that act on an existing row defer to the second stage; the rest are decided
 * at the first, where `record` is `undefined` by definition.
 */
import type {
  AuthorizationPort,
  AuthorizationRequest,
  RecordAuthorizationRequest,
} from '@assemora/core'
import { ForbiddenError } from '@assemora/core'

import { holds, permissionsOf } from './permissions.js'
import { policyFor } from './policies.js'

/** Actions whose decision needs the row itself. */
const RECORD_SCOPED = new Set(['update', 'delete', 'restore', 'publish'])

export type CommandSubject = {
  readonly subject: string
  readonly action: string
}

/** Listing and fetching are the same right, and a policy says so once. */
const READING = new Set(['list', 'get'])

/**
 * A command name is already a permission name.
 *
 * `pages.publish` is `publish` on `pages`, so the permission is `pages.publish` —
 * which is exactly how SPEC.md §51 spells `actor.has('articles.delete')`. The
 * `entries.*` commands are the exception: they name their subject in the input, so
 * `entries.update` on `{ resource: 'articles' }` is `articles.update`.
 *
 * `list` and `get` both mean `read`, whatever the subject. A policy that grants
 * reading should not have to say it twice, and `pages.read` reads better in a role
 * than `pages.list` plus `pages.get` (SPEC.md §51).
 */
export const subjectOf = (request: AuthorizationRequest): CommandSubject => {
  const input = request.input as { resource?: unknown } | null
  const resource = typeof input?.resource === 'string' ? input.resource : undefined
  const separator = request.command.lastIndexOf('.')

  const group = request.command.slice(0, Math.max(separator, 0))
  const action = separator === -1 ? 'execute' : request.command.slice(separator + 1)

  if (group === 'entries' && resource !== undefined) {
    return { subject: resource, action: READING.has(action) ? 'read' : action }
  }

  return {
    subject: group === '' ? request.command : group,
    action: READING.has(action) ? 'read' : action,
  }
}

export const policies = (): AuthorizationPort => ({
  async authorize(request) {
    const { subject, action } = subjectOf(request)
    const permissions = await permissionsOf(request.context.actor)

    if (holds(permissions, `${subject}.${action}`)) return

    const rules = policyFor(subject)?.rules

    if (rules === undefined) {
      throw new ForbiddenError(`No permission and no policy allow ${action} on ${subject}`)
    }

    // The row decides, and it has not been read yet. The second stage will ask.
    if (RECORD_SCOPED.has(action)) return

    const rule = rules[action]

    if (rule === undefined) {
      throw new ForbiddenError(`The policy for ${subject} says nothing about ${action}`)
    }

    const allowed = await rule({
      actor: request.context.actor,
      record: undefined as never,
      context: request.context,
      can: (permission) => holds(permissions, permission),
    })

    if (!allowed) throw new ForbiddenError(`${action} on ${subject} is not allowed`)
  },

  async authorizeRecord(request: RecordAuthorizationRequest) {
    const permissions = await permissionsOf(request.context.actor)

    if (holds(permissions, `${request.subject}.${request.action}`)) return

    const rule = policyFor(request.subject)?.rules[request.action]

    if (rule === undefined) {
      throw new ForbiddenError(
        `No permission and no policy allow ${request.action} on ${request.subject}`,
      )
    }

    const allowed = await rule({
      actor: request.context.actor,
      record: request.record as never,
      context: request.context,
      can: (permission) => holds(permissions, permission),
    })

    if (!allowed) {
      throw new ForbiddenError(`${request.action} on this ${request.subject} is not allowed`)
    }
  },
})
