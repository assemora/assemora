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
import {
  fieldNamePatternOf,
  kindsOf,
  namePatternOf,
  nestingDepthOf,
} from '../collections/contract.ts'
import {
  blankField,
  type CollectionDraft,
  draftOf,
  emptyDraft,
  type FieldChange,
  issuesOf,
  moved,
  nameFrom,
  patched,
  payloadOf,
  removals,
  storedField,
  without,
} from '../collections/draft.ts'
import { FieldRow, type RowSetting } from '../collections/row.tsx'
import { Button, Card, Failure, Field, Input, Spinner } from '../ui/index.tsx'

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

  /**
   * What every row in the tree shares.
   *
   * A row addresses itself by key and knows nothing about where it sits, so adding a
   * field to a group four levels of components down is the same call the top-level list
   * makes. The depth limit is read off the command's own schema rather than agreed on
   * here: the form stops offering a group exactly where the parser starts refusing one.
   */
  const setting: RowSetting = {
    kinds,
    maxDepth: nestingDepthOf(declaration),
    entries,
    resources,
    issues: forRow,
    newKey: nextKey,
    onChange: change,
    onMove: (key, by) =>
      setDraft((current) => ({ ...current, fields: moved(current.fields, key, by) })),
    onRemove: (key) =>
      setDraft((current) => ({ ...current, fields: without(current.fields, key) })),
  }

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
          {/* The application's own sentence, not a restatement of it: what a collection
              made at runtime is reachable through — down to the paths, which Studio
              knows neither the prefix nor the published operations of — is the
              application's to say. */}
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
            <FieldRow
              key={field.key}
              field={field}
              before={storedField(stored, field)}
              index={index}
              count={draft.fields.length}
              depth={1}
              siblings={draft.fields}
              setting={setting}
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
