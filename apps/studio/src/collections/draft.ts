/**
 * The definition somebody is in the middle of writing (SPEC.md §37).
 *
 * A draft is a stored definition plus the two things a form needs and a definition has
 * no room for: a stable key per row, so a field can be renamed and reordered without
 * React losing track of it, and the name the field had when it was read, so the editor
 * knows which rows already hold values.
 *
 * A draft is a *tree*, because a definition is: an `object` carries the fields it groups
 * and an `array` carries the field one item is. The key is unique across the whole tree,
 * so `patched`, `without` and `moved` take one and find the row wherever it lives —
 * which is what lets the screen keep saying "change this row" without knowing how deep
 * it is.
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
import type { CollectionDefinition, FieldShapeSpec, FieldSpec } from '../api/collections.ts'
import type { Translate } from '../i18n/messages.ts'
import { needOf } from './contract.ts'

export type FieldDraft = {
  /** Stable for the life of the row, and unique across the tree. Never sent anywhere. */
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
  /** `media`: the media types its picker offers. Empty means any file. */
  readonly accept: readonly string[]
  /** `object`: the fields it groups. */
  readonly fields: readonly FieldDraft[]
  /** `array`: the field one item is. It has no name — there is nothing to key it by. */
  readonly element: FieldDraft | undefined
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
  accept: [],
  fields: [],
  element: undefined,
})

/**
 * A row's key, built from where it sits.
 *
 * A stored group's fields are `stored:author.name`, and a repeater's element is
 * `stored:sections.element` — the same word the definition, the descriptor and a
 * refusal use for it. Two fields cannot share a path, so the key is unique tree-wide
 * without a counter, and it survives a reread of the same definition.
 */
const keyOf = (prefix: string, name: string): string => `${prefix}.${name}`

const fieldDraftOf = (spec: FieldSpec, prefix: string): FieldDraft => ({
  ...shapeDraftOf(spec, keyOf(prefix, spec.name)),
  stored: spec.name,
  name: spec.name,
})

function shapeDraftOf(spec: FieldShapeSpec, key: string): FieldDraft {
  return {
    key,
    stored: undefined,
    name: '',
    kind: spec.kind,
    label: spec.label ?? '',
    required: spec.required === true,
    searchable: spec.searchable === true,
    filterable: spec.filterable === true,
    options: spec.options ?? [],
    source: spec.source ?? '',
    target: spec.target ?? '',
    accept: spec.accept ?? [],
    fields: (spec.fields ?? []).map((inner) => fieldDraftOf(inner, key)),
    element:
      spec.element === undefined ? undefined : shapeDraftOf(spec.element, keyOf(key, 'element')),
  }
}

export const draftOf = (definition: CollectionDefinition): CollectionDraft => ({
  name: definition.name,
  label: definition.label ?? '',
  fields: definition.fields.map((spec) => fieldDraftOf(spec, 'stored')),
})

/**
 * A definition with nothing in it — including no first row.
 *
 * A blank row used to be laid out for you, which reads as "fill this in" and skips past
 * the question a new collection actually opens with: what shape is this? An empty list
 * is where the presets live (`design_handoff_studio_redesign` §3), and pressing one is
 * how most collections should start. Every issue it raises is `blank`, so a person
 * opening the screen is told nothing until they try to save.
 */
export const emptyDraft = (): CollectionDraft => ({
  name: '',
  label: '',
  fields: [],
})

/** What a row's control may change. Neither the key nor the stored name is one. */
export type FieldChange = Partial<Omit<FieldDraft, 'key' | 'stored'>>

const changed = (field: FieldDraft, key: string, change: FieldChange): FieldDraft =>
  field.key === key
    ? { ...field, ...change }
    : {
        ...field,
        fields: field.fields.map((inner) => changed(inner, key, change)),
        element: field.element === undefined ? undefined : changed(field.element, key, change),
      }

export const patched = (
  fields: readonly FieldDraft[],
  key: string,
  change: FieldChange,
): readonly FieldDraft[] => fields.map((field) => changed(field, key, change))

/**
 * What a row becomes when its kind changes.
 *
 * A group with no fields and a repeater with no element are both a definition the
 * command refuses, so choosing the kind makes the one thing it cannot exist without.
 * The alternative is a form whose only possible next action is "add the thing this
 * needs", which is a step nobody would choose not to take.
 *
 * What the old kind carried stays in the draft and is simply not sent — `specOf` emits
 * `options`, `fields` and `element` only for the kind that has them — so changing a kind
 * by accident and changing it back does not lose what was typed.
 */
export const shaped = (field: FieldDraft, kind: string, key: () => string): FieldChange => ({
  kind,
  ...(kind === 'object' && field.fields.length === 0 ? { fields: [blankField(key())] } : {}),
  ...(kind === 'array' && field.element === undefined ? { element: blankField(key()) } : {}),
})

