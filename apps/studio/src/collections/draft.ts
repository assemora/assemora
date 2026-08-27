/**
 * The definition somebody is in the middle of writing (SPEC.md §37).
 *
 * A draft is a stored definition plus the two things a form needs and a definition has
 * no room for: a stable key per row, so a field can be renamed and reordered without
 * React losing track of it, and the name the field had when it was read, so the editor
 * knows which rows already hold values.
 *
 * The rules here are not a second implementation of the command's. `collections.update`
 * refuses a silent removal, a frozen kind and a reused dropped name whatever this says
 * — what this does is let the screen say *before* somebody commits what the command
 * would say after, which is the difference between a form and a red bar. `holds()` in
 * `src/api/permissions.ts` stands in the same relation to `@assemora/auth`, and this
 * file's tests exist for the same reason: to fail when the two drift apart.
 *
 * A field has no `sortable` here, though `collections.create` accepts one. A
 * collection's entries are ordered by the entry's own columns — `createdAt`,
 * `updatedAt`, `publishedAt`, `status` — and by nothing else, because a field's value
 * lives inside one JSONB document and the Query AST has no ordering term that reaches
 * into it (ADR-0012). So `sort=title` is a 422 from `entries.list`, always, and a
 * checkbox that could only ever produce one is a control that lies. Marking it here
 * would also be Studio *writing* that lie into a stored definition, so a save drops
 * the flag rather than carrying it back. It belongs to whoever adds JSONB ordering to
 * `@assemora/data`, not to this form.
 */
import type { CollectionDefinition, FieldSpec } from '../api/collections.ts'
import { needOf } from './contract.ts'

export type FieldDraft = {
  /** Stable for the life of the row. Never sent anywhere. */
  readonly key: string
  /** The name this field has in the stored definition, if it is a stored one. */
  readonly stored: string | undefined
  readonly name: string
  readonly kind: string
  readonly label: string
  readonly required: boolean
  readonly searchable: boolean
  readonly filterable: boolean
  readonly options: readonly string[]
  readonly source: string
  readonly target: string
}

export type CollectionDraft = {
  readonly name: string
  readonly label: string
  readonly fields: readonly FieldDraft[]
}

/** Everything unset is the empty string, so a row is one shape whatever its kind. */
export const blankField = (key: string, kind = 'text'): FieldDraft => ({
  key,
  stored: undefined,
  name: '',
  kind,
  label: '',
  required: false,
  searchable: false,
  filterable: false,
  options: [],
  source: '',
  target: '',
})

const fieldDraftOf = (spec: FieldSpec): FieldDraft => ({
  key: `stored:${spec.name}`,
  stored: spec.name,
  name: spec.name,
  kind: spec.kind,
  label: spec.label ?? '',
  required: spec.required === true,
  searchable: spec.searchable === true,
  filterable: spec.filterable === true,
  options: spec.options ?? [],
  source: spec.source ?? '',
  target: spec.target ?? '',
})

export const draftOf = (definition: CollectionDefinition): CollectionDraft => ({
  name: definition.name,
  label: definition.label ?? '',
  fields: definition.fields.map(fieldDraftOf),
})

export const emptyDraft = (key: string): CollectionDraft => ({
  name: '',
  label: '',
  fields: [blankField(key)],
})

/** What a row's control may change. Neither the key nor the stored name is one. */
export type FieldChange = Partial<Omit<FieldDraft, 'key' | 'stored'>>

export const patched = (
  fields: readonly FieldDraft[],
  key: string,
  change: FieldChange,
): readonly FieldDraft[] =>
  fields.map((field) => (field.key === key ? { ...field, ...change } : field))

export const without = (fields: readonly FieldDraft[], key: string): readonly FieldDraft[] =>
  fields.filter((field) => field.key !== key)

/** Reorders one row. A move past either end is not a move. */
export const moved = (
  fields: readonly FieldDraft[],
  key: string,
  by: number,
): readonly FieldDraft[] => {
  const from = fields.findIndex((field) => field.key === key)
  const to = from + by

  if (from === -1 || to < 0 || to >= fields.length) return fields

  const reordered = [...fields]
  const [moving] = reordered.splice(from, 1)

  if (moving === undefined) return fields

  reordered.splice(to, 0, moving)

  return reordered
}

/**
 * What the command is sent for one field.
 *
 * `options`, `source` and `target` follow the *kind*: a select that was turned into a
 * text field must not carry its old options along, or the definition would remember a
 * choice nobody can see and the field would grow it back on the next edit.
 */
export const specOf = (field: FieldDraft): FieldSpec => {
  const need = needOf(field.kind)

  return {
    name: field.name.trim(),
    kind: field.kind,
    ...(field.label.trim() === '' ? {} : { label: field.label.trim() }),
    ...(field.required ? { required: true } : {}),
    ...(field.searchable ? { searchable: true } : {}),
    ...(field.filterable ? { filterable: true } : {}),
    ...(need === 'options' ? { options: field.options } : {}),
    ...(need === 'source' && field.source !== '' ? { source: field.source } : {}),
    ...(need === 'target' && field.target !== '' ? { target: field.target } : {}),
  }
}

/**
 * The fields this edit removes.
 *
 * Removing a row is how somebody says they mean it, so this is exactly what `drop`
 * carries — and `collections.update` refuses a removal that is not named there, which
 * is what keeps a stale form from taking a field out by accident.
 */
