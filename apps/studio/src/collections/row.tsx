/**
 * One field of a collection being written, at any depth (SPEC.md §37, §39).
 *
 * A definition is a tree — an `object` carries the fields it groups, an `array` carries
 * the field one item is — so the row that edits one is the same component the whole way
 * down rather than a second form for "inner fields". What changes with depth is only
 * what may be said there: a nested field has no `searchable` or `filterable`, because
 * those address a resource field by name and never reach inside a value, and at the
 * deepest level a field can no longer be a group or a repeater, because that is where
 * the command stops accepting one.
 */
import { ChevronRight, TriangleAlert } from 'lucide-react'
import { useState } from 'react'
import type { FieldShapeSpec } from '../api/collections.ts'
import { Badge, Button, Field, Input, join, Select } from '../ui/index.tsx'
import { CONTAINERS, groupedKinds, kindsAt, needOf } from './contract.ts'
import {
  blankField,
  type FieldChange,
  type FieldDraft,
  locksOf,
  shaped,
  storedElement,
  storedInside,
} from './draft.ts'

const Flag = ({
  label,
  checked,
  onChange,
}: {
  label: string
  checked: boolean
  onChange(checked: boolean): void
}) => (
  <label className="flex items-center gap-1.5 text-sm text-ink-soft">
    <input
      type="checkbox"
      className="size-3.5 accent-accent"
      checked={checked}
      onChange={(event) => onChange(event.target.checked)}
    />
    {label}
  </label>
)

/**
 * A list of words a kind is built from: a select's options, a code field's languages, a
 * media field's accepted types.
 *
 * The options of a select may grow while entries exist and may not shrink: an entry can
 * be holding one, and a value the field says is impossible is worse than a choice nobody
 * picks any more. So a locked one has no way to remove it and says so instead.
 */
const Words = ({
  values,
  locked,
  placeholder,
  onChange,
}: {
  values: readonly string[]
  locked: readonly string[]
  placeholder: string
  onChange(values: readonly string[]): void
}) => {
  const [adding, setAdding] = useState('')

  const add = () => {
    const word = adding.trim()

    if (word === '' || values.includes(word)) return

    onChange([...values, word])
    setAdding('')
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-1.5">
        {values.length === 0 && <span className="text-sm text-ink-faint">Nothing yet</span>}
        {values.map((word) =>
          locked.includes(word) ? (
            <span key={word} title="An entry may hold this, so it cannot be taken away">
              <Badge>{word} · kept</Badge>
            </span>
          ) : (
            <button
              key={word}
              type="button"
              title={`Remove ${word}`}
              onClick={() => onChange(values.filter((each) => each !== word))}
            >
              <Badge tone="accent">{word} ×</Badge>
            </button>
          ),
        )}
      </div>

      <div className="flex gap-2">
        <Input
          className="max-w-48"
          placeholder={placeholder}
          value={adding}
          onChange={(event) => setAdding(event.target.value)}
          onKeyDown={(event) => {
            // Enter belongs to this input while it has something in it; the form's
            // submit is a deliberate act further down the page.
            if (event.key !== 'Enter') return

            event.preventDefault()
            add()
          }}
        />
        <Button variant="secondary" size="sm" onClick={add}>
          Add
        </Button>
      </div>
    </div>
  )
}

/** What every row in one editor shares, so a row passes it down rather than eleven props. */
export type RowSetting = {
  /** The kinds the application declares, before this row's depth narrows them. */
  readonly kinds: readonly string[]
  readonly maxDepth: number
  readonly entries: number
  readonly resources: readonly { readonly name: string; readonly label: string }[]
  /** The messages `issuesOf` raised against one row. */
  readonly issues: (key: string) => readonly string[]
  /** A key no other row in this editor has. */
  readonly newKey: () => string
  onChange(key: string, change: FieldChange): void
  onMove(key: string, by: number): void
  onRemove(key: string): void
}

/**
 * The extra a kind needs beyond its name.
 *
 * A select is its options, a slug is the field it is made from, a relation is what it
 * points at, a media field is what its picker offers. Every other kind — including one a
 * plugin registered that Studio has never heard of — needs nothing here, and the command
 * says so if it turns out it does.
 *
 * A `table` is deliberately not here. Its columns are part of its *value*, so an editor
 * chooses them on the entry rather than a developer fixing them on the collection —
 * which is the whole reason it is a kind rather than a repeater of groups.
 */
