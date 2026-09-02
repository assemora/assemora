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
import { ChevronRight, Network, Plus, Rows3 } from 'lucide-react'
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
import { IconField } from '../collections/icon-field.tsx'
import { fits, PRESETS } from '../collections/kinds.tsx'
import { Preview } from '../collections/preview.tsx'
import { FieldRow, type RowSetting } from '../collections/row.tsx'
import { useT } from '../i18n/translate.tsx'
import { ResourceIcon } from '../ui/icons.tsx'
import { Button, Card, Failure, Field, Input, join, Spinner } from '../ui/index.tsx'
import { SaveBar, Screen, ScreenBody, ScreenHead, ScreenTitle } from '../ui/layout.tsx'

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
  const t = useT()

  if (drops.length === 0 && entries === 0) return null

  const quoted = (names: readonly string[]) => names.map((name) => `“${name}”`).join(', ')
  const one = drops.length === 1

  return (
    <Card className="space-y-2 border-line bg-surface-sunken p-4">
      <p className="text-base font-medium">{t('editor.savingWill')}</p>

      {drops.length > 0 && (
        <p className="text-base text-ink-soft">
          {entries > 0
            ? one
              ? t('editor.dropOneHeld', { names: quoted(drops) })
              : t('editor.dropManyHeld', { names: quoted(drops) })
            : one
              ? t('editor.dropOneEmpty', { names: quoted(drops) })
              : t('editor.dropManyEmpty', { names: quoted(drops) })}
        </p>
      )}

      {entries > 0 && (
        <p className="text-base text-ink-soft">{t('editor.leaveEntries', { count: entries })}</p>
      )}

      {entries > 0 && added.length > 0 && (
        <p className="text-base text-ink-soft">
          {t('editor.addFields', { names: quoted(added), count: entries })}
        </p>
      )}
    </Card>
  )
}

