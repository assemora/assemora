/**
 * Whether a section is shown, against what is typed in the form (ADR-0033, amended).
 *
 * Evaluated here and nowhere on the server: a condition is presentation, and the
 * server validates the fields whatever is on screen — which is why a required field may
 * not sit under one. A hidden section's values stay in the draft and are saved with it;
 * a layout arranges, it does not clear.
 */
import type { Condition } from '../api/introspection.ts'

/** Whether a value counts as filled in: not empty, not null, not an empty list. */
const filled = (value: unknown): boolean =>
  value !== undefined &&
  value !== null &&
  value !== false &&
  !(typeof value === 'string' && value.trim() === '') &&
  !(Array.isArray(value) && value.length === 0)

export const holds = (
  condition: Condition | undefined,
  draft: Readonly<Record<string, unknown>>,
): boolean => {
  if (condition === undefined) return true

  const value = Object.hasOwn(draft, condition.field) ? draft[condition.field] : undefined

  if (condition.present === true) return filled(value)

  // `null` equals an unset field: a form that has not been filled in yet is the state
  // a condition on "no value" is written for.
  if (condition.equals === null) return value === null || value === undefined

  return value === condition.equals
}
