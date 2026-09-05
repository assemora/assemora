/**
 * One input per field kind (SPEC.md §39, §115).
 *
 * The resource says a field is `richText` or `checkboxes` or `array`; this decides what
 * that looks like. Studio adds no validation of its own — the server validates, and
 * a second implementation here would only drift from it (SPEC.md §14). What the controls
 * below do instead is make the shape the server wants the *only* shape they can produce:
 * a link carries its tag, a table's rows stay as wide as its headings, a colour is typed
 * into an input a swatch is bound to.
 *
 * A group and a repeater are drawn by this file calling itself, from the `fields` and
 * `element` a descriptor carries. There is no second form for "inner fields" and no list
 * anywhere of what a repeater may repeat.
 */
import { useQuery } from '@tanstack/react-query'
import { useEffect, useState } from 'react'

import { api } from '../api/client.ts'
import {
  type FieldDescriptor,
  labelOf,
  type ResourceDescriptor,
  useIntrospection,
  valueAt,
} from '../api/introspection.ts'
import { useT } from '../i18n/translate.tsx'
import { Badge, Button, Checkbox, Field, Input, Select, Switch, Textarea } from '../ui/index.tsx'
import { MediaPicker } from './media-picker.tsx'
import { RichTextInput } from './rich-text.tsx'

/**
 * What the application said about one value, keyed by the path *under* it.
 *
 * `''` is the field itself, `name` is a key of a group, `2.heading` is a field of the
 * third item of a repeater. A `ValidationError` names the whole path (`sections.2.heading`)
 * and a container hands each child the part below its own name, so a refusal about an
 * item lands on that item rather than in a box at the top of the page (SPEC.md §84).
 */
export type FieldIssues = Readonly<Record<string, readonly string[]>>

/** The issues about one thing inside this value, addressed from there. */
const narrowed = (issues: FieldIssues | undefined, segment: string): FieldIssues | undefined => {
  if (issues === undefined) return undefined

  const under: Record<string, readonly string[]> = {}

  for (const [path, messages] of Object.entries(issues)) {
    if (path === segment) under[''] = messages
    else if (path.startsWith(`${segment}.`)) under[path.slice(segment.length + 1)] = messages
  }

  return Object.keys(under).length === 0 ? undefined : under
}

/** Everything an inner control did not claim, so nothing the application said is lost. */
const leftOver = (issues: FieldIssues | undefined, claimed: readonly string[]): readonly string[] =>
  Object.entries(issues ?? {})
    .filter(
      ([path]) =>
        path !== '' && !claimed.some((name) => path === name || path.startsWith(`${name}.`)),
    )
    .flatMap(([path, messages]) => messages.map((message) => `${path}: ${message}`))

export type FieldInputProps = {
  readonly field: FieldDescriptor
  readonly value: unknown
  readonly issues?: FieldIssues
  onChange(value: unknown): void
}

const asText = (value: unknown): string =>
  value === null || value === undefined ? '' : String(value)

const asRecord = (value: unknown): Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}

const asList = (value: unknown): readonly unknown[] => (Array.isArray(value) ? value : [])

const asWords = (value: unknown): readonly string[] =>
  asList(value).filter((entry): entry is string => typeof entry === 'string')

const asRows = (value: unknown): readonly (readonly string[])[] =>
  asList(value).map((row) => asWords(row))

const pad = (value: number): string => String(value).padStart(2, '0')

/**
 * What a `date` or `datetime-local` input wants, from what the API sent.
 *
 * The two kinds are formatted in different zones, and getting that backwards is wrong
 * in both directions.
 *
 * A `datetime` is an **instant**, and the input holds wall-clock time with no zone
 * attached — so it has to be the reader's wall clock. Formatted through
 * `toISOString()` it was UTC's: 18:00 in Kyiv was stored correctly as 15:00Z and then
 * displayed as 15:00, so an editor read back three hours earlier than they had typed.
 * The write path was always right — a `datetime-local` value has no zone, and
 * `new Date('2026-09-03T18:00')` reads it as local — which is why the error never
 * compounded, and why nobody caught it from the data.
 *
 * A `date` is a **calendar day** and not an instant. Midnight UTC read in any negative
 * offset is the day before, so formatting one in local time would move somebody's
 * birthday. It stays as written.
 *
 * Local formatting is done with the local getters rather than by shifting the epoch by
 * `getTimezoneOffset()`: the offset is the one at *that* instant, so the getters are
 * right across a daylight-saving boundary and the arithmetic is only right away from
 * one.
 */