export const removals = (
  stored: CollectionDefinition | undefined,
  draft: CollectionDraft,
): readonly string[] =>
  (stored?.fields ?? [])
    .map((field) => field.name)
    .filter((name) => !draft.fields.some((field) => field.stored === name))

export const payloadOf = (
  draft: CollectionDraft,
  stored: CollectionDefinition | undefined,
): Record<string, unknown> => {
  const drop = removals(stored, draft)

  return {
    name: draft.name.trim(),
    ...(draft.label.trim() === '' ? {} : { label: draft.label.trim() }),
    fields: draft.fields.map(specOf),
    ...(drop.length === 0 ? {} : { drop }),
  }
}

/**
 * What this row may no longer change.
 *
 * One rule, stated once: what a stored value *is* cannot change while values exist;
 * what it is called, shown and searched as can. A field's name is the key its values
 * are stored under, so it is frozen the moment the field is stored at all — there is
 * no rename, and two field lists compared by name cannot tell one from a removal
 * followed by an addition.
 */
export type FieldLocks = {
  readonly name: boolean
  readonly kind: boolean
  /** Options an entry may already hold. They may be added to, never taken away. */
  readonly options: readonly string[]
}

export const locksOf = (
  field: FieldDraft,
  stored: CollectionDefinition | undefined,
  entries: number,
): FieldLocks => {
  const before = stored?.fields.find((each) => each.name === field.stored)
  const frozen = before !== undefined && entries > 0

  return {
    name: field.stored !== undefined,
    kind: frozen,
    options: frozen && before.kind === field.kind ? (before.options ?? []) : [],
  }
}

export type DraftIssue = {
  /** The row this is about. Absent when it is about the collection itself. */
  readonly key?: string
  /** Which half of the form a collection-level issue belongs under. */
  readonly about?: 'name' | 'fields'
  readonly message: string
  /**
   * Whether this is only "you have not filled it in yet".
   *
   * A form that greets somebody with everything they have not typed is shouting at
   * them for opening it, so the screen holds these back until they try to save. A
   * *wrong* value — a name that cannot be a name, one another resource already
   * answers to, two fields alike — is shown the moment it is wrong.
   */
  readonly blank?: boolean
}

export type DraftContext = {
  /** The stored definition, when this is an edit. */
  readonly stored: CollectionDefinition | undefined
  /** Every resource name already in use, source declarations included. */
  readonly taken: readonly string[]
  /** Names whose values are still stored, so a new field may not take one. */
  readonly dropped: readonly string[]
  readonly entries: number
  readonly namePattern: string
  readonly fieldNamePattern: string
}

/**
 * Everything the command would refuse, said while it can still be fixed.
 *
 * Deliberately only the refusals that are certain: a form that guesses at the server's
 * answer and guesses wrong stops somebody sending a request that would have worked.
 * Anything this does not catch is answered by the command, and the screen shows what
 * it said.
 */
export const issuesOf = (draft: CollectionDraft, context: DraftContext): readonly DraftIssue[] => {
  const issues: DraftIssue[] = []
  const name = draft.name.trim()

  if (name === '') {
    issues.push({ about: 'name', message: 'A collection needs a name.', blank: true })
  } else if (!new RegExp(context.namePattern).test(name)) {
    issues.push({
      about: 'name',
      message: `“${name}” is not a name a collection can have. Start with a lower-case letter, then letters, numbers and underscores.`,
    })
  } else if (context.stored === undefined && context.taken.includes(name)) {
    issues.push({
      about: 'name',
      message: `“${name}” is already a resource in this application. Choose another name.`,
    })
  }

  if (draft.fields.length === 0) {
    issues.push({ about: 'fields', message: 'A collection needs at least one field.', blank: true })
  }

  const seen = new Map<string, number>()

  for (const field of draft.fields) {
    const fieldName = field.name.trim()

    seen.set(fieldName, (seen.get(fieldName) ?? 0) + 1)

    if (fieldName === '') {
      issues.push({ key: field.key, message: 'Every field needs a name.', blank: true })
    } else if (!new RegExp(context.fieldNamePattern).test(fieldName)) {
      issues.push({
        key: field.key,
        message: `“${fieldName}” is not a name a field can have. Start with a letter, then letters, numbers and underscores.`,
      })
    } else if ((seen.get(fieldName) ?? 0) > 1) {
      issues.push({ key: field.key, message: `Another field is already called “${fieldName}”.` })
    } else if (
      field.stored === undefined &&
      context.dropped.includes(fieldName) &&
      context.entries > 0
    ) {
      issues.push({
        key: field.key,
        message: `A field called “${fieldName}” was removed while this collection held entries, and their values are still stored under that name. Choose another name, or empty the collection first.`,
      })
    }

    const need = needOf(field.kind)

    if (need === 'options' && field.options.length === 0) {
      issues.push({
        key: field.key,
        message: 'A select field needs at least one option.',
        blank: true,
      })
    }

    if (need === 'source' && field.source === '') {
      issues.push({ key: field.key, message: 'A slug field needs a source field.', blank: true })
    }

    if (need === 'target' && field.target === '') {
      issues.push({
        key: field.key,
        message: 'A relation field needs a target resource.',
        blank: true,
      })
    }
  }

  return issues
}

/**
 * `Testimonials` → `testimonials`, `Case studies` → `case_studies`.
 *
 * A suggestion, not a rule: the name is a field somebody can take over, and a label
 * that yields nothing a name can be — one written in a script with no ASCII form, or
 * one starting with a digit — is left to say so through `issuesOf` rather than quietly
 * turned into something else.
 */
export const nameFrom = (label: string): string =>
  label
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