const dropped = (fields: readonly FieldDraft[], key: string): readonly FieldDraft[] =>
  fields
    .filter((field) => field.key !== key)
    .map((field) => ({
      ...field,
      fields: dropped(field.fields, key),
      element:
        field.element === undefined
          ? undefined
          : { ...field.element, fields: dropped(field.element.fields, key) },
    }))

export const without = (fields: readonly FieldDraft[], key: string): readonly FieldDraft[] =>
  dropped(fields, key)

/**
 * Reorders one row, in whichever list holds it. A move past either end is not a move.
 *
 * The array is returned unchanged when nothing moved, so a no-op does not redraw the
 * tree it walked.
 */
export const moved = (
  fields: readonly FieldDraft[],
  key: string,
  by: number,
): readonly FieldDraft[] => {
  const from = fields.findIndex((field) => field.key === key)

  if (from !== -1) {
    const to = from + by

    if (to < 0 || to >= fields.length) return fields

    const reordered = [...fields]
    const [moving] = reordered.splice(from, 1)

    if (moving === undefined) return fields

    reordered.splice(to, 0, moving)

    return reordered
  }

  let touched = false

  const next = fields.map((field) => {
    const inner = moved(field.fields, key, by)
    const element =
      field.element === undefined
        ? undefined
        : ((): FieldDraft => {
            const within = moved(field.element.fields, key, by)

            return within === field.element.fields
              ? field.element
              : { ...field.element, fields: within }
          })()

    if (inner === field.fields && element === field.element) return field

    touched = true

    return { ...field, fields: inner, element }
  })

  return touched ? next : fields
}

/**
 * What the command is sent for one field, minus the name.
 *
 * `options`, `source`, `target` and `accept` follow the *kind*: a select that was turned
 * into a text field must not carry its old options along, or the definition would
 * remember a choice nobody can see and the field would grow it back on the next edit.
 * `fields` and `element` follow it for the same reason.
 */
const shapeOf = (field: FieldDraft): FieldShapeSpec => {
  const need = needOf(field.kind)

  return {
    kind: field.kind,
    ...(field.label.trim() === '' ? {} : { label: field.label.trim() }),
    ...(field.required ? { required: true } : {}),
    ...(need === 'options' || need === 'languages' ? { options: field.options } : {}),
    ...(need === 'source' && field.source !== '' ? { source: field.source } : {}),
    ...(need === 'target' && field.target !== '' ? { target: field.target } : {}),
    ...(need === 'accept' && field.accept.length > 0 ? { accept: field.accept } : {}),
    ...(need === 'fields' ? { fields: field.fields.map(insideOf) } : {}),
    ...(need === 'element' && field.element !== undefined
      ? { element: shapeOf(field.element) }
      : {}),
  }
}

/**
 * A field of a group: named, and without the flags that address a resource field.
 *
 * `searchable` and `filterable` reach a column or a top-level JSONB key by name and
 * never inside a value, so `object()` and `array()` refuse them outright rather than
 * accepting a flag that does nothing. A nested row therefore never offers them, and this
 * is the second half of that: what a stored definition cannot carry, a draft does not
 * send back.
 */
const insideOf = (field: FieldDraft): FieldSpec => ({
  name: field.name.trim(),
  ...shapeOf(field),
})

export const specOf = (field: FieldDraft): FieldSpec => ({
  ...insideOf(field),
  ...(field.searchable ? { searchable: true } : {}),
  ...(field.filterable ? { filterable: true } : {}),
})

/**
 * The fields this edit removes.
 *
 * Removing a row is how somebody says they mean it, so this is exactly what `drop`
 * carries — and `collections.update` refuses a removal that is not named there, which
 * is what keeps a stale form from taking a field out by accident.
 *
 * Top-level fields only, because `drop` names a collection's own fields and has nothing
 * to say about one inside a group. That is also why a stored nested field cannot be
 * removed at all while entries exist: see `locksOf`.
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
    fields: draft.fields.map((field) => specOf(field)),
    ...(drop.length === 0 ? {} : { drop }),
  }
}

/** The stored spec a row came from, matched the way the command matches it: by name. */
export const storedInside = (
  before: FieldShapeSpec | undefined,
  child: FieldDraft,
): FieldShapeSpec | undefined =>
  child.stored === undefined
    ? undefined
    : before?.fields?.find((field) => field.name === child.stored)

/** The stored spec a repeater's element came from. An element is matched by position. */
export const storedElement = (before: FieldShapeSpec | undefined): FieldShapeSpec | undefined =>
  before?.element