const Extra = ({
  field,
  locked,
  frozen,
  siblings,
  resources,
  onChange,
}: {
  field: FieldDraft
  locked: readonly string[]
  frozen: boolean
  siblings: readonly FieldDraft[]
  resources: readonly { readonly name: string; readonly label: string }[]
  onChange(change: FieldChange): void
}) => {
  const need = needOf(field.kind)

  if (need === 'options') {
    return (
      <Field
        label="Options"
        help={
          field.kind === 'checkboxes'
            ? 'A stored entry holds any number of these'
            : 'A stored entry holds one of these'
        }
        required
      >
        <Words
          values={field.options}
          locked={locked}
          placeholder="Add an option…"
          onChange={(options) => onChange({ options })}
        />
      </Field>
    )
  }

  if (need === 'languages') {
    return (
      <Field label="Languages" help="Leave this empty to let an entry name any language">
        <Words
          values={field.options}
          locked={locked}
          placeholder="ts, sql, objective-c…"
          onChange={(options) => onChange({ options })}
        />
      </Field>
    )
  }

  if (need === 'accept') {
    return (
      <Field
        label="Accepts"
        help="What the picker offers, as image/* or application/pdf. Empty means any file"
      >
        <Words
          values={field.accept}
          locked={[]}
          placeholder="image/*"
          onChange={(accept) => onChange({ accept })}
        />
      </Field>
    )
  }

  if (need === 'source') {
    const others = siblings.filter((each) => each.key !== field.key && each.name !== '')

    return (
      <Field label="Made from" help="Left empty on an entry, the slug comes from this" required>
        <Select
          className="max-w-56"
          disabled={frozen}
          value={field.source}
          onChange={(event) => onChange({ source: event.target.value })}
        >
          <option value="">Choose a field…</option>
          {/* A source that no longer names a field of this collection is still what
              the entries were made with, so it stays offered rather than vanishing. */}
          {others.some((each) => each.name === field.source) || field.source === '' ? null : (
            <option value={field.source}>{field.source}</option>
          )}
          {others.map((each) => (
            <option key={each.key} value={each.name}>
              {each.label === '' ? each.name : `${each.label} (${each.name})`}
            </option>
          ))}
        </Select>
      </Field>
    )
  }

  if (need === 'target') {
    return (
      <Field label="Points at" help="An entry holds the id of one of these" required>
        <Select
          className="max-w-56"
          disabled={frozen}
          value={field.target}
          onChange={(event) => onChange({ target: event.target.value })}
        >
          <option value="">Choose a resource…</option>
          {resources.some((resource) => resource.name === field.target) ||
          field.target === '' ? null : (
            <option value={field.target}>{field.target}</option>
          )}
          {resources.map((resource) => (
            <option key={resource.name} value={resource.name}>
              {resource.label} ({resource.name})
            </option>
          ))}
        </Select>
      </Field>
    )
  }

  return null
}

/** What a group or a repeater holds, drawn inside the row that owns it. */
const Inside = ({
  field,
  before,
  depth,
  setting,
}: {
  field: FieldDraft
  before: FieldShapeSpec | undefined
  depth: number
  setting: RowSetting
}) => {
  if (field.kind === 'object') {
    return (
      <section className="space-y-1 rounded-lg border border-line bg-surface-sunken/50">
        <p className="px-3 pt-2.5 text-sm font-medium text-ink-soft">
          The fields in this group{field.name === '' ? '' : ` (${field.name})`}
        </p>

        {field.fields.map((inner, index) => (
          <FieldRow
            key={inner.key}
            field={inner}
            before={storedInside(before, inner)}
            index={index}
            count={field.fields.length}
            depth={depth + 1}
            siblings={field.fields}
            setting={setting}
          />
        ))}

        <div className="px-3 pb-2.5">
          <Button
            variant="secondary"
            size="sm"
            onClick={() =>
              setting.onChange(field.key, {
                fields: [...field.fields, blankField(setting.newKey())],
              })
            }
          >
            Add a field to this group
          </Button>
        </div>
      </section>
    )
  }

  if (field.kind === 'array' && field.element !== undefined) {
    return (
      <section className="space-y-1 rounded-lg border border-line bg-surface-sunken/50">
        <p className="px-3 pt-2.5 text-sm font-medium text-ink-soft">Each item is</p>

        {/* No name, and nothing to reorder: an element is one field, and the value it
            repeats is keyed by position rather than by anything it could be called. */}
        <FieldRow
          field={field.element}
          before={storedElement(before)}
          index={0}
          count={1}
          depth={depth + 1}
          named={false}
          siblings={[]}
          setting={setting}
        />
      </section>
    )
  }

  return null
}

