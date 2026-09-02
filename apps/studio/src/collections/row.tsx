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
import { ArrowDown, ArrowUp, ChevronRight, Trash2, TriangleAlert } from 'lucide-react'
import { useState } from 'react'
import type { FieldShapeSpec } from '../api/collections.ts'
import { useT } from '../i18n/translate.tsx'
import { Badge, Button, Checkbox, Field, IconButton, Input, join, Select } from '../ui/index.tsx'
import { Picker } from '../ui/overlay.tsx'
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
import { helpOf, iconOf } from './kinds.tsx'

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
  const t = useT()

  const add = () => {
    const word = adding.trim()

    if (word === '' || values.includes(word)) return

    onChange([...values, word])
    setAdding('')
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-1.5">
        {values.length === 0 && (
          <span className="text-sm text-ink-faint">{t('row.nothingYet')}</span>
        )}
        {values.map((word) =>
          locked.includes(word) ? (
            <span key={word} title={t('row.keptWhy')}>
              <Badge>
                {word} · {t('row.kept')}
              </Badge>
            </span>
          ) : (
            <button
              key={word}
              type="button"
              title={t('row.removeWord', { word })}
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
          {t('row.add')}
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
const ExtraControl = ({
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
  const t = useT()

  if (need === 'options') {
    return (
      <Field
        label={t('row.options')}
        help={field.kind === 'checkboxes' ? t('row.optionsMany') : t('row.optionsOne')}
        required
      >
        <Words
          values={field.options}
          locked={locked}
          placeholder={t('row.addOption')}
          onChange={(options) => onChange({ options })}
        />
      </Field>
    )
  }

  if (need === 'languages') {
    return (
      <Field label={t('row.languages')} help={t('row.languagesHelp')}>
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
      <Field label={t('row.accepts')} help={t('row.acceptsHelp')}>
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
      <Field label={t('row.madeFrom')} help={t('row.madeFromHelp')} required>
        <Select
          className="max-w-56"
          disabled={frozen}
          value={field.source}
          onChange={(event) => onChange({ source: event.target.value })}
        >
          <option value="">{t('row.chooseField')}</option>
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
      <Field label={t('row.pointsAt')} help={t('row.pointsAtHelp')} required>
        <Select
          className="max-w-56"
          disabled={frozen}
          value={field.target}
          onChange={(event) => onChange({ target: event.target.value })}
        >
          <option value="">{t('fields.chooseResource')}</option>
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

/**
 * The kind's own control, in the sunken well the design gives it.
 *
 * A well rather than another field in the grid above: what a `select` needs is not a
 * third column beside Name and Kind — it is a consequence of the kind, and it appears
 * and disappears as the kind changes. Nothing is drawn at all for a kind that needs
 * nothing, which is most of them.
 */
const Extra = (props: {
  field: FieldDraft
  locked: readonly string[]
  frozen: boolean
  siblings: readonly FieldDraft[]
  resources: readonly { readonly name: string; readonly label: string }[]
  onChange(change: FieldChange): void
}) => {
  if (needOf(props.field.kind) === undefined) return null

  return (
    <div className="rounded-[10px] border border-hairline bg-surface-sunken p-3.5">
      <ExtraControl {...props} />
    </div>
  )
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
  const t = useT()

  if (field.kind === 'object') {
    return (
      <section className="space-y-1 rounded-lg border border-line bg-surface-sunken/50">
        <p className="px-3 pt-2.5 text-sm font-medium text-ink-soft">
          {field.name === ''
            ? t('row.groupFields')
            : t('row.groupFieldsNamed', { name: field.name })}
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
            {t('row.addToGroup')}
          </Button>
        </div>
      </section>
    )
  }

  if (field.kind === 'array' && field.element !== undefined) {
    return (
      <section className="space-y-1 rounded-lg border border-line bg-surface-sunken/50">
        <p className="px-3 pt-2.5 text-sm font-medium text-ink-soft">{t('row.eachItemIs')}</p>

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

/**
 * Move up, move down, take it away.
 *
 * One strip, drawn beside the row it acts on: in the header of a top-level field, and at
 * the top of the body of a nested one, which has no header to put it in. Icons rather
 * than words because there are three of them per row and a column of `Remove` down the
 * side of a definition is the loudest thing on the screen.
 */
const Controls = ({
  index,
  count,
  named,
  kept,
  onMove,
  onRemove,
  name,
}: {
  index: number
  count: number
  /** False for a repeater's element: there is one of it and nothing to reorder. */
  named: boolean
  /** Whether removal is refused because entries hold values under this name. */
  kept: boolean
  onMove(by: number): void
  onRemove(): void
  name: string
}) => {
  const t = useT()

  return (
    <div className="flex shrink-0 items-center gap-0.5">
      {count > 1 && (
        <>
          <IconButton
            size={28}
            disabled={index === 0}
            label={t('row.moveUp', { name })}
            title={t('fields.up')}
            onClick={() => onMove(-1)}
          >
            <ArrowUp aria-hidden className="size-4" />
          </IconButton>
          <IconButton
            size={28}
            disabled={index === count - 1}
            label={t('row.moveDown', { name })}
            title={t('fields.down')}
            onClick={() => onMove(1)}
          >
            <ArrowDown aria-hidden className="size-4" />
          </IconButton>
        </>
      )}
      {named && (
        <IconButton
          size={28}
          disabled={kept}
          className="hover:text-danger"
          label={t('row.removeNamed', { name })}
          title={kept ? t('row.cannotRemove') : t('row.removeField')}
          onClick={onRemove}
        >
          <Trash2 aria-hidden className="size-4" />
        </IconButton>
      )}
    </div>
  )
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
  const t = useT()
  const nested = depth > 1
  const locks = locksOf(field, before, setting.entries, nested)
  const kinds = kindsAt(setting.kinds, depth, setting.maxDepth, nested)
  const issues = setting.issues(field.key)
  const change = (patch: FieldChange) => setting.onChange(field.key, patch)
  const held = field.name === '' ? t('row.thisField') : field.name
  const help = helpOf(field.kind)

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
    issues.length > 0 ? (field.name === '' ? t('row.needsName') : t('row.needsOptions')) : undefined

  const flags = [
    field.required ? t('row.required') : undefined,
    field.searchable ? t('row.searchable') : undefined,
    field.filterable ? t('row.filterable') : undefined,
  ].filter(Boolean)

  const controls = (
    <Controls
      index={index}
      count={count}
      named={named}
      kept={locks.kept}
      name={held}
      onMove={(by) => setting.onMove(field.key, by)}
      onRemove={() => setting.onRemove(field.key)}
    />
  )

  return (
    <div
      className={join(
        nested
          ? 'border-t border-hairline px-3 py-3 first-of-type:border-0'
          : 'border-t border-hairline first:border-t-0',
        !nested && open && 'bg-surface-sunken',
      )}
    >
      {!nested && (
        <div className="flex items-center gap-1.5 py-2 pr-2.5 pl-3">
          <button
            type="button"
            aria-expanded={open}
            onClick={() => setOpen((showing) => !showing)}
            className="flex h-10 min-w-0 flex-1 items-center gap-2.5 rounded-lg px-2 text-left hover:bg-canvas"
          >
            <span aria-hidden className="shrink-0 text-ink-soft">
              {iconOf(field.kind)}
            </span>
            <span
              className={join(
                'min-w-[4.5rem] flex-[1_1_auto] truncate font-mono text-sm',
                field.name === '' ? 'text-ink-faint' : 'text-ink',
              )}
            >
              {field.name === '' ? t('row.unnamed') : field.name}
            </span>
            <span className="shrink-0 rounded-full bg-canvas px-2 py-px font-mono text-xs text-ink-soft">
              {field.kind}
            </span>
            {flags.length > 0 && (
              <span className="min-w-0 flex-[0_100_auto] truncate text-xs text-ink-faint">
                {flags.join(' · ')}
              </span>
            )}
            {missing !== undefined && (
              <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-warning-wash px-2.5 py-0.5 text-sm font-semibold text-warning-ink">
                <TriangleAlert aria-hidden className="size-3.5" />
                {missing}
              </span>
            )}
            <ChevronRight
              aria-hidden
              className={join(
                'ml-auto size-[18px] shrink-0 text-ink-subdued transition-transform duration-[180ms]',
                open && 'rotate-90',
              )}
            />
          </button>
          {controls}
        </div>
      )}

      {expanded && (
        <div className={nested ? 'space-y-3.5' : 'space-y-3.5 px-3.5 pt-1 pb-4.5 pl-10'}>
          {nested && <div className="flex justify-end">{controls}</div>}

          {/* Name, Kind and Label side by side, wrapping to one column in a narrow
              panel — the three answers a field needs before anything else can be said
              about it. */}
          <div className="grid grid-cols-[repeat(auto-fit,minmax(170px,1fr))] gap-3.5">
            {named && (
              <Field
                label={t('collections.column.name')}
                required
                {...(locks.name ? { help: t('row.nameFrozen') } : {})}
                {...(issues.length === 0 ? {} : { errors: issues })}
              >
                <Input
                  className={join('font-mono text-sm', locks.name && 'bg-surface-sunken')}
                  placeholder="author"
                  readOnly={locks.name}
                  value={field.name}
                  onChange={(event) => change({ name: event.target.value })}
                />
              </Field>
            )}

            <Field
              label={t('row.kind')}
              required
              {...(locks.kind ? { help: t('row.kindFrozen') } : {})}
              {...(named || issues.length === 0 ? {} : { errors: issues })}
            >
              <Picker
                label={t('row.kind')}
                value={field.kind}
                disabled={locks.kind}
                onChange={(kind) => change(shaped(field, kind, setting.newKey))}
                groups={groupedKinds(
                  /* A stored kind a plugin used to provide is still what the values
                     are, so it stays offered even when the application no longer
                     declares it — and so does a group at a depth this form would no
                     longer offer one at. */
                  kinds.includes(field.kind) ? kinds : [field.kind, ...kinds],
                ).map((group) => ({
                  label: t(group.label),
                  options: group.kinds.map((kind) => {
                    const line = helpOf(kind)

                    return {
                      value: kind,
                      label: kind,
                      icon: iconOf(kind),
                      ...(line === undefined ? {} : { help: t(line) }),
                    }
                  }),
                }))}
              />
            </Field>

            <Field label={t('editor.label')} help={t('row.labelHelp')}>
              <Input
                placeholder={field.name === '' ? t('row.labelExample') : undefined}
                value={field.label}
                onChange={(event) => change({ label: event.target.value })}
              />
            </Field>
          </div>

          {/* What this kind is, under the row that chose it. The picker says the same
              thing while it is open; this is what is left once it has closed. */}
          {help !== undefined && <p className="text-sm text-ink-subdued">{t(help)}</p>}

          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <Checkbox checked={field.required} onChange={(required) => change({ required })}>
              {t('row.required')}
            </Checkbox>

            {/* Only at the top. Search and filtering address a resource field by name and
            never reach inside a value, so `object()` and `array()` refuse both — a
            checkbox for one here would be a flag the command turns into a refusal.
            No "sortable" at any depth: a collection's entries are ordered by the entry's
            own columns and by nothing else, because a field's value lives inside one
            JSONB document (ADR-0012). `src/collections/draft.ts` carries the whole
            reason; the list screen leaves the same control out for the same one. */}
            {!nested && (
              <>
                <Checkbox
                  checked={field.searchable}
                  onChange={(searchable) => change({ searchable })}
                >
                  {t('row.searchable')}
                </Checkbox>
                <Checkbox
                  checked={field.filterable}
                  onChange={(filterable) => change({ filterable })}
                >
                  {t('row.filterable')}
                </Checkbox>
              </>
            )}

            {field.kind === 'table' && (
              <span className="text-sm text-ink-faint">{t('row.tableColumns')}</span>
            )}

            {/* Once per list rather than once per row: the kind picker is shorter here than
            it was one level up, and that is worth explaining exactly once. */}
            {index === 0 &&
              depth >= setting.maxDepth &&
              CONTAINERS.some((kind) => setting.kinds.includes(kind)) && (
                <span className="text-sm text-ink-faint">
                  {t('row.deepest', { count: setting.maxDepth })}
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
