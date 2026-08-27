/**
 * What a resource checks input with, once (SPEC.md §36, §39, §111).
 *
 * A static resource and a collection are the same kind of thing addressed two ways
 * (ADR-0012), so they have to accept and refuse the same input. They did not: there
 * were two `validate` implementations, written months apart, and the dynamic one had
 * quietly lost two rules — a `null` could not clear an optional field, and a `slug`
 * field was never derived from its source. Neither was a decision; both were the
 * predictable consequence of keeping one behaviour in two places.
 *
 * So there is one implementation, and what differs between the two callers is passed
 * in: the resource's name, its fields, and which of them a `null` may be written to.
 * A rule added here reaches both by construction, which is the only version of "a
 * dynamic resource is a resource, not a special case" that stays true.
 */
import { ValidationError } from '@assemora/core'
import type { Issue } from '@assemora/schema'

import { slugify } from './descriptor.js'
import type { AnyField } from './fields.js'

export type FieldValidation = {
  /** Named in the message a caller reads when it sends a field that does not exist. */
  readonly resource: string
  readonly fields: ReadonlyMap<string, AnyField>
  /**
   * Whether writing `null` to this field clears it.
   *
   * A static resource asks its model: a column that is `not null` refuses, so the
   * resource refuses first and says which field. A collection's values live in one
   * JSONB document, which holds a `null` under any key, so every field of one is
   * clearable.
   */
  readonly clearable: (name: string) => boolean
}

export const validateAgainstFields = (
  values: unknown,
  mode: 'create' | 'update',
  { resource, fields, clearable }: FieldValidation,
): Record<string, unknown> => {
  if (typeof values !== 'object' || values === null || Array.isArray(values)) {
    throw new ValidationError([{ path: [], code: 'type', message: 'Expected an object' }])
  }

  const source = values as Record<string, unknown>
  const issues: Issue[] = []
  const checked: Record<string, unknown> = {}

  for (const key of Object.keys(source)) {
    if (!fields.has(key)) {
      issues.push({
        path: [key],
        code: 'unknown_field',
        message: `"${key}" is not a field of ${resource}`,
      })
    }
  }

  for (const [name, field] of fields) {
    // Own keys only: `'constructor' in source` is true of every object, so a field of
    // that name would read as provided by every caller, holding whatever
    // `Object.prototype` has under it.
    const provided = Object.hasOwn(source, name)

    if (provided && field.isReadOnly) {
      issues.push({ path: [name], code: 'read_only', message: `"${name}" cannot be written` })
      continue
    }

    if (!provided) {
      if (mode === 'create' && field.isRequired) {
        issues.push({ path: [name], code: 'required', message: 'This field is required' })
      }
      continue
    }

    const value = source[name]

    // Clearing a field is a normal edit: Studio's empty input, an agent's explicit
    // `null`. It is accepted exactly where the value can be held, so a required field
    // and a `not null` column both still refuse (SPEC.md §36).
    if (value === null && !field.isRequired && clearable(name)) {
      checked[name] = null
      continue
    }

    const result = field.schema.parse(value)

    if (result.ok) checked[name] = result.value
    else issues.push(...result.issues.map((issue) => ({ ...issue, path: [name, ...issue.path] })))
  }

  // `slug('title')` says where the slug comes from, so a caller that did not send one
  // gets it derived. Only on create: a published URL does not change because someone
  // corrected a headline (SPEC.md §39).
  if (mode === 'create') {
    for (const [name, field] of fields) {
      if (field.kind !== 'slug' || field.source === undefined) continue
      // `hasOwn` and not `in` for the reason above, and here it decides whether a slug
      // is derived at all: `'constructor' in source` would read as "the caller sent
      // one" and silently skip the derivation.
      if (Object.hasOwn(checked, name) || Object.hasOwn(source, name)) continue

      const from = checked[field.source] ?? source[field.source]

      if (typeof from !== 'string') continue

      // The derived value goes through the field's own schema like any other. A title
      // that leaves nothing behind fails here rather than reaching the row.
      const result = field.schema.parse(slugify(from))

      if (result.ok) checked[name] = result.value
      else issues.push(...result.issues.map((issue) => ({ ...issue, path: [name, ...issue.path] })))
    }
  }

  if (issues.length > 0) throw new ValidationError(issues)

  return checked
}
