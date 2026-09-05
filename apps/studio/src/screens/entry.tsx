/**
 * Creating and editing one entry (SPEC.md §115).
 *
 * The form is the resource's field list. Saving sends the whole change to the generated
 * CRUD endpoint, which is `entries.create` and `entries.update` on the Command Bus — the
 * same handlers an agent reaches (SPEC.md §14, §43).
 *
 * `design_handoff_studio_redesign` §3: a header that stays, the fields in one measured
 * column that scrolls, and a save bar pinned to the bottom that reacts to changes rather
 * than sitting there inert. The bar is the whole form's — settings are one form, not
 * forty autosaves, and an entry is the same thing one row along.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate, useParams } from '@tanstack/react-router'
import { Ellipsis, History as HistoryIcon, LayoutPanelLeft, Trash2 } from 'lucide-react'
import { type FormEvent, useEffect, useRef, useState } from 'react'

import { ApiError, api, hasMoreToSay } from '../api/client.ts'
import {
  declaredValues,
  editableFields,
  labelOf,
  useIntrospection,
  valueAt,
} from '../api/introspection.ts'
import { useSession } from '../api/session.tsx'
import { useDates, useT } from '../i18n/translate.tsx'
import { EntryFields } from '../layout/form.tsx'
import { arrange } from '../layout/resolve.ts'
import { Button, Failure, IconButton, Spinner } from '../ui/index.tsx'
import { SaveBar, Screen, ScreenBody, ScreenHead, ScreenTitle } from '../ui/layout.tsx'
import { ConfirmByTyping, Menu, MenuItem } from '../ui/overlay.tsx'
import { Translations } from './translations.tsx'

type Entry = Record<string, unknown>

/**
 * What to call the row on screen.
 *
 * The resource's own `titleField` first, then the first declared field holding text.
 * A fallback to the id is deliberate rather than a blank heading: a row with nothing
 * typed into it yet still has to be identifiable while it is being typed into.
 */
const nameOf = (
  fields: readonly { name: string; kind: string }[],
  titleField: string | undefined,
  draft: Entry,
): string | undefined => {
  const named = titleField ?? fields.find((field) => field.kind === 'text')?.name
  if (named === undefined) return undefined

  const value = valueAt(draft, named)

  return typeof value === 'string' && value.trim() !== '' ? value : undefined
}

