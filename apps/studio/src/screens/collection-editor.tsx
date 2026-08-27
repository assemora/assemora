/**
 * Making a collection, and changing one (SPEC.md §37, §39, §115).
 *
 * Every button here is `collections.create`, `collections.update` or
 * `collections.delete` on the Command Bus — the same three an agent calls over MCP,
 * past the same policies, revisions and audit. Studio adds no rule of its own; what it
 * adds is the sentence before the refusal. A collection that holds entries cannot be
 * deleted, a stored field cannot be renamed, and a field's kind is fixed once values
 * exist — so the controls that would ask for those are locked and say why, rather than
 * accepting the change and answering it with a red bar.
 */
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate, useParams } from '@tanstack/react-router'
import { type FormEvent, useEffect, useRef, useState } from 'react'
import { ApiError, api } from '../api/client.ts'
import {
  type CollectionDeleted,
  type CollectionWritten,
  useCollection,
  useCollections,
} from '../api/collections.ts'
import { useIntrospection } from '../api/introspection.ts'
import { useSession } from '../api/session.tsx'
import { Page } from '../app/shell.tsx'
import { fieldNamePatternOf, kindsOf, namePatternOf, needOf } from '../collections/contract.ts'
import {
  blankField,
  type CollectionDraft,
  draftOf,
  emptyDraft,
  type FieldChange,
  type FieldDraft,
  type FieldLocks,
  issuesOf,
  locksOf,
  moved,
  nameFrom,
  patched,
  payloadOf,
  removals,
  without,
} from '../collections/draft.ts'
import { Badge, Button, Card, Failure, Field, Input, Select, Spinner } from '../ui/index.tsx'