export const asDateInput = (value: unknown, withTime: boolean): string => {
  if (value === null || value === undefined || value === '') return ''

  const date = new Date(String(value))

  if (Number.isNaN(date.getTime())) return ''

  if (!withTime) return date.toISOString().slice(0, 10)

  const day = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`

  return `${day}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

const MediaInput = ({
  field,
  value,
  onChange,
}: {
  field: FieldDescriptor
  value: unknown
  onChange(value: unknown): void
}) => {
  const [picking, setPicking] = useState(false)
  const t = useT()
  const id = asText(value)

  return (
    /*
     * A framed slot rather than a button on a line (`design_handoff_studio_redesign` §3):
     * a picture is the one field whose value can be seen, and an 88×60 plate is the
     * smallest thing that lets somebody tell one photograph from another without opening
     * the library.
     */
    <div className="flex flex-wrap items-center gap-4 rounded-lg border border-line p-3">
      {id === '' ? (
        <span
          aria-hidden
          className="h-15 w-22 shrink-0 rounded-lg border border-line bg-canvas"
          style={{
            backgroundImage:
              'repeating-linear-gradient(135deg, rgb(0 0 0 / 0.05) 0 1px, transparent 1px 8px)',
          }}
        />
      ) : (
        <img
          src={`/api/media/by-id/${id}`}
          alt=""
          className="h-15 w-22 shrink-0 rounded-lg border border-line object-cover"
        />
      )}

      <div className="min-w-0">
        <p className="mb-2 font-mono text-sm text-ink-soft">
          {id === '' ? <span className="text-ink-faint">{t('fields.nothingChosen')}</span> : id}
          {/* An authoring constraint and not a validation one: what an id points at
              lives in another table, so the field cannot check it and does not claim
              to. */}
          {field.accept !== undefined && field.accept.length > 0 && (
            <span className="text-ink-faint"> · {field.accept.join(', ')}</span>
          )}
        </p>

        <div className="flex gap-2">
          <Button variant="secondary" size="sm" onClick={() => setPicking(true)}>
            {id === '' ? t('fields.choose') : t('fields.replace')}
          </Button>

          {id !== '' && (
            <Button
              variant="ghost"
              size="sm"
              className="text-danger hover:bg-danger-soft"
              onClick={() => onChange(null)}
            >
              {t('common.remove')}
            </Button>
          )}
        </div>
      </div>

      {picking && (
        <MediaPicker
          onClose={() => setPicking(false)}
          onPick={(picked) => {
            onChange(picked.id)
            setPicking(false)
          }}
        />
      )}
    </div>
  )
}

const JsonInput = ({ value, onChange }: { value: unknown; onChange(value: unknown): void }) => {
  const t = useT()
  const written = JSON.stringify(value ?? null, null, 2)
  const [text, setText] = useState(written)
  const [broken, setBroken] = useState(false)

  // The value can change under the field — another block selected, a command
  // answering — and the text has to follow it rather than stay where it started.
  // Not while it is being typed into: that is what `broken` and the equality check
  // guard against.
  useEffect(() => {
    setText((current) => {
      try {
        return JSON.stringify(JSON.parse(current)) === JSON.stringify(value ?? null)
          ? current
          : written
      } catch {
        return current
      }
    })
  }, [written, value])

  return (
    <div className="space-y-1">
      <Textarea
        className="font-mono text-sm"
        rows={6}
        value={text}
        onChange={(event) => {
          setText(event.target.value)

          try {
            onChange(JSON.parse(event.target.value))
            setBroken(false)
          } catch {
            setBroken(true)
          }
        }}
      />
      {broken && <span className="text-sm text-danger">{t('fields.brokenJson')}</span>}
    </div>
  )
}

// --- the kinds whose value is one thing --------------------------------------

const CheckboxesInput = ({
  field,
  value,
  onChange,
}: {
  field: FieldDescriptor
  value: unknown
  onChange(value: unknown): void
}) => {
  const chosen = asWords(value)
  const options = field.options ?? []
  const t = useT()

  if (options.length === 0) {
    return <span className="text-base text-ink-faint">{t('fields.noOptions')}</span>
  }

  return (
    <div className="flex flex-wrap gap-x-5 gap-y-2">
      {options.map((option) => (
        <Checkbox
          key={option.value}
          checked={chosen.includes(option.value)}
          // Ticked in the order they were ticked, which is the order the value is
          // stored in: a list of tags reads the way its author built it.
          onChange={(ticked) =>
            onChange(
              ticked ? [...chosen, option.value] : chosen.filter((each) => each !== option.value),
            )
          }
        >
          {option.label}
        </Checkbox>
      ))}
    </div>
  )
}

/**
 * What `<input type="color">` can show, which is `#rrggbb` and nothing else.
 *
 * A three- or four-digit value is expanded and an alpha channel is dropped *for the
 * swatch*; what is stored stays exactly what was typed, because `#FFF` and `#ffffff`
 * are the author's choice and rewriting one into the other is the field inventing an
 * edit nobody made.
 */
const swatchOf = (value: string): string => {
  const hex = value.trim()

  if (/^#[0-9a-fA-F]{3,4}$/.test(hex)) {
    return `#${[...hex.slice(1, 4)].map((digit) => `${digit}${digit}`).join('')}`
  }

  if (/^#[0-9a-fA-F]{6}$/.test(hex) || /^#[0-9a-fA-F]{8}$/.test(hex)) return hex.slice(0, 7)

  return '#000000'
}

/**
 * A swatch and the value beside it.
 *
 * A swatch alone cannot be typed into or pasted into, and a hex colour is the one thing
 * everybody already has in their clipboard from somewhere else.
 */
const ColorInput = ({ value, onChange }: { value: unknown; onChange(value: unknown): void }) => {
  const text = asText(value)
  const t = useT()

  return (
    <div className="flex items-center gap-2">
      <input
        type="color"
        aria-label={t('fields.pickColour')}
        className="size-9 shrink-0 cursor-pointer rounded-lg border border-line bg-surface p-1"
        value={swatchOf(text)}
        onChange={(event) => onChange(event.target.value)}
      />
      <Input
        className="max-w-40 font-mono text-sm"
        placeholder="#4a5ed6"
        value={text}
        onChange={(event) => onChange(event.target.value === '' ? null : event.target.value)}
      />
      {text !== '' && (
        <Button variant="ghost" size="sm" onClick={() => onChange(null)}>
          {t('common.clear')}
        </Button>
      )}
    </div>
  )
}

/**
 * Source and the language it is in — the two values `text()` cannot hold at once.
 *
 * Monospace, no highlighting and no toolbar. Nothing in this application executes what
 * is typed here or renders it as HTML.
 */
const CodeInput = ({
  field,
  value,
  onChange,
}: {
  field: FieldDescriptor
  value: unknown
  onChange(value: unknown): void
}) => {
  const current = asRecord(value)
  const language = asText(current.language)
  const source = asText(current.source)
  const languages = field.options ?? []
  const t = useT()

  // An empty pair is not a half-written value, it is no value: sending
  // `{ language: '', source: '' }` would be refused for a language that is not a name,
  // where clearing a field is an ordinary edit everywhere else.
  const emit = (next: { language: string; source: string }) =>
    onChange(next.language === '' && next.source === '' ? null : next)

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        {languages.length === 0 ? (
          <Input
            className="max-w-40 font-mono text-sm"
            placeholder="ts"
            aria-label={t('fields.language')}
            value={language}
            onChange={(event) => emit({ language: event.target.value, source })}
          />
        ) : (
          <Select
            className="max-w-40"
            aria-label={t('fields.language')}
            value={language}
            onChange={(event) => emit({ language: event.target.value, source })}
          >
            <option value="">{t('fields.chooseLanguage')}</option>
            {languages.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </Select>
        )}
        <span className="text-sm text-ink-faint">{t('fields.neverRun')}</span>
      </div>

      <Textarea
        className="font-mono text-sm"
        rows={10}
        spellCheck={false}
        value={source}
        onChange={(event) => emit({ language, source: event.target.value })}
      />
    </div>
  )
}

/**
 * What an entry is called wherever one line of text stands for the whole row.
 *
 * The resource's own answer first: `titleField` is a declaration, and everything below
 * it is a guess. The guess reads the first declared field that holds text, which makes
 * the answer depend on the order somebody wrote the fields in — declare `articleNumber`
 * before `name` and every list reads `091`, `001`, `144`.
 */
const titleOf = (resource: ResourceDescriptor, row: Readonly<Record<string, unknown>>): string => {
  const declared =
    resource.titleField === undefined ? undefined : String(row[resource.titleField] ?? '')

  if (declared !== undefined && declared !== '') return declared

  const readable = resource.fields.find(
    (field) =>
      !field.hidden &&
      ['text', 'slug', 'email', 'url', 'select'].includes(field.kind) &&
      typeof row[field.name] === 'string' &&
      row[field.name] !== '',
  )

  return readable === undefined
    ? String(row[resource.primaryKey] ?? row.id ?? '')
    : String(row[readable.name])
}

type Listing = { readonly data: readonly Record<string, unknown>[] }

/**
 * One entry of one resource, chosen by its title rather than typed as a uuid.
 *
 * A page of entries rather than the whole set (SPEC.md §89), searched where the
 * resource declares a searchable field. A stored id the page does not hold stays
 * offered, because it is still what the value points at.
 */
const EntryOfResource = ({
  resource,
  id,
  onPick,
}: {
  resource: ResourceDescriptor
  id: string
  onPick(id: string): void
}) => {
  const [search, setSearch] = useState('')
  const t = useT()

  const listing = useQuery({
    queryKey: ['entries', resource.name, search],
    queryFn: ({ signal }) =>
      api.query<Listing>('entries.list', { resource: resource.name, search, perPage: 50 }, signal),
  })

  const rows = listing.data?.data ?? []

  if (listing.isError) {
    // The listing is a query like any other and can be refused: a role may read this
    // entry and not that resource. The id is still writable by hand, so the value is
    // not stuck behind a control that cannot load.
    return (
      <div className="space-y-1">
        <Input
          className="font-mono text-sm"
          placeholder={t('fields.theId')}
          value={id}
          onChange={(event) => onPick(event.target.value)}
        />
        <span className="text-sm text-ink-faint">
          {t('fields.cannotList', { name: resource.label })}
        </span>
      </div>
    )
  }

  return (
    <div className="space-y-2">
      {resource.fields.some((field) => field.searchable) && (
        <Input
          type="search"
          className="max-w-48"
          placeholder={t('fields.searchIn', { name: resource.label.toLowerCase() })}
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
      )}

      <Select
        aria-label={t('fields.whichEntry')}
        value={id}
        onChange={(event) => onPick(event.target.value)}
      >
        <option value="">
          {listing.isPending ? t('fields.loading') : t('fields.chooseEntry')}
        </option>
        {/* An id this page does not hold — an older entry, one another search found —
            is still what the value points at, so it stays offered. */}
        {id === '' || rows.some((row) => entryOf(row) === id) ? null : (
          <option value={id}>{id}</option>
        )}
        {rows.map((row) => (
          <option key={String(row.id)} value={entryOf(row)}>
            {titleOf(resource, row)}
          </option>
        ))}
      </Select>
    </div>
  )
}

/**
 * Which entry a listed row belongs to (SPEC.md §131).
 *
 * A reference names the *original* row of an entry, in every language — a Russian dish
 * names the Ukrainian category, because the category is one entry in three languages and
 * a foreign key names one row. So a listing read in Russian, which answers with Russian
 * rows, has to offer their entries: otherwise the value already stored matches nothing
 * on the list and shows as a bare id, and picking from the list writes a Russian row's
 * id into a key that must name the original.
 *
 * `translationOf` is projected beside `id` on a translatable resource, and absent on
 * every other, where a row is its own entry.
 */
const entryOf = (row: Record<string, unknown>): string => String(row.translationOf ?? row.id)

/** Which entry of which resource a link points at. */
const EntryPicker = ({
  resource,
  id,
  onPick,
}: {
  resource: string
  id: string
  onPick(next: { resource: string; id: string }): void
}) => {
  const introspection = useIntrospection()
  const t = useT()
  const resources = (introspection.data?.resources ?? []).filter((each) => each.api.read)
  const chosen = resources.find((each) => each.name === resource)

  return (
    <div className="space-y-2">
      <Select
        className="max-w-48"
        aria-label={t('fields.whichResource')}
        value={resource}
        onChange={(event) => onPick({ resource: event.target.value, id: '' })}
      >
        <option value="">{t('fields.chooseResource')}</option>
        {/* A resource this application no longer has is still what the link points
            at, so it stays offered rather than vanishing. */}
        {resource === '' || resources.some((each) => each.name === resource) ? null : (
          <option value={resource}>{resource}</option>
        )}
        {resources.map((each) => (
          <option key={each.name} value={each.name}>
            {each.label}
          </option>
        ))}
      </Select>

      {chosen !== undefined && (
        <EntryOfResource
          resource={chosen}
          id={id}
          onPick={(next) => onPick({ resource, id: next })}
        />
      )}
    </div>
  )
}

/**
 * A reference to an entry of the resource the field named (SPEC.md §39).
 *
 * The target is part of the declaration, so this control has nothing to ask: it lists
 * that resource and nothing else. Clearing sends `null` rather than an empty string,
 * which is what clears an optional field — an empty string is not a uuid, and the
 * resource would refuse it.
 */
const RelationInput = ({
  field,
  value,
  onChange,
}: {
  field: FieldDescriptor
  value: unknown
  onChange(value: unknown): void
}) => {
  const introspection = useIntrospection()
  const t = useT()
  const target = field.target ?? ''
  const chosen = (introspection.data?.resources ?? []).find((each) => each.name === target)

  // A relation whose target this application does not describe — not registered, or
  // not readable by this actor. The id is what the column holds, so it stays editable
  // rather than leaving the field unfillable, and the reason is said out loud.
  if (chosen === undefined || !chosen.api.read) {
    return (
      <div className="space-y-1">
        <Input
          className="font-mono text-sm"
          placeholder={t('fields.theId')}
          value={asText(value)}
          onChange={(event) => onChange(event.target.value === '' ? null : event.target.value)}
        />
        <span className="text-sm text-ink-faint">
          {target === '' ? t('fields.noTarget') : t('fields.cannotListHere', { name: target })}
        </span>
      </div>
    )
  }

  return (
    <EntryOfResource
      resource={chosen}
      id={asText(value)}
      onPick={(id) => onChange(id === '' ? null : id)}
    />
  )
}

/**
 * A link: a web address, or something in this application.
 *
 * The tag is the value's own, not this control's — `type` is what every reader looks at,
 * and a link that carries both a url and an entry is refused rather than guessed at. A
 * half-written link is sent as it stands and the application says what is missing;
 * choosing “—” is how it is cleared.
 */
type LinkParts = {
  readonly type: '' | 'url' | 'entry'
  readonly url: string
  readonly entry: { readonly resource: string; readonly id: string }
  readonly label: string
  readonly newTab: boolean
}

const LinkInput = ({ value, onChange }: { value: unknown; onChange(value: unknown): void }) => {
  const t = useT()
  const current = asRecord(value)
  const entry = asRecord(current.entry)

  const parts: LinkParts = {
    type: current.type === 'url' || current.type === 'entry' ? current.type : '',
    url: asText(current.url),
    entry: { resource: asText(entry.resource), id: asText(entry.id) },
    label: asText(current.label),
    newTab: current.newTab === true,
  }

  /**
   * The whole value, built from its parts every time one of them changes.
   *
   * Never a spread over what was there: the variant carries `url` *or* `entry`, and a
   * link holding both is refused rather than guessed at — so the control that edits one
   * must not be able to leave the other behind. An empty label and an unticked box are
   * absent keys rather than `""` and `false`, because that is what "not said" is.
   */
  const emit = (over: Partial<LinkParts>) => {
    const next = { ...parts, ...over }

    if (next.type === '') return onChange(null)

    onChange({
      type: next.type,
      ...(next.type === 'url' ? { url: next.url } : { entry: next.entry }),
      ...(next.label === '' ? {} : { label: next.label }),
      ...(next.newTab ? { newTab: true } : {}),
    })
  }

  return (
    <div className="space-y-2 rounded-lg border border-line bg-surface-sunken/40 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <Select
          className="max-w-56"
          aria-label={t('fields.linkPointsAt')}
          value={parts.type}
          onChange={(event) => emit({ type: event.target.value as LinkParts['type'] })}
        >
          <option value="">—</option>
          <option value="url">{t('fields.aWebAddress')}</option>
          <option value="entry">{t('fields.somethingHere')}</option>
        </Select>

        {parts.type !== '' && (
          <Checkbox checked={parts.newTab} onChange={(newTab) => emit({ newTab })}>
            {t('fields.newTab')}
          </Checkbox>
        )}
      </div>

      {parts.type === 'url' && (
        <Input
          type="url"
          placeholder="https://assemora.dev"
          value={parts.url}
          onChange={(event) => emit({ url: event.target.value })}
        />
      )}

      {parts.type === 'entry' && (
        <EntryPicker
          resource={parts.entry.resource}
          id={parts.entry.id}
          onPick={(picked) => emit({ entry: picked })}
        />
      )}

      {parts.type !== '' && (
        <Input
          placeholder={t('fields.linkLabel')}
          value={parts.label}
          onChange={(event) => emit({ label: event.target.value })}
        />
      )}
    </div>
  )
}

/**
 * A grid whose headings are part of its value.
 *
 * Which is the whole reason `table` is a kind and not a repeater of groups: a developer
 * fixes a repeater's shape, and an editor adds a column to a pricing table here without
 * a deployment. Every cell is text, and a row is always exactly as wide as the headings
 * — a ragged one has no honest rendering, so this cannot make one.
 */
const TableInput = ({ value, onChange }: { value: unknown; onChange(value: unknown): void }) => {
  const t = useT()
  const current = asRecord(value)
  const columns = asWords(current.columns)
  const rows = asRows(current.rows)

  const emit = (next: { columns: readonly string[]; rows: readonly (readonly string[])[] }) =>
    onChange(next.columns.length === 0 && next.rows.length === 0 ? null : next)

  const cell = (row: readonly string[], index: number): string => row[index] ?? ''

  return (
    <div className="space-y-2 overflow-x-auto rounded-lg border border-line bg-surface-sunken/40 p-3">
      <table className="w-full text-base">
        <thead>
          <tr>
            {columns.map((heading, column) => (
              // The heading is the only thing identifying a column, and it can be empty
              // while it is being typed, so the position is the key.
              // biome-ignore lint/suspicious/noArrayIndexKey: a column has no other identity
              <th key={column} className="p-1 align-bottom">
                <div className="flex items-center gap-1">
                  <Input
                    className="min-w-24 text-sm font-semibold"
                    aria-label={t('fields.columnHeading', { number: column + 1 })}
                    placeholder={t('fields.heading')}
                    value={heading}
                    onChange={(event) =>
                      emit({
                        columns: columns.map((each, at) =>
                          at === column ? event.target.value : each,
                        ),
                        rows,
                      })
                    }
                  />
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 px-1 text-danger"
                    aria-label={t('fields.removeColumn', { number: column + 1 })}
                    title={t('fields.removeThisColumn')}
                    onClick={() =>
                      emit({
                        columns: columns.filter((_, at) => at !== column),
                        rows: rows.map((row) => row.filter((_, at) => at !== column)),
                      })
                    }
                  >
                    ×
                  </Button>
                </div>
              </th>
            ))}
            <th className="w-0 p-1 align-bottom">
              <Button
                variant="secondary"
                size="sm"
                title={t('fields.addColumn')}
                onClick={() =>
                  emit({
                    columns: [...columns, ''],
                    // Every row grows with it: a row is never a different width from the
                    // headings, not even between two clicks.
                    rows: rows.map((row) => [...row, '']),
                  })
                }
              >
                {t('fields.plusColumn')}
              </Button>
            </th>
          </tr>
        </thead>

        <tbody>
          {rows.map((row, index) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: a row has no other identity
            <tr key={index}>
              {columns.map((_, column) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: a cell has no other identity
                <td key={column} className="p-1">
                  <Input
                    className="min-w-24 text-sm"
                    aria-label={t('fields.cell', { row: index + 1, column: column + 1 })}
                    value={cell(row, column)}
                    onChange={(event) =>
                      emit({
                        columns,
                        rows: rows.map((each, at) =>
                          at === index
                            ? columns.map((__, position) =>
                                position === column ? event.target.value : cell(each, position),
                              )
                            : each,
                        ),
                      })
                    }
                  />
                </td>
              ))}
              <td className="p-1 text-right">
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 px-1 text-danger"
                  aria-label={t('fields.removeRow', { number: index + 1 })}
                  title={t('fields.removeThisRow')}
                  onClick={() => emit({ columns, rows: rows.filter((_, at) => at !== index) })}
                >
                  ×
                </Button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="flex items-center gap-2">
        <Button
          variant="secondary"
          size="sm"
          disabled={columns.length === 0}
          title={columns.length === 0 ? t('fields.columnFirst') : t('fields.addRow')}
          onClick={() => emit({ columns, rows: [...rows, columns.map(() => '')] })}
        >
          {t('fields.addRow')}
        </Button>
        {columns.length === 0 && (
          <span className="text-sm text-ink-faint">{t('fields.startsWithColumn')}</span>
        )}
      </div>
    </div>
  )
}

// --- the kinds that hold other fields ----------------------------------------

/** What a repeater's new item starts as, so the element's own control can draw it. */
const emptyValue = (field: FieldDescriptor): unknown => {
  switch (field.kind) {
    case 'object':
      return {}
    case 'array':
    case 'checkboxes':
      return []
    case 'boolean':
      return false
    case 'text':
    case 'textarea':
    case 'richText':
    case 'markdown':
    case 'slug':
    case 'url':
    case 'email':
    case 'select':
      return ''
    default:
      return null
  }
}

const GroupInput = ({
  field,
  value,
  issues,
  onChange,
}: {
  field: FieldDescriptor
  value: unknown
  issues: FieldIssues | undefined
  onChange(value: unknown): void
}) => {
  const current = asRecord(value)
  const inner = field.fields ?? []

  return (
    <div className="space-y-4 rounded-lg border border-line bg-surface-sunken/40 p-4">
      {inner.map((nested) => {
        const under = narrowed(issues, nested.name)

        return (
          <FieldInput
            key={nested.name}
            field={nested}
            value={valueAt(current, nested.name)}
            {...(under === undefined ? {} : { issues: under })}
            onChange={(next) => onChange({ ...current, [nested.name]: next })}
          />
        )
      })}
    </div>
  )
}

const Repeated = ({
  element,
  value,
  index,
  count,
  issues,
  onChange,
  onMove,
  onRemove,
}: {
  element: FieldDescriptor
  value: unknown
  index: number
  count: number
  issues: FieldIssues | undefined
  onChange(value: unknown): void
  onMove(by: number): void
  onRemove(): void
}) => {
  const t = useT()

  return (
    <li className="rounded-lg border border-line bg-surface p-3">
      <div className="mb-2 flex items-center gap-1">
        <div className="ml-auto flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            className="h-6 px-1.5"
            disabled={index === 0}
            aria-label={t('fields.moveUp', { number: index + 1 })}
            title={t('fields.up')}
            onClick={() => onMove(-1)}
          >
            ↑
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-6 px-1.5"
            disabled={index === count - 1}
            aria-label={t('fields.moveDown', { number: index + 1 })}
            title={t('fields.down')}
            onClick={() => onMove(1)}
          >
            ↓
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-6 px-1.5 text-danger"
            aria-label={t('fields.removeItem', { number: index + 1 })}
            title={t('fields.removeThisItem')}
            onClick={onRemove}
          >
            {t('common.remove')}
          </Button>
        </div>
      </div>

      {/* The element's own label is `Element` — the descriptor names it after the key a
        definition holds it under — and a card headed "Element" three times over says
        nothing. The number is what identifies an item, so the number is its label. */}
      <FieldInput
        field={{ ...element, label: t('fields.item', { number: index + 1 }) }}
        value={value}
        {...(issues === undefined ? {} : { issues })}
        onChange={onChange}
      />
    </li>
  )
}

/**
 * Any number of one field: add a row, remove one, move one.
 *
 * An item has no identity of its own — the value is a list, and two identical items are
 * the same value — so the position is the key. That is what makes reordering redraw both
 * rows rather than move a component.
 */
const RepeaterInput = ({
  field,
  value,
  issues,
  onChange,
}: {
  field: FieldDescriptor
  value: unknown
  issues: FieldIssues | undefined
  onChange(value: unknown): void
}) => {
  const items = asList(value)
  const element = field.element
  const t = useT()

  if (element === undefined) return <JsonInput value={value} onChange={onChange} />

  const moved = (from: number, by: number): readonly unknown[] => {
    const to = from + by

    if (to < 0 || to >= items.length) return items

    const reordered = [...items]
    const [moving] = reordered.splice(from, 1)

    reordered.splice(to, 0, moving)

    return reordered
  }

  return (
    <div className="space-y-2">
      {items.length === 0 ? (
        <p className="text-base text-ink-faint">{t('fields.nothingHereYet')}</p>
      ) : (
        <ol className="space-y-2">
          {items.map((item, index) => (
            <Repeated
              // The item's position is its only identity: the list holds values, not
              // rows, and two identical ones are indistinguishable.
              // biome-ignore lint/suspicious/noArrayIndexKey: an item has no other identity
              key={index}
              element={element}
              value={item}
              index={index}
              count={items.length}
              issues={narrowed(issues, String(index))}
              onChange={(next) => onChange(items.map((each, at) => (at === index ? next : each)))}
              onMove={(by) => onChange(moved(index, by))}
              onRemove={() => onChange(items.filter((_, at) => at !== index))}
            />
          ))}
        </ol>
      )}

      <Button
        variant="secondary"
        size="sm"
        onClick={() => onChange([...items, emptyValue(element)])}
      >
        {t('fields.addItem')}
      </Button>
    </div>
  )
}

// --- the switch --------------------------------------------------------------

/**
 * A kind this switch has never heard of — a plugin's (SPEC.md §39).
 *
 * Read off the field's own JSON Schema rather than guessed from the name, because that
 * schema is the one thing every kind has and it is the same declaration the server
 * validates against. A composite gets a box that can hold one; a string gets a text
 * input. Nothing here breaks the form, and nothing pretends to know more than it does.
 */
const Fallback = ({
  field,
  value,
  onChange,
}: {
  field: FieldDescriptor
  value: unknown
  onChange(value: unknown): void
}) => {
  const type = field.schema?.type

  if (type === 'object' || type === 'array' || (typeof value === 'object' && value !== null)) {
    return <JsonInput value={value} onChange={onChange} />
  }

  if (type === 'boolean') {
    return (
      <Switch label={labelOf(field)} checked={value === true} onChange={(next) => onChange(next)} />
    )
  }

  if (type === 'number' || type === 'integer') {
    return (
      <Input
        type="number"
        {...(type === 'integer' ? { step: 1 } : {})}
        value={asText(value)}
        onChange={(event) =>
          onChange(event.target.value === '' ? null : Number(event.target.value))
        }
      />
    )
  }

  return (
    <Input
      placeholder={field.placeholder}
      value={asText(value)}
      onChange={(event) => onChange(event.target.value)}
    />
  )
}

const Control = ({
  field,
  value,
  issues,
  onChange,
}: {
  field: FieldDescriptor
  value: unknown
  issues: FieldIssues | undefined
  onChange(value: unknown): void
}) => {
  switch (field.kind) {
    case 'boolean':
      return (
        <Switch
          label={labelOf(field)}
          checked={value === true}
          onChange={(next) => onChange(next)}
        />
      )

    case 'select':
      return (
        <Select value={asText(value)} onChange={(event) => onChange(event.target.value)}>
          <option value="">—</option>
          {field.options?.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </Select>
      )

    case 'checkboxes':
      return <CheckboxesInput field={field} value={value} onChange={onChange} />

    case 'number':
    case 'integer':
      return (
        <Input
          type="number"
          // The browser's own constraint, not a second validator: an integer field
          // refuses 3.5 where it is typed rather than one request later.
          {...(field.kind === 'integer' ? { step: 1, inputMode: 'numeric' as const } : {})}
          value={asText(value)}
          onChange={(event) =>
            onChange(event.target.value === '' ? null : Number(event.target.value))
          }
        />
      )

    case 'date':
    case 'datetime':
      return (
        <Input
          type={field.kind === 'date' ? 'date' : 'datetime-local'}
          value={asDateInput(value, field.kind === 'datetime')}
          onChange={(event) =>
            onChange(event.target.value === '' ? null : new Date(event.target.value).toISOString())
          }
        />
      )

    // A time of day and not an instant: no timezone is applied to it anywhere, which is
    // the whole reason it is not a `datetime`.
    case 'time':
      return (
        <Input
          type="time"
          className="max-w-32"
          value={asText(value)}
          onChange={(event) => onChange(event.target.value === '' ? null : event.target.value)}
        />
      )

    case 'color':
      return <ColorInput value={value} onChange={onChange} />

    case 'code':
      return <CodeInput field={field} value={value} onChange={onChange} />

    // Monospace and no toolbar. A toolbar with fonts and colours in it is the CSS
    // editor arriving through the field layer, and markdown is markdown (SPEC.md §61).
    case 'markdown':
      return (
        <Textarea
          className="font-mono text-base"
          rows={14}
          spellCheck
          value={asText(value)}
          onChange={(event) => onChange(event.target.value)}
        />
      )

    // Written as text, not as tags: a textarea here meant typing <p> and <strong> by
    // hand on a screen made for the person who runs the business.
    case 'richText':
      return <RichTextInput value={asText(value)} onChange={onChange} />

    case 'textarea':
      return (
        <Textarea
          rows={4}
          value={asText(value)}
          onChange={(event) => onChange(event.target.value)}
        />
      )

    case 'link':
      return <LinkInput value={value} onChange={onChange} />

    case 'table':
      return <TableInput value={value} onChange={onChange} />

    case 'object':
      // A group with no described fields is a group nothing can be drawn from: a JSON
      // box says so honestly rather than showing an empty card.
      return field.fields === undefined || field.fields.length === 0 ? (
        <JsonInput value={value} onChange={onChange} />
      ) : (
        <GroupInput field={field} value={value} issues={issues} onChange={onChange} />
      )

    case 'array':
      return <RepeaterInput field={field} value={value} issues={issues} onChange={onChange} />

    case 'json':
      return <JsonInput value={value} onChange={onChange} />

    case 'media':
      return <MediaInput field={field} value={value} onChange={onChange} />

    case 'relation':
      return <RelationInput field={field} value={value} onChange={onChange} />

    case 'text':
    case 'slug':
      return (
        <Input
          placeholder={field.placeholder}
          value={asText(value)}
          onChange={(event) => onChange(event.target.value)}
        />
      )

    case 'email':
    case 'url':
      return (
        <Input
          type={field.kind}
          placeholder={field.placeholder}
          value={asText(value)}
          onChange={(event) => onChange(event.target.value)}
        />
      )

    default:
      return <Fallback field={field} value={value} onChange={onChange} />
  }
}

/** The paths inside this value that a control of its own is drawing. */
const claimedBy = (field: FieldDescriptor, value: unknown): readonly string[] => {
  if (field.kind === 'object' && field.fields !== undefined) {
    return field.fields.map((inner) => inner.name)
  }

  if (field.kind === 'array' && field.element !== undefined) {
    return asList(value).map((_, index) => String(index))
  }

  return []
}

/**
 * Whether this field draws as a switch, and so wants its label beside it.
 *
 * `json()` takes a type argument nothing validates at runtime, so a boolean can also
 * arrive as a JSON field whose schema says `boolean` — the same control, and the same
 * row.
 */
const isSwitch = (field: FieldDescriptor): boolean =>
  field.kind === 'boolean' || (field.kind === 'json' && field.schema?.type === 'boolean')

export const FieldInput = ({ field, value, issues, onChange }: FieldInputProps) => {
  const t = useT()

  // Anything the application said about something inside this value that no inner
  // control is drawing — a key a group no longer declares, an item that is no longer
  // there. Shown here rather than dropped: an unsaid refusal is the defect `Failure`
  // exists to have fixed (SPEC.md §84).
  const shown = [...(issues?.[''] ?? []), ...leftOver(issues, claimedBy(field, value))]

  return (
    <Field
      label={labelOf(field)}
      help={
        field.kind === 'slug' && field.source !== undefined
          ? t('fields.madeFrom', { source: field.source })
          : (field.help ?? (field.readOnly ? t('fields.readOnly') : undefined))
      }
      required={field.required}
      {...(shown.length === 0 ? {} : { errors: shown })}
      inline={isSwitch(field)}
    >
      <Control field={field} value={value} issues={issues} onChange={onChange} />
    </Field>
  )
}

export const FieldBadge = ({ field }: { field: FieldDescriptor }) => (
  <Badge tone={field.required ? 'accent' : 'neutral'}>{field.kind}</Badge>
)