export const EntryForm = ({ mode }: { mode: 'create' | 'edit' }) => {
  const params = useParams({ strict: false }) as { resource: string; id?: string }
  const navigate = useNavigate()
  const client = useQueryClient()
  const more = useRef<HTMLButtonElement>(null)

  const introspection = useIntrospection()
  const { can } = useSession()
  const t = useT()
  const dates = useDates()
  const resource = introspection.data?.resources?.find((entry) => entry.name === params.resource)

  /**
   * The bus by name, not the generated REST path.
   *
   * `GET /api/<resource>/:id` dispatches this very query, so the two are one handler —
   * but the routes are mounted before the server listens, and a collection made in
   * Studio is registered after that. Addressing the resource by name is what makes this
   * form work for a resource the application grew as well as one it declared
   * (ADR-0012, ADR-0014, SPEC.md §37).
   */
  const existing = useQuery({
    queryKey: ['entry', params.resource, params.id],
    queryFn: ({ signal }) =>
      api.query<Entry | null>('entries.get', { resource: params.resource, id: params.id }, signal),
    enabled: mode === 'edit' && params.id !== undefined,
  })

  const [draft, setDraft] = useState<Entry>({})
  const [saved, setSaved] = useState<Entry>({})
  const [failure, setFailure] = useState<ApiError>()
  const [menuOpen, setMenuOpen] = useState(false)
  const [confirming, setConfirming] = useState(false)

  useEffect(() => {
    // `entries.get` answers `null` for an id nothing matches, where the REST route
    // answered 404: an absent entry is not an empty one to put in the form.
    if (existing.data !== undefined && existing.data !== null) {
      setDraft(existing.data)
      setSaved(existing.data)
    }
  }, [existing.data])

  const save = useMutation({
    mutationFn: (values: Entry) =>
      mode === 'create'
        ? api.command('entries.create', { resource: params.resource, data: values })
        : api.command('entries.update', {
            resource: params.resource,
            id: params.id,
            data: values,
          }),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ['collection', params.resource] })
      await navigate({ to: '/content/$resource', params: { resource: params.resource } })
    },
    onError: (error) => setFailure(error instanceof ApiError ? error : undefined),
  })

  const remove = useMutation({
    mutationFn: () => api.command('entries.delete', { resource: params.resource, id: params.id }),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ['collection', params.resource] })
      await navigate({ to: '/content/$resource', params: { resource: params.resource } })
    },
  })

  if (introspection.isLoading || (mode === 'edit' && existing.isPending)) {
    return (
      <Screen>
        <ScreenBody className="grid place-items-center">
          <Spinner />
        </ScreenBody>
      </Screen>
    )
  }

  if (resource === undefined) {
    return (
      <Screen>
        <ScreenHead>
          <ScreenTitle
            title={t('entry.notFound')}
            description={t('entry.noResource', { name: params.resource })}
          />
        </ScreenHead>
        <ScreenBody>{null}</ScreenBody>
      </Screen>
    )
  }

  if (mode === 'edit' && existing.data === null) {
    return (
      <Screen>
        <ScreenHead>
          <ScreenTitle
            title={t('entry.notFound')}
            description={t('entry.noSuchId', { name: resource.label })}
          />
        </ScreenHead>
        <ScreenBody>{null}</ScreenBody>
      </Screen>
    )
  }

  const fields = editableFields(resource)
  /**
   * The keys the answer named that this form has an input for.
   *
   * Not the field names: a refusal about a value *inside* one names the whole path —
   * `sections.2.heading` — and the input that draws it is the repeater called
   * `sections`, which hands the rest down to the item that owns it. So a path under a
   * rendered field counts as rendered.
   *
   * Everything else — an issue about the record as a whole, one naming a read-only or
   * hidden field, one naming a key the resource does not declare — has no input to land
   * on and belongs in the box. It used to be hidden the moment `fields` held anything at
   * all, so those were shown nowhere (SPEC.md §84).
   */
  const rendered = Object.keys(failure?.fields ?? {}).filter((key) =>
    fields.some((field) => key === field.name || key.startsWith(`${field.name}.`)),
  )

  /** What the answer said about one field, addressed from that field. */
  const issuesFor = (name: string): Readonly<Record<string, readonly string[]>> | undefined => {
    const under: Record<string, readonly string[]> = {}

    for (const [key, messages] of Object.entries(failure?.fields ?? {})) {
      if (key === name) under[''] = messages
      else if (key.startsWith(`${name}.`)) under[key.slice(name.length + 1)] = messages
    }

    return Object.keys(under).length === 0 ? undefined : under
  }

  const submit = (event: FormEvent) => {
    event.preventDefault()
    setFailure(undefined)

    // Only what the resource declares is sent: an id or a timestamp the read
    // returned is not the form's to write back.
    save.mutate(declaredValues(fields, draft))
  }

  const singular = resource.label.replace(/s$/, '')
  const title = nameOf(fields, resource.titleField, draft)
  const canArrange = can('resources.arrange')
  /**
   * How the fields are arranged: the registry's layout for this resource when somebody
   * declared or arranged one, and the two columns derived from the kinds otherwise
   * (ADR-0033). Either way every editable field is drawn.
   */
  const arranged = arrange(
    fields,
    introspection.data?.layouts?.find((entry) => entry.name === params.resource)?.layout,
  )

  const translations =
    mode === 'edit' && params.id !== undefined ? (
      <Translations resource={params.resource} id={params.id} entryLocale={existing.data?.locale} />
    ) : null

  /**
   * Which fields have been typed into since the last read.
   *
   * The names rather than a boolean, because the save bar states them: "3 unsaved
   * changes" and then the keys, so a person who stepped away knows what they would be
   * saving without re-reading the whole form. Compared as JSON — the values are
   * whatever a field kind stores, and a deep equality of our own would be one more
   * thing to keep in step with the field registry.
   */
  const changed =
    mode === 'create'
      ? fields
          .filter((field) => valueAt(draft, field.name) !== undefined)
          .map((field) => field.name)
      : fields
          .filter(
            (field) =>
              JSON.stringify(valueAt(draft, field.name) ?? null) !==
              JSON.stringify(valueAt(saved, field.name) ?? null),
          )
          .map((field) => field.name)

  const dirty = changed.length > 0

  /**
   * Which fields differ, as a sentence rather than a list of keys.
   *
   * "Title, Excerpt and Featured differ from the saved entry" is what the design says,
   * and it is what somebody who stepped away needs: the labels they typed into, not the
   * column names underneath them. Past three it becomes a count — a bar is one line, and
   * eleven names in it is a list nobody reads.
   */
  const names = changed.map((name) => {
    const field = fields.find((declared) => declared.name === name)

    return field === undefined ? name : labelOf(field)
  })

  /**
   * The verb agrees with the list rather than with a number, which is why this is four
   * keys and not one with a `{count}` in it: `Title differs` and `Title and Excerpt
   * differ` are two sentences in English, and the same two in Ukrainian and Russian.
   */
  const listed =
    names.length === 1
      ? (names[0] ?? '')
      : `${names.slice(0, -1).join(', ')} ${t('entry.and')} ${names[names.length - 1]}`

  const differ =
    names.length === 0
      ? undefined
      : names.length > 3
        ? mode === 'create'
          ? t('entry.differ.countEmpty', { count: names.length })
          : t('entry.differ.countSaved', { count: names.length })
        : names.length === 1
          ? mode === 'create'
            ? t('entry.differ.oneEmpty', { name: listed })
            : t('entry.differ.oneSaved', { name: listed })
          : mode === 'create'
            ? t('entry.differ.manyEmpty', { names: listed })
            : t('entry.differ.manySaved', { names: listed })

  return (
    <Screen>
      <ScreenHead divided>
        <ScreenTitle
          icon={
            <span
              aria-hidden
              className={
                dirty
                  ? 'block size-2 rounded-full bg-warning'
                  : 'block size-2 rounded-full bg-accent'
              }
            />
          }
          title={
            title ??
            (mode === 'create'
              ? t('entry.new', { name: singular })
              : t('entry.edit', { name: singular }))
          }
          actions={
            (canArrange || (mode === 'edit' && resource.api.delete)) && (
              <>
                <IconButton
                  ref={more}
                  label={t('entry.moreActions')}
                  size={36}
                  onClick={() => setMenuOpen((open) => !open)}
                >
                  <Ellipsis aria-hidden className="size-5" />
                </IconButton>
                <Menu
                  open={menuOpen}
                  trigger={more}
                  onDismiss={() => setMenuOpen(false)}
                  label={t('row.entryActions')}
                >
                  {/* How this form is arranged is a fact about the resource, not the row,
                      so the way to it is the same on a new entry and an old one
                      (ADR-0033). */}
                  {canArrange && (
                    <MenuItem
                      icon={<LayoutPanelLeft className="size-5" />}
                      onClick={() => {
                        setMenuOpen(false)
                        void navigate({
                          to: '/content/$resource/form',
                          params: { resource: params.resource },
                        })
                      }}
                    >
                      {t('form.arrange')}
                    </MenuItem>
                  )}
                  {mode === 'edit' && resource.api.delete && (
                    <MenuItem
                      icon={<Trash2 className="size-5" />}
                      tone="danger"
                      onClick={() => {
                        setMenuOpen(false)
                        setConfirming(true)
                      }}
                    >
                      {t('entry.deleteThis', { name: singular.toLowerCase() })}
                    </MenuItem>
                  )}
                </Menu>
              </>
            )
          }
        />
      </ScreenHead>

      <ScreenBody className="pt-6 pb-8">
        {/*
         * Two columns: what the entry is, and what is true of it
         * (`design_handoff_studio_redesign` §3). Which field goes where is derived from
         * its kind in `asideFields` — the descriptor has nowhere to say it, and the rule
         * is written down once rather than guessed at here.
         *
         * `flex-wrap` with a basis rather than a grid: at a narrow window the panel drops
         * under the card instead of squeezing a rich-text editor into 300px.
         */}
        <form id="entry-form" className="flex flex-col gap-6" onSubmit={submit}>
          {/* Above the fields and not beside the Save button: which language this row
              is in decides what saving *means*, so it has to be read before the fields
              are. */}
          {(translations !== null || failure !== undefined || remove.isError) && (
            <div className="w-full space-y-4">
              {translations}
              {failure !== undefined && hasMoreToSay(failure, rendered) && (
                <Failure error={failure} except={rendered} />
              )}
              {remove.isError && <Failure error={remove.error} />}
            </div>
          )}

          <EntryFields
            arranged={arranged}
            draft={draft}
            issuesFor={issuesFor}
            onChange={(name, value) => setDraft((current) => ({ ...current, [name]: value }))}
            {...(typeof existing.data?.updatedAt === 'string'
              ? {
                  /* When the row was last written, where the design puts "Saved 12
                     minutes ago by Dana". Only the time, and only when the read returned
                     it: who saved it is in the revision history, and this screen has not
                     asked. */
                  asideFooter: (
                    <div className="flex min-h-11 items-center gap-2 rounded-xl bg-surface px-4 py-3 text-base text-ink-soft shadow-[0_1px_0_rgb(0_0_0/0.05)]">
                      <HistoryIcon aria-hidden className="size-5 shrink-0" />
                      {t('entry.savedAt', { when: dates.dateTime(existing.data.updatedAt) })}
                    </div>
                  ),
                }
              : {})}
          />
        </form>
      </ScreenBody>

      <SaveBar
        dirty={dirty}
        summary={
          dirty
            ? t('entry.unsaved')
            : mode === 'create'
              ? t('entry.nothingYet')
              : t('entry.noChanges')
        }
        {...(dirty ? { detail: differ } : {})}
      >
        <Button
          variant="secondary"
          disabled={!dirty}
          onClick={() => {
            setFailure(undefined)
            setDraft(mode === 'create' ? {} : saved)
          }}
        >
          {t('entry.discard')}
        </Button>
        <Button type="submit" form="entry-form" busy={save.isPending} disabled={!dirty}>
          {mode === 'create'
            ? t('entries.blank.create', { name: singular })
            : t('entry.saveChanges')}
        </Button>
      </SaveBar>

      <ConfirmByTyping
        open={confirming}
        title={t('entry.deleteTitle', { name: singular.toLowerCase() })}
        word={title ?? String(params.id ?? '')}
        action={t('common.delete')}
        onClose={() => setConfirming(false)}
        onConfirm={() => {
          setConfirming(false)
          remove.mutate()
        }}
      >
        {t('entries.delete.bodyOne', { name: resource.label })}
      </ConfirmByTyping>
    </Screen>
  )
}