export const CollectionEditor = ({ mode }: { mode: 'create' | 'edit' }) => {
  const t = useT()
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

  const [draft, setDraft] = useState<CollectionDraft>(emptyDraft)
  /** Whether the name has been typed by hand, and so is no longer the label's to set. */
  const [namedByHand, setNamedByHand] = useState(false)
  const [failure, setFailure] = useState<ApiError>()
  const [created, setCreated] = useState<CollectionWritten>()
  const [saved, setSaved] = useState<string>()
  const [removed, setRemoved] = useState<CollectionDeleted>()
  const [confirming, setConfirming] = useState(false)
  /** Whether the payload is open. Closed by default: it is for a reader, not an editor. */
  const [showPayload, setShowPayload] = useState(false)
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
      <Page title={t('editor.gone', { name: removed.name })}>
        <Card className="space-y-4 p-6">
          <p className="text-base text-ink-soft">{removed.note}</p>
          <Button onClick={() => void navigate({ to: '/collections' })}>
            {t('editor.backToCollections')}
          </Button>
        </Card>
      </Page>
    )
  }

  if (mode === 'edit' && collection.isPending) {
    return (
      <Page title={t('common.loading')}>
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
            {t('editor.backToCollections')}
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
    t,
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

  const addField = () =>
    setDraft((current) => ({ ...current, fields: [...current.fields, blankField(nextKey())] }))

  /**
   * What this name is about to become, in the three places that will use it.
   *
   * Studio's own reading rather than the application's promise: the API prefix is the one
   * this client already addresses everywhere, and the Studio path is the base this bundle
   * was built with. The application answers with the addresses it really published, and
   * that answer is what the screen after Create shows.
   */
  const shownName = draft.name.trim() === '' ? '…' : draft.name.trim()
  const studioBase = import.meta.env.BASE_URL.replace(/\/+$/, '')

  const becomes = [
    { label: t('editor.becomes.api'), value: `/api/${shownName}` },
    { label: t('editor.becomes.studio'), value: `${studioBase}/content/${shownName}` },
    { label: t('editor.becomes.agent'), value: `entries.* · ${shownName}` },
  ]

  // Only the shapes this application can actually build: `collections.create` publishes
  // the kinds *this process* registered, and a preset holding one it did not would fill
  // the form with a row the command refuses.
  const presets = mode === 'create' ? PRESETS.filter((preset) => fits(preset, kinds)) : []

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
      <Page
        title={created.resource.label}
        description={t('editor.created', { name: created.name })}
      >
        <Card className="space-y-4 p-6">
          {/* The application's own sentence, not a restatement of it: what a collection
              made at runtime is reachable through — down to the paths, which Studio
              knows neither the prefix nor the published operations of — is the
              application's to say. */}
          <p className="text-base text-ink-soft">{created.note}</p>

          <div className="flex flex-wrap gap-2">
            <Button
              onClick={() =>
                void navigate({
                  to: '/content/$resource/new',
                  params: { resource: created.name },
                })
              }
            >
              {t('editor.addFirstEntry')}
            </Button>
            <Button
              variant="secondary"
              onClick={() =>
                void navigate({ to: '/collections/$name', params: { name: created.name } })
              }
            >
              {t('editor.keepEditing')}
            </Button>
            <Button variant="ghost" onClick={() => void navigate({ to: '/collections' })}>
              {t('editor.backToCollections')}
            </Button>
          </div>
        </Card>
      </Page>
    )
  }

  /**
   * The one sentence the footer says: what has to happen next, or that nothing does.
   *
   * The *first* unmet requirement rather than a list of them, because a list of four
   * refusals under a disabled button is a wall somebody reads once and then ignores.
   * `issues` is already ordered the way the form is, so the first is the one nearest
   * the top of the screen.
   */
  const nextStep =
    issues.length > 0
      ? (issues[0]?.message ?? t('editor.somethingMissing'))
      : mode === 'create'
        ? t('editor.ready', { count: draft.fields.length, name: draft.name })
        : t('editor.nothingToRefuse')

  return (
    <Screen>
      <ScreenHead>
        <ScreenTitle
          icon={
            draft.icon === '' ? (
              <Network className="size-5" />
            ) : (
              <ResourceIcon name={draft.icon} className="size-5" />
            )
          }
          title={mode === 'create' ? t('collections.new') : (stored?.label ?? name)}
          description={
            mode === 'create' ? t('editor.lede') : t('collection.entryCount', { count: entries })
          }
          actions={
            mode === 'edit' &&
            can('collections.delete') && (
              <Button variant="danger" onClick={() => setConfirming(true)}>
                {t('editor.deleteCollection')}
              </Button>
            )
          }
        />
      </ScreenHead>

      <ScreenBody className="pt-6 pb-8">
        {/*
         * Two columns: what is being declared, and what it becomes
         * (`design_handoff_studio_redesign` §3). They collapse to one at a narrow window
         * — `auto-fit` rather than a breakpoint, because the panel's width is decided by
         * the sidebar's state as much as by the window's.
         */}
        <form
          id="collection-form"
          className="grid max-w-[1180px] grid-cols-[repeat(auto-fit,minmax(340px,1fr))] items-start gap-6"
          onSubmit={submit}
        >
          <div className="flex min-w-0 flex-col gap-4">
            {failure !== undefined && <Failure error={failure} />}

            {saved !== undefined && (
              <Card className="border-accent/30 bg-accent-wash p-4">
                <p className="text-base text-accent-ink">
                  {t('editor.saved')} {saved}
                </p>
              </Card>
            )}

            {confirming && (
              <Card className="space-y-3 border-danger/30 bg-danger-soft p-4">
                <p className="text-base font-medium text-danger">
                  {entries > 0
                    ? t('editor.holdsEntries', { name, count: entries })
                    : t('editor.deleteNamed', { name })}
                </p>
                <p className="text-base text-ink-soft">
                  {entries > 0 ? t('editor.deleteThemFirst') : t('editor.deleteConsequence')}
                </p>
                <div className="flex flex-wrap gap-2">
                  {entries > 0 ? (
                    <Link
                      to="/content/$resource"
                      params={{ resource: name }}
                      className="inline-flex h-8 items-center rounded-lg bg-surface px-3 text-base font-medium"
                    >
                      {t('editor.openEntries')}
                    </Link>
                  ) : (
                    <Button
                      variant="danger"
                      size="sm"
                      disabled={pending}
                      onClick={() => remove.mutate()}
                    >
                      {remove.isPending ? t('editor.deleting') : t('editor.deleteIt')}
                    </Button>
                  )}
                  <Button variant="secondary" size="sm" onClick={() => setConfirming(false)}>
                    {t('common.cancel')}
                  </Button>
                </div>
              </Card>
            )}

            <Card className="p-5">
              <div className="grid grid-cols-[repeat(auto-fit,minmax(220px,1fr))] gap-4">
                <Field label={t('editor.label')} help={t('editor.labelHelp')}>
                  <Input
                    placeholder={t('editor.labelExample')}
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
                  label={t('collections.column.name')}
                  required
                  help={mode === 'edit' ? t('editor.nameFrozen') : t('editor.nameHelp')}
                  {...(about('name').length === 0 ? {} : { errors: about('name') })}
                >
                  <Input
                    className={join('font-mono text-sm', mode === 'edit' && 'bg-surface-sunken')}
                    placeholder="testimonials"
                    readOnly={mode === 'edit'}
                    value={draft.name}
                    onChange={(event) => {
                      setNamedByHand(true)
                      setDraft((current) => ({ ...current, name: event.target.value }))
                    }}
                  />
                </Field>

                {/* Offered here and nowhere else: a collection made in Studio holds its
                    icon in its own definition, and a resource declared in TypeScript
                    holds it in `resource(…, { icon })`, which no screen may rewrite. */}
                <IconField
                  value={draft.icon}
                  onChange={(icon) => setDraft((current) => ({ ...current, icon }))}
                />
              </div>

              {/*
               * The three shapes this name is about to take.
               *
               * A name is the one decision on this screen that cannot be changed
               * afterwards — the API and an agent address the collection by it — so what
               * it *becomes* is worth showing while it can still be typed over. The
               * addresses are Studio's own reading of the name and not a promise from the
               * application: `collections.create` answers with the paths it really
               * published, and that sentence is what the screen after this one shows.
               */}
              <div className="mt-4 flex flex-wrap gap-1.5 border-t border-canvas pt-3.5">
                {becomes.map((chip) => (
                  <span
                    key={chip.label}
                    className="inline-flex h-6.5 items-center gap-1.5 rounded-full border border-hairline bg-surface-sunken px-2.5 text-sm text-ink-subdued"
                  >
                    {chip.label}
                    <span className="font-mono text-xs text-ink-strong">{chip.value}</span>
                  </span>
                ))}
              </div>
            </Card>

            <Card className="overflow-hidden">
              <div className="flex items-center gap-3 border-b border-hairline px-4 py-3.5">
                <p className="text-base font-[650]">{t('collections.column.fields')}</p>
                <p className="text-sm text-ink-subdued">
                  {draft.fields.length === 0
                    ? t('editor.noFieldsYet')
                    : t('editor.fieldsInOrder', { count: draft.fields.length })}
                </p>
                <Button variant="secondary" size="sm" className="ml-auto" onClick={addField}>
                  <Plus aria-hidden className="size-4" />
                  {t('editor.addField')}
                </Button>
              </div>

              {about('fields').map((message) => (
                <p key={message} className="px-4 py-3 text-base text-danger">
                  {message}
                </p>
              ))}

              {/*
               * A shape to start from, where there is nothing yet.
               *
               * An empty definition is the one moment when "what goes in a collection?" is
               * the only question on the screen, and three answers to it are worth more
               * than an empty box and a button. Pressing one fills the form in; every row
               * is then editable exactly as if it had been typed, and nothing is stored
               * until Create.
               */}
              {draft.fields.length === 0 && (
                <div className="flex flex-col items-center gap-2 px-5 py-8 text-center">
                  <Rows3 aria-hidden className="size-[22px] text-ink-faint" />
                  <p className="text-base font-semibold">{t('editor.noFields')}</p>
                  <p className="max-w-[38ch] text-sm text-ink-subdued">
                    {t('editor.noFieldsBody')}
                  </p>
                  <div className="mt-1 flex flex-wrap justify-center gap-1.5">
                    {presets.map((preset) => (
                      <button
                        key={preset.name}
                        type="button"
                        onClick={() =>
                          setDraft((current) => ({ ...current, fields: preset.fields(nextKey) }))
                        }
                        className="inline-flex h-[30px] items-center gap-1.5 rounded-full border border-line bg-surface px-3 text-sm font-semibold hover:border-line-strong hover:bg-surface-sunken"
                      >
                        <span aria-hidden className="text-ink-soft">
                          {preset.icon}
                        </span>
                        {t(preset.label)}
                        <span className="text-xs font-normal text-ink-faint">
                          {t('editor.presetFields', { count: preset.count })}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              )}

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
            </Card>

            <Consequences drops={drops} entries={entries} added={added} />
          </div>

          <aside className="flex min-w-0 flex-col gap-3">
            <Preview draft={draft} />

            {/* What is actually sent. A definition is data — declarative JSON and nothing
              executable — and showing it is the cheapest way to make that true rather
              than promised (SPEC.md §86). */}
            <button
              type="button"
              aria-expanded={showPayload}
              onClick={() => setShowPayload((shown) => !shown)}
              className="flex h-8.5 items-center gap-1.5 rounded-[10px] border border-line bg-surface px-3 text-sm font-semibold text-ink-soft hover:border-line-strong"
            >
              <ChevronRight
                aria-hidden
                className={join(
                  'size-4 transition-transform duration-[180ms]',
                  showPayload && 'rotate-90',
                )}
              />
              {t('editor.whatThisSends')}
            </button>

            {showPayload && (
              <pre className="drop max-h-64 overflow-auto rounded-xl bg-chrome p-3.5 font-mono text-xs leading-[1.7] wrap-break-word whitespace-pre-wrap text-ink-faint">
                {JSON.stringify(payloadOf(draft, stored), null, 2)}
              </pre>
            )}
          </aside>
        </form>
      </ScreenBody>

      {/* The footer states the next required step rather than only greying the button
          out: "the button is disabled" is not a reason, and a form of this shape has
          several ways to be unfinished. */}
      <SaveBar dirty={issues.length > 0} summary={nextStep}>
        <Button variant="secondary" onClick={() => void navigate({ to: '/collections' })}>
          {t('common.cancel')}
        </Button>
        <Button type="submit" form="collection-form" busy={pending} disabled={shown.length > 0}>
          {mode === 'create' ? t('editor.createCollection') : t('entry.saveChanges')}
        </Button>
      </SaveBar>
    </Screen>
  )
}