export const FieldRow = ({
  field,
  before,
  index,
  count,
  depth,
  named = true,
  siblings,
  setting,
}: {
  field: FieldDraft
  /** The stored spec this row came from, if the collection already had it. */
  before: FieldShapeSpec | undefined
  index: number
  count: number
  /** 1 for a field of the collection itself, 2 for a field of a group, and so on. */
  depth: number
  /** False for a repeater's element, which has nothing to key it by. */
  named?: boolean
  /** The rows beside this one, which is what a slug's source is chosen from. */
  siblings: readonly FieldDraft[]
  setting: RowSetting
}) => {
  const nested = depth > 1
  const locks = locksOf(field, before, setting.entries, nested)
  const kinds = kindsAt(setting.kinds, depth, setting.maxDepth, nested)
  const issues = setting.issues(field.key)
  const change = (patch: FieldChange) => setting.onChange(field.key, patch)
  const held = field.name === '' ? 'this field' : field.name

  /*
   * A field of the collection itself is an accordion (`design_handoff_studio_redesign`
   * §3): eight fields laid out flat is a wall of thirty controls, and the one being
   * worked on is the only one anybody is reading. A field inside a group stays open —
   * it is already inside a disclosure, and a second one is a door behind a door.
   *
   * Open by default while it has no name, which is exactly the state a field is in the
   * moment it is added.
   */
  const [open, setOpen] = useState(field.name === '')
  const expanded = nested || open

  /* What the collapsed row has to say: what is missing, in the palette of a warning. */
  const missing =
    issues.length > 0 ? (field.name === '' ? 'needs a name' : 'needs options') : undefined

  const flags = [
    field.required ? 'required' : undefined,
    field.searchable ? 'searchable' : undefined,
    field.filterable ? 'filterable' : undefined,
  ].filter(Boolean)

  return (
    <div
      className={
        nested
          ? 'space-y-3 border-t border-hairline px-3 py-3 first-of-type:border-0'
          : 'border-b border-hairline last:border-0'
      }
    >
      {!nested && (
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen((showing) => !showing)}
          className="flex w-full items-center gap-2.5 px-4 py-2.5 text-left hover:bg-surface-sunken"
        >
          <ChevronRight
            aria-hidden
            className={join(
              'size-4 shrink-0 text-ink-subdued transition-transform duration-[180ms]',
              open && 'rotate-90',
            )}
          />
          <span className="min-w-0 flex-1 truncate font-mono text-base">
            {field.name === '' ? <span className="text-ink-faint">unnamed</span> : field.name}
          </span>
          <Badge tone="quiet">{field.kind}</Badge>
          {flags.length > 0 && (
            <span className="shrink-0 text-sm text-ink-subdued">{flags.join(' · ')}</span>
          )}
          {missing !== undefined && (
            <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-warning-wash px-2.5 py-0.5 text-sm font-semibold text-warning-ink">
              <TriangleAlert aria-hidden className="size-3.5" />
              {missing}
            </span>
          )}
        </button>
      )}

      {expanded && (
        <div className={nested ? 'space-y-3' : 'space-y-3 px-4 pb-4'}>
          <div className="flex flex-wrap items-end gap-3">
            {count > 1 && (
              <div className="flex flex-col gap-0.5 pb-1">
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-5 px-1.5"
                  disabled={index === 0}
                  // An arrow is not a name: what a screen reader announces has to say which
                  // field is moving, and there are as many of these as there are rows.
                  aria-label={`Move ${held} up`}
                  title="Move up"
                  onClick={() => setting.onMove(field.key, -1)}
                >
                  ↑
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-5 px-1.5"
                  disabled={index === count - 1}
                  aria-label={`Move ${held} down`}
                  title="Move down"
                  onClick={() => setting.onMove(field.key, 1)}
                >
                  ↓
                </Button>
              </div>
            )}

            {named && (
              <div className="min-w-40 flex-1">
                <Field
                  label="Name"
                  required
                  {...(locks.name
                    ? { help: 'A field’s name is where its values are stored, so it never changes' }
                    : {})}
                  {...(issues.length === 0 ? {} : { errors: issues })}
                >
                  <Input
                    className={`font-mono text-sm${locks.name ? ' bg-surface-sunken' : ''}`}
                    placeholder="author"
                    readOnly={locks.name}
                    value={field.name}
                    onChange={(event) => change({ name: event.target.value })}
                  />
                </Field>
              </div>
            )}

            <div className="min-w-40 flex-1">
              <Field
                label="Kind"
                required
                {...(locks.kind ? { help: 'Fixed: entries already hold values of this kind' } : {})}
                {...(named || issues.length === 0 ? {} : { errors: issues })}
              >
                <Select
                  disabled={locks.kind}
                  value={field.kind}
                  onChange={(event) => change(shaped(field, event.target.value, setting.newKey))}
                >
                  {/* A stored kind a plugin used to provide is still what the values are,
                  so it is offered even when the application no longer declares it — and
                  so is a group at a depth this form would no longer offer one at. */}
                  {kinds.includes(field.kind) ? null : (
                    <option value={field.kind}>{field.kind}</option>
                  )}
                  {groupedKinds(kinds).map((group) => (
                    <optgroup key={group.label} label={group.label}>
                      {group.kinds.map((kind) => (
                        <option key={kind} value={kind}>
                          {kind}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </Select>
              </Field>
            </div>

            <div className="min-w-40 flex-1">
              <Field label="Label" help="What an editor sees. Left empty, the name is used">
                <Input
                  placeholder={field.name === '' ? 'Author' : undefined}
                  value={field.label}
                  onChange={(event) => change({ label: event.target.value })}
                />
              </Field>
            </div>

            {named && (
              <Button
                variant="ghost"
                size="sm"
                className="mb-1 text-danger"
                disabled={locks.kept}
                aria-label={`Remove ${held}`}
                title={
                  locks.kept
                    ? 'A field inside a group cannot be removed while the collection holds entries: the next save of an entry would delete the value rather than leave it behind'
                    : 'Remove this field'
                }
                onClick={() => setting.onRemove(field.key)}
              >
                Remove
              </Button>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <Flag
              label="required"
              checked={field.required}
              onChange={(required) => change({ required })}
            />

            {/* Only at the top. Search and filtering address a resource field by name and
            never reach inside a value, so `object()` and `array()` refuse both — a
            checkbox for one here would be a flag the command turns into a refusal.
            No "sortable" at any depth: a collection's entries are ordered by the entry's
            own columns and by nothing else, because a field's value lives inside one
            JSONB document (ADR-0012). `src/collections/draft.ts` carries the whole
            reason; the list screen leaves the same control out for the same one. */}
            {!nested && (
              <>
                <Flag
                  label="searchable"
                  checked={field.searchable}
                  onChange={(searchable) => change({ searchable })}
                />
                <Flag
                  label="filterable"
                  checked={field.filterable}
                  onChange={(filterable) => change({ filterable })}
                />
              </>
            )}

            {field.kind === 'table' && (
              <span className="text-sm text-ink-faint">
                An entry chooses this table’s columns, so there is nothing to declare here
              </span>
            )}

            {/* Once per list rather than once per row: the kind picker is shorter here than
            it was one level up, and that is worth explaining exactly once. */}
            {index === 0 &&
              depth >= setting.maxDepth &&
              CONTAINERS.some((kind) => setting.kinds.includes(kind)) && (
                <span className="text-sm text-ink-faint">
                  {setting.maxDepth} levels is as deep as a definition goes, so a field here holds
                  one value
                </span>
              )}
          </div>

          <Extra
            field={field}
            locked={locks.options}
            frozen={locks.kind}
            siblings={siblings}
            resources={setting.resources}
            onChange={change}
          />

          <Inside field={field} before={before} depth={depth} setting={setting} />
        </div>
      )}
    </div>
  )
}