const Flag = ({
  label,
  checked,
  onChange,
}: {
  label: string
  checked: boolean
  onChange(checked: boolean): void
}) => (
  <label className="flex items-center gap-1.5 text-xs text-ink-soft">
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
 * The options of a select field.
 *
 * They may grow while entries exist and may not shrink: an entry can be holding one,
 * and a value the field says is impossible is worse than a choice nobody picks any
 * more. So a locked option has no way to remove it and says so instead.
 */
const Options = ({
  values,
  locked,
  onChange,
}: {
  values: readonly string[]
  locked: readonly string[]
  onChange(values: readonly string[]): void
}) => {
  const [adding, setAdding] = useState('')

  const add = () => {
    const option = adding.trim()

    if (option === '' || values.includes(option)) return

    onChange([...values, option])
    setAdding('')
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-1.5">
        {values.length === 0 && <span className="text-xs text-ink-faint">No options yet</span>}
        {values.map((option) =>
          locked.includes(option) ? (
            <span key={option} title="An entry may hold this option, so it cannot be taken away">
              <Badge>{option} · kept</Badge>
            </span>
          ) : (
            <button
              key={option}
              type="button"
              title="Remove this option"
              onClick={() => onChange(values.filter((each) => each !== option))}
            >
              <Badge tone="accent">{option} ×</Badge>
            </button>
          ),
        )}
      </div>

      <div className="flex gap-2">
        <Input
          className="max-w-48"
          placeholder="Add an option…"
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

/**
 * The extra a kind needs beyond its name.
 *
 * A select is its options, a slug is the field it is made from, a relation is what it
 * points at. Every other kind — including one a plugin registered that Studio has
 * never heard of — needs nothing here, and the command says so if it turns out it does.
 */
const Extra = ({
  field,
  locks,
  fields,
  resources,
  onChange,
}: {
  field: FieldDraft
  locks: FieldLocks
  fields: readonly FieldDraft[]
  resources: readonly { name: string; label: string }[]
  onChange(change: FieldChange): void
}) => {
  const need = needOf(field.kind)

  if (need === 'options') {
    return (
      <Field label="Options" help="A stored entry holds one of these" required>
        <Options
          values={field.options}
          locked={locks.options}
          onChange={(options) => onChange({ options })}
        />
      </Field>
    )
  }

  if (need === 'source') {
    const others = fields.filter((each) => each.key !== field.key && each.name !== '')

    return (
      <Field label="Made from" help="Left empty on an entry, the slug comes from this" required>
        <Select
          className="max-w-56"
          disabled={locks.kind}
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
          disabled={locks.kind}
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

const Row = ({
  field,
  index,
  count,
  kinds,
  locks,
  fields,
  resources,
  issues,
  onChange,
  onMove,
  onRemove,
}: {
  field: FieldDraft
  index: number
  count: number
  kinds: readonly string[]
  locks: FieldLocks
  fields: readonly FieldDraft[]
  resources: readonly { name: string; label: string }[]
  issues: readonly string[]
  onChange(change: FieldChange): void
  onMove(by: number): void
  onRemove(): void
}) => (
  <div className="space-y-3 border-b border-line-soft p-4 last:border-0">
    <div className="flex flex-wrap items-end gap-3">
      <div className="flex flex-col gap-0.5 pb-1">
        <Button
          variant="ghost"
          size="sm"
          className="h-5 px-1.5"
          disabled={index === 0}
          // An arrow is not a name: what a screen reader announces has to say which
          // field is moving, and there are as many of these as there are rows.
          aria-label={`Move ${field.name === '' ? 'this field' : field.name} up`}
          title="Move up"
          onClick={() => onMove(-1)}
        >
          ↑
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="h-5 px-1.5"
          disabled={index === count - 1}
          aria-label={`Move ${field.name === '' ? 'this field' : field.name} down`}
          title="Move down"
          onClick={() => onMove(1)}
        >
          ↓
        </Button>
      </div>

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
            className={`font-mono text-xs${locks.name ? ' bg-surface-sunken' : ''}`}
            placeholder="author"
            readOnly={locks.name}
            value={field.name}
            onChange={(event) => onChange({ name: event.target.value })}
          />
        </Field>
      </div>

      <div className="min-w-40 flex-1">
        <Field
          label="Kind"
          required
          {...(locks.kind ? { help: 'Fixed: entries already hold values of this kind' } : {})}
        >
          <Select
            disabled={locks.kind}
            value={field.kind}
            onChange={(event) => onChange({ kind: event.target.value })}
          >
            {/* A stored kind a plugin used to provide is still what the values are,
                so it is offered even when the application no longer declares it. */}
            {kinds.includes(field.kind) ? null : <option value={field.kind}>{field.kind}</option>}
            {kinds.map((kind) => (
              <option key={kind} value={kind}>
                {kind}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      <div className="min-w-40 flex-1">
        <Field label="Label" help="What an editor sees. Left empty, the name is used">
          <Input
            placeholder={field.name === '' ? 'Author' : undefined}
            value={field.label}
            onChange={(event) => onChange({ label: event.target.value })}
          />
        </Field>
      </div>

      <Button
        variant="ghost"
        size="sm"
        className="mb-1 text-danger"
        aria-label={`Remove ${field.name === '' ? 'this field' : field.name}`}
        title="Remove this field"
        onClick={onRemove}
      >
        Remove
      </Button>
    </div>

    <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
      <Flag
        label="required"
        checked={field.required}
        onChange={(required) => onChange({ required })}
      />
      <Flag
        label="searchable"
        checked={field.searchable}
        onChange={(searchable) => onChange({ searchable })}
      />
      {/* No "sortable". A collection's entries are ordered by the entry's own columns
          and by nothing else, because a field's value lives inside one JSONB document
          (ADR-0012) — so the checkbox could only ever have produced a 422 from the
          listing it was meant to reorder. `src/collections/draft.ts` carries the whole
          reason; the list screen leaves the same control out for the same one. */}
      <Flag
        label="filterable"
        checked={field.filterable}
        onChange={(filterable) => onChange({ filterable })}
      />
    </div>

    <Extra field={field} locks={locks} fields={fields} resources={resources} onChange={onChange} />
  </div>
)

/** What this save will do that cannot be undone, said while it can still be changed. */
const Consequences = ({
  drops,
  entries,
  added,
}: {
  drops: readonly string[]
  entries: number
  added: readonly string[]
}) => {
  if (drops.length === 0 && entries === 0) return null

  return (
    <Card className="space-y-2 border-line bg-surface-sunken p-4">
      <p className="text-sm font-medium">Saving this will</p>

      {drops.length > 0 && (
        <p className="text-sm text-ink-soft">
          Remove {drops.map((name) => `“${name}”`).join(', ')}.
          {entries > 0
            ? ` ${drops.length === 1 ? 'Its values stay in every entry under that name' : 'Their values stay in every entry under those names'}, unreadable, and a later field of ${drops.length === 1 ? 'that name' : 'any of those names'} is refused while this collection holds entries.`
            : ` Nothing is stored under ${drops.length === 1 ? 'that name' : 'those names'} yet.`}
        </p>
      )}

      {entries > 0 && (
        <p className="text-sm text-ink-soft">
          Leave the {entries} {entries === 1 ? 'entry as it is' : 'entries as they are'}. What a
          stored value <em>is</em> — a field’s kind, its options, its slug source, its relation
          target — is fixed while entries exist; what it is called, shown and searched as is not.
        </p>
      )}

      {entries > 0 && added.length > 0 && (
        <p className="text-sm text-ink-soft">
          Add {added.map((name) => `“${name}”`).join(', ')}, which the {entries}{' '}
          {entries === 1 ? 'entry holds' : 'entries hold'} no value for yet.
        </p>
      )}
    </Card>
  )
}

export const CollectionEditor = ({ mode }: { mode: 'create' | 'edit' }) => {
  const params = useParams({ strict: false }) as { name?: string }
  const name = params.name ?? ''
  const navigate = useNavigate()
  const client = useQueryClient()
  const { can } = useSession()

  const keys = useRef(0)
  const nextKey = () => {
    keys.current += 1

    return `new:${keys.current}`
  }

  const [draft, setDraft] = useState<CollectionDraft>(() => emptyDraft('new:0'))
  /** Whether the name has been typed by hand, and so is no longer the label's to set. */
  const [namedByHand, setNamedByHand] = useState(false)
  const [failure, setFailure] = useState<ApiError>()
  const [created, setCreated] = useState<CollectionWritten>()
  const [saved, setSaved] = useState<string>()
  const [removed, setRemoved] = useState<CollectionDeleted>()
  const [confirming, setConfirming] = useState(false)
  /** Whether somebody has tried to save yet. Until then, a blank is not a mistake. */
  const [attempted, setAttempted] = useState(false)

  const introspection = useIntrospection()
  const collections = useCollections()
  // Stopped the moment it is deleted: the delete invalidates this, and a refetch of a
  // definition that is gone would answer 404 and replace the sentence saying so.
  const collection = useCollection(name, mode === 'edit' && name !== '' && removed === undefined)

  const stored = collection.data?.definition
  const entries = collection.data?.entries ?? 0

  useEffect(() => {
    if (stored !== undefined) setDraft(draftOf(stored))
  }, [stored])

  const create = useMutation({
    mutationFn: () =>
      api.command<CollectionWritten>('collections.create', payloadOf(draft, stored)),
    onSuccess: async (answer) => {
      setCreated(answer)
      // The Schema Registry has just changed without a restart, which is the one thing
      // `useIntrospection` assumes never happens: the navigation, the content screens
      // and the API Explorer are all drawn from it.
      await client.invalidateQueries({ queryKey: ['introspection'] })
      await client.invalidateQueries({ queryKey: ['collections'] })
    },
    onError: (error) => setFailure(error instanceof ApiError ? error : undefined),
  })

  const update = useMutation({
    mutationFn: () =>
      api.command<CollectionWritten>('collections.update', payloadOf(draft, stored)),
    onSuccess: async (answer) => {
      setSaved(answer.note)
      await client.invalidateQueries({ queryKey: ['introspection'] })
      await client.invalidateQueries({ queryKey: ['collections'] })
    },
    onError: (error) => setFailure(error instanceof ApiError ? error : undefined),
  })

  const remove = useMutation({
    mutationFn: () => api.command<CollectionDeleted>('collections.delete', { name }),
    onSuccess: async (answer) => {
      setRemoved(answer)
      await client.invalidateQueries({ queryKey: ['introspection'] })
      await client.invalidateQueries({ queryKey: ['collections'] })
    },
    onError: (error) => setFailure(error instanceof ApiError ? error : undefined),
  })

  // Before the two below, because a deleted collection is exactly what "not found"
  // looks like from here, and the sentence saying it is gone is the answer.
  if (removed !== undefined) {
    return (
      <Page title={`“${removed.name}” is gone`}>
        <Card className="space-y-4 p-6">
          <p className="text-sm text-ink-soft">{removed.note}</p>
          <Button onClick={() => void navigate({ to: '/collections' })}>Back to collections</Button>
        </Card>
      </Page>
    )
  }

  if (mode === 'edit' && collection.isPending) {
    return (
      <Page title="Loading">
        <Spinner />
      </Page>
    )
  }

  if (mode === 'edit' && collection.isError) {
    return (
      <Page title={name}>
        <div className="space-y-4">
          <Failure error={collection.error} />
          <Button variant="secondary" onClick={() => void navigate({ to: '/collections' })}>
            Back to collections
          </Button>
        </div>
      </Page>
    )
  }

  const declaration = introspection.data?.commands?.find(
    (command) => command.name === 'collections.create',
  )
  const kinds = kindsOf(declaration)
  const resources = (introspection.data?.resources ?? []).map((resource) => ({
    name: resource.name,
    label: resource.label,
  }))

  const context = {
    stored,
    taken: collections.data?.taken ?? [],
    dropped: collection.data?.dropped ?? [],
    entries,
    namePattern: namePatternOf(declaration),
    fieldNamePattern: fieldNamePatternOf(declaration),
  }

  const issues = issuesOf(draft, context)
  // A wrong value is wrong as soon as it is typed; an empty one is not a mistake until
  // somebody says they are finished. So a blank is kept back until the first attempt,
  // and then it is shown until it is filled in.
  const shown = attempted ? issues : issues.filter((issue) => issue.blank !== true)
  const forRow = (key: string): readonly string[] =>
    shown.filter((issue) => issue.key === key).map((issue) => issue.message)
  const about = (half: 'name' | 'fields'): readonly string[] =>
    shown.filter((issue) => issue.about === half).map((issue) => issue.message)

  const drops = removals(stored, draft)
  const added = draft.fields
    .filter((field) => field.stored === undefined && field.name !== '')
    .map((field) => field.name)

  const change = (key: string, patch: FieldChange) =>
    setDraft((current) => ({ ...current, fields: patched(current.fields, key, patch) }))

  const submit = (event: FormEvent) => {
    event.preventDefault()
    setFailure(undefined)
    setSaved(undefined)
    setAttempted(true)

    if (issues.length > 0) return
    if (mode === 'create') create.mutate()
    else update.mutate()
  }

  const pending = create.isPending || update.isPending || remove.isPending

  if (created !== undefined) {
    return (
      <Page title={created.resource.label} description={`Collection “${created.name}” was created`}>
        <Card className="space-y-4 p-6">
          {/* The application's own sentence, not a restatement of it: which half of the
              API carries a collection made at runtime, and which half waits for a
              restart, is the application's to say. */}
          <p className="text-sm text-ink-soft">{created.note}</p>

          <div className="flex flex-wrap gap-2">
            <Button
              onClick={() =>
                void navigate({
                  to: '/content/$resource/new',
                  params: { resource: created.name },
                })
              }
            >
              Add the first entry
            </Button>
            <Button
              variant="secondary"
              onClick={() =>
                void navigate({ to: '/collections/$name', params: { name: created.name } })
              }
            >
              Keep editing the fields
            </Button>
            <Button variant="ghost" onClick={() => void navigate({ to: '/collections' })}>
              Back to collections
            </Button>
          </div>
        </Card>
      </Page>
    )
  }

  return (
    <Page
      title={mode === 'create' ? 'New collection' : (stored?.label ?? name)}
      description={
        mode === 'create'
          ? 'A resource stored in the database rather than written in TypeScript'
          : `${entries} ${entries === 1 ? 'entry' : 'entries'}`
      }
      actions={
        mode === 'edit' &&
        can('collections.delete') && (
          <Button variant="ghost" className="text-danger" onClick={() => setConfirming(true)}>
            Delete collection
          </Button>
        )
      }
    >
      <form className="space-y-4" onSubmit={submit}>
        {failure !== undefined && <Failure error={failure} />}

        {saved !== undefined && (
          <Card className="border-positive/30 bg-positive-soft p-4">
            <p className="text-sm text-positive">Saved. {saved}</p>
          </Card>
        )}

        {confirming && (
          <Card className="space-y-3 border-danger/30 bg-danger-soft p-4">
            <p className="text-sm font-medium text-danger">
              {entries > 0
                ? `“${name}” holds ${entries} ${entries === 1 ? 'entry' : 'entries'}, and its definition is what makes them readable.`
                : `Delete “${name}”?`}
            </p>
            <p className="text-sm text-ink-soft">
              {entries > 0
                ? 'Delete them first — a definition removed while entries exist would leave every one of them unreadable, so this is refused.'
                : 'Its definition is removed, Studio stops offering it, and an agent can no longer address it. Any entry already in the bin can no longer be restored.'}
            </p>
            <div className="flex flex-wrap gap-2">
              {entries > 0 ? (
                <Link
                  to="/content/$resource"
                  params={{ resource: name }}
                  className="inline-flex h-8 items-center rounded-lg bg-surface px-3 text-sm font-medium"
                >
                  Open the entries
                </Link>
              ) : (
                <Button
                  variant="danger"
                  size="sm"
                  disabled={pending}
                  onClick={() => remove.mutate()}
                >
                  {remove.isPending ? 'Deleting…' : 'Delete it'}
                </Button>
              )}
              <Button variant="secondary" size="sm" onClick={() => setConfirming(false)}>
                Cancel
              </Button>
            </div>
          </Card>
        )}

        <Card className="space-y-5 p-6">
          <Field
            label="Label"
            help="What this collection is called in the navigation and on its screens"
          >
            <Input
              className="max-w-md"
              placeholder="Testimonials"
              value={draft.label}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  label: event.target.value,
                  // The name follows the label until somebody takes it over, and then
                  // it is theirs: a name is what the API and an agent address, so it is
                  // never quietly rewritten under them.
                  ...(mode === 'create' && !namedByHand
                    ? { name: nameFrom(event.target.value) }
                    : {}),
                }))
              }
            />
          </Field>

          <Field
            label="Name"
            required
            help={
              mode === 'edit'
                ? 'A collection’s name is what its entries, its API and an agent address it by, so it never changes'
                : 'Lower case, letters, numbers and underscores. This is what the API and an agent call it'
            }
            {...(about('name').length === 0 ? {} : { errors: about('name') })}
          >
            <Input
              className={`max-w-md font-mono text-xs${mode === 'edit' ? ' bg-surface-sunken' : ''}`}
              placeholder="testimonials"
              readOnly={mode === 'edit'}
              value={draft.name}
              onChange={(event) => {
                setNamedByHand(true)
                setDraft((current) => ({ ...current, name: event.target.value }))
              }}
            />
          </Field>
        </Card>

        <Card className="overflow-hidden">
          <div className="flex items-center justify-between border-b border-line px-4 py-3">
            <p className="text-sm font-semibold">Fields</p>
            <p className="text-xs text-ink-faint">
              {draft.fields.length} {draft.fields.length === 1 ? 'field' : 'fields'}, in the order
              they are shown
            </p>
          </div>

          {about('fields').map((message) => (
            <p key={message} className="px-4 py-3 text-sm text-danger">
              {message}
            </p>
          ))}

          {draft.fields.map((field, index) => (
            <Row
              key={field.key}
              field={field}
              index={index}
              count={draft.fields.length}
              kinds={kinds}
              locks={locksOf(field, stored, entries)}
              fields={draft.fields}
              resources={resources}
              issues={forRow(field.key)}
              onChange={(patch) => change(field.key, patch)}
              onMove={(by) =>
                setDraft((current) => ({
                  ...current,
                  fields: moved(current.fields, field.key, by),
                }))
              }
              onRemove={() =>
                setDraft((current) => ({ ...current, fields: without(current.fields, field.key) }))
              }
            />
          ))}

          <div className="border-t border-line px-4 py-3">
            <Button
              variant="secondary"
              size="sm"
              onClick={() =>
                setDraft((current) => ({
                  ...current,
                  fields: [...current.fields, blankField(nextKey())],
                }))
              }
            >
              Add a field
            </Button>
          </div>
        </Card>

        <Consequences drops={drops} entries={entries} added={added} />

        <div className="flex items-center gap-2">
          <Button type="submit" disabled={pending || shown.length > 0}>
            {pending ? 'Saving…' : mode === 'create' ? 'Create collection' : 'Save changes'}
          </Button>
          <Button variant="secondary" onClick={() => void navigate({ to: '/collections' })}>
            Cancel
          </Button>

          {/* What is actually sent. A definition is data — declarative JSON and nothing
              executable — and showing it is the cheapest way to make that true rather
              than promised (SPEC.md §86). */}
          <details className="ml-auto text-xs text-ink-faint">
            <summary className="cursor-pointer">What this sends</summary>
            <pre className="mt-2 max-h-64 overflow-auto rounded-lg bg-surface-sunken p-3 font-mono">
              {JSON.stringify(payloadOf(draft, stored), null, 2)}
            </pre>
          </details>
        </div>
      </form>
    </Page>
  )
}
