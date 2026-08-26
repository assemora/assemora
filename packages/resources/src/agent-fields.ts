/**
 * Field-level permissions for agents (SPEC.md §52, §76).
 *
 * A resource field declares what an agent may do with it — `agentAccess({ write:
 * false })` — and until something reads that, the declaration is decoration. This is
 * what reads it, and it sits inside the command path because §52 is explicit that an
 * agent must not reach a protected field through generic CRUD.
 *
 * Only an agent is narrowed. A person editing the same field in Studio is governed by
 * permissions and policies; these settings exist because an agent is a different kind
 * of caller, not because the field is secret.
 *
 * The check keys on the actor, not on `source`. An agent is an agent whichever door
 * it came through — MCP today, something else tomorrow.
 */
import { type Actor, ForbiddenError } from '@assemora/core'

import type { AnyField } from './fields.js'

const isAgent = (actor: Actor | undefined): boolean => actor?.type === 'agent'

/**
 * Refuses every field this actor may not write, naming all of them at once.
 *
 * It refuses rather than dropping. Silently writing the rest is the dangerous
 * option: the agent believes it set a field it did not, and the revision — and so
 * the change-set diff a human approves under SPEC.md §75 — would describe something
 * other than what happened. Approval has to be over what actually occurs.
 */
export const refuseUnwritableFields = (
  resource: string,
  fields: ReadonlyMap<string, AnyField>,
  values: Readonly<Record<string, unknown>>,
  actor: Actor | undefined,
): void => {
  if (!isAgent(actor)) return

  const refused = Object.keys(values)
    .filter((name) => fields.get(name)?.agent.write === false)
    .sort()

  if (refused.length === 0) return

  throw new ForbiddenError(
    `An agent may not write ${refused.map((name) => `"${name}"`).join(', ')} on "${resource}"`,
  )
}

/** Whether this actor may see the field at all. */
export const readableByActor = (field: AnyField, actor: Actor | undefined): boolean =>
  !isAgent(actor) || field.agent.read