export const storedField = (
  stored: CollectionDefinition | undefined,
  field: FieldDraft,
): FieldShapeSpec | undefined =>
  field.stored === undefined ? undefined : stored?.fields.find((each) => each.name === field.stored)

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
  /**
   * Whether this row cannot be taken out at all.
   *
   * True of a stored field inside a group while entries exist. Removing a top-level
   * field leaves its values behind under the old name, unreadable but there, and `drop`
   * is how somebody says they mean it. A nested one is worse: `object()` keeps only the
   * keys its shape mentions, so the next ordinary save of an entry would *delete* the
   * value rather than leave it — and `drop` names a collection's own fields, with no way
   * to name this one. So the command refuses it, and the button says so first.
   */
  readonly kept: boolean
}

export const locksOf = (
  field: FieldDraft,
  before: FieldShapeSpec | undefined,
  entries: number,
  nested = false,
): FieldLocks => {
  const frozen = before !== undefined && entries > 0

  return {
    name: field.stored !== undefined,
    kind: frozen,
    options: frozen && before.kind === field.kind ? (before.options ?? []) : [],
    kept: frozen && nested,
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
  /**
   * How a refusal is said, in the language Studio is being read in.
   *
   * Handed in rather than reached for, because this file is not a component: the rules
   * below are the same rules whatever language they are announced in, and a pure
   * function that could call a hook would be a component pretending not to be one.
   */
  readonly t: Translate
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
 * What one list of fields would be refused for, at any depth.
 *
 * A group's fields are checked exactly as the collection's own are — a name of the right
 * shape, no two alike, and whatever the kind cannot be built without — because that is
 * what the command does: `fieldFromSpec` is one function and it runs the whole way down.
 * The only rule that does not recurse is the dropped-name one, which is about values
 * stored under a collection's own key.
 */
const fieldIssues = (
  fields: readonly FieldDraft[],
  context: DraftContext,
  named: boolean,
): DraftIssue[] => {
  const issues: DraftIssue[] = []
  const seen = new Map<string, number>()

  for (const field of fields) {
    const fieldName = field.name.trim()

    if (named) {
      seen.set(fieldName, (seen.get(fieldName) ?? 0) + 1)

      if (fieldName === '') {
        issues.push({
          key: field.key,
          message: context.t('collections.issue.fieldNeedsName'),
          blank: true,
        })
      } else if (!new RegExp(context.fieldNamePattern).test(fieldName)) {
        issues.push({
          key: field.key,
          message: context.t('collections.issue.badFieldName', { name: fieldName }),
        })
      } else if ((seen.get(fieldName) ?? 0) > 1) {
        issues.push({
          key: field.key,
          message: context.t('collections.issue.duplicateField', { name: fieldName }),
        })
      }
    }

    issues.push(...kindIssues(field, context))
  }

  return issues
}

/** What a kind cannot be built without, and what is inside it. */
const kindIssues = (field: FieldDraft, context: DraftContext): DraftIssue[] => {
  const need = needOf(field.kind)

  if (need === 'options' && field.options.length === 0) {
    return [
      {
        key: field.key,
        message: context.t('collections.issue.needsOptions', { kind: field.kind }),
        blank: true,
      },
    ]
  }

  if (need === 'source' && field.source === '') {
    return [{ key: field.key, message: context.t('collections.issue.needsSource'), blank: true }]
  }

  if (need === 'target' && field.target === '') {
    return [{ key: field.key, message: context.t('collections.issue.needsTarget'), blank: true }]
  }

  if (need === 'fields') {
    return field.fields.length === 0
      ? [{ key: field.key, message: context.t('collections.issue.needsFields'), blank: true }]
      : fieldIssues(field.fields, context, true)
  }

  if (need === 'element') {
    return field.element === undefined
      ? [{ key: field.key, message: context.t('collections.issue.needsElement'), blank: true }]
      : fieldIssues([field.element], context, false)
  }

  return []
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
    issues.push({
      about: 'name',
      message: context.t('collections.issue.needsName'),
      blank: true,
    })
  } else if (!new RegExp(context.namePattern).test(name)) {
    issues.push({
      about: 'name',
      message: context.t('collections.issue.badName', { name }),
    })
  } else if (context.stored === undefined && context.taken.includes(name)) {
    issues.push({
      about: 'name',
      message: context.t('collections.issue.nameTaken', { name }),
    })
  }

  if (draft.fields.length === 0) {
    issues.push({
      about: 'fields',
      message: context.t('collections.issue.needsAField'),
      blank: true,
    })
  }

  for (const field of draft.fields) {
    const fieldName = field.name.trim()

    if (
      field.stored === undefined &&
      fieldName !== '' &&
      context.dropped.includes(fieldName) &&
      context.entries > 0
    ) {
      issues.push({
        key: field.key,
        message: context.t('collections.issue.droppedName', { name: fieldName }),
      })
    }
  }

  return [...issues, ...fieldIssues(draft.fields, context, true)]
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
