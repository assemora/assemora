/**
 * A collection, listed (SPEC.md §115).
 *
 * Nothing here knows what an article is. The table's columns, its search box, its sort
 * order and which of its bulk actions exist are all read from the resource description,
 * and a list is always a page of one — Studio never asks for a whole dataset
 * (SPEC.md §89).
 *
 * The shape is `design_handoff_studio_redesign` §3: a header and a toolbar that stay
 * while the rows scroll, a 16px selection checkbox with a mixed state in the header, a
 * row menu drawn against the viewport rather than inside the scroller, a selection bar
 * that drops in over the toolbar, and a footer that keeps the page count in one place.
 */
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate, useParams } from '@tanstack/react-router'
import {
  Copy,
  Ellipsis,
  Loader,
  Pencil,
  SearchX,
  SlidersHorizontal,
  Star,
  Trash2,
  TriangleAlert,
  X,
} from 'lucide-react'
import { useRef, useState } from 'react'

import { api } from '../api/client.ts'
import {
  columnFields,
  type FieldDescriptor,
  labelOf,
  sortableFields,
  useIntrospection,
  valueAt,
} from '../api/introspection.ts'
import { useLocales } from '../api/locale.tsx'
import { useDates, useT } from '../i18n/translate.tsx'
import { NoEntries } from '../ui/blank.tsx'
import { ResourceIcon } from '../ui/icons.tsx'
import {
  Badge,
  Button,
  Checkbox,
  Empty,
  Failure,
  IconButton,
  SearchField,
  Select,
  Skeleton,
  Spinner,
  StatusChip,
} from '../ui/index.tsx'
import {
  Mono,
  Screen,
  ScreenBody,
  ScreenFoot,
  ScreenHead,
  ScreenTitle,
  Table,
  Td,
  Th,
  Toolbar,
  Tr,
} from '../ui/layout.tsx'
import { Dialog, Menu, MenuItem, MenuSeparator } from '../ui/overlay.tsx'

type Listing = {
  readonly data: readonly Record<string, unknown>[]
  readonly total: number
  readonly page: number
  readonly perPage: number
  readonly lastPage: number
}

/* ------------------------------------------------------------------------------ cells */

const Cell = ({ field, value }: { field: FieldDescriptor; value: unknown }) => {
  const t = useT()
  const dates = useDates()

  if (value === null || value === undefined) return <span className="text-ink-faint">—</span>

  if (field.kind === 'boolean') {
    return value === true ? (
      <Star aria-label={t('cell.yes')} className="size-5 text-accent" fill="currentColor" />
    ) : (
      <Star aria-label={t('cell.no')} className="size-5 text-line" />
    )
  }

  if (field.kind === 'select') {
    return <StatusChip tone="accent">{String(value)}</StatusChip>
  }

  if (field.kind === 'checkboxes' && Array.isArray(value)) {
    return (
      <span className="flex flex-wrap gap-1">
        {value.map((chosen) => (
          <Badge key={String(chosen)} tone="accent">
            {String(chosen)}
          </Badge>
        ))}
      </span>
    )
  }

  if (field.kind === 'color') {
    return (
      <span className="flex items-center gap-1.5 font-mono text-sm">
        <span
          className="size-4 shrink-0 rounded border border-line"
          // The one place a stored value becomes a style. It is safe because the field
          // refuses anything that is not hex: a colour that could carry a `;` carries a
          // stylesheet (SPEC.md §62), and that is decided at the field, not here.
          style={{ background: String(value) }}
        />
        {String(value)}
      </span>
    )
  }

  // Its own words, or the address it goes to. Never the JSON: a link is the commonest
  // field in a CMS and a column of `{"type":"url",…}` is a column nobody reads.
  if (field.kind === 'link' && typeof value === 'object') {
    const link = value as { label?: unknown; url?: unknown; entry?: { resource?: unknown } }

    return (
      <span className="line-clamp-1">
        {typeof link.label === 'string' && link.label !== ''
          ? link.label
          : typeof link.url === 'string'
            ? link.url
            : `→ ${String(link.entry?.resource ?? t('cell.anEntry'))}`}
      </span>
    )
  }

  if (field.kind === 'datetime' || field.kind === 'date') {
    return <span>{dates.date(String(value))}</span>
  }

  if (field.kind === 'media') {
    return (
      <img
        src={`/api/media/by-id/${String(value)}`}
        alt=""
        className="size-8 rounded border border-line object-cover"
      />
    )
  }

  // A machine value reads as one: a slug, a url or an id in mono, at one size down.
  if (field.kind === 'slug' || field.kind === 'url' || field.kind === 'email') {
    return <Mono>{String(value)}</Mono>
  }

  const text = typeof value === 'object' ? JSON.stringify(value) : String(value)

  return <span className="line-clamp-1">{text}</span>
}

/* ------------------------------------------------------------------------------ rows */

const RowMenu = ({
  onEdit,
  onDuplicate,
  onDelete,
}: {
  onEdit(): void
  onDuplicate?(): void
  onDelete?(): void
}) => {
  const trigger = useRef<HTMLButtonElement>(null)
  const [open, setOpen] = useState(false)
  const t = useT()

  return (
    <>
      <IconButton
        ref={trigger}
        label={t('row.actions')}
        className="ml-auto opacity-60 hover:opacity-100"
        onClick={() => setOpen((showing) => !showing)}
      >
        <Ellipsis aria-hidden className="size-5" />
      </IconButton>
      {/* Against the viewport, because the table is a scroller and a menu positioned
          inside one is clipped by the very edge it needs to cross. */}
      <Menu
        open={open}
        trigger={trigger}
        onDismiss={() => setOpen(false)}
        label={t('row.entryActions')}
        width={200}
      >
        <MenuItem
          icon={<Pencil className="size-5" />}
          onClick={() => {
            setOpen(false)
            onEdit()
          }}
        >
          {t('row.edit')}
        </MenuItem>
        {onDuplicate !== undefined && (
          <MenuItem
            icon={<Copy className="size-5" />}
            onClick={() => {
              setOpen(false)
              onDuplicate()
            }}
          >
            {t('row.duplicate')}
          </MenuItem>
        )}
        {onDelete !== undefined && (
          <>
            <MenuSeparator />
            <MenuItem
              icon={<Trash2 className="size-5" />}
              tone="danger"
              onClick={() => {
                setOpen(false)
                onDelete()
              }}
            >
              {t('common.delete')}
            </MenuItem>
          </>
        )}
      </Menu>
    </>
  )
}

/** Uneven widths, so a loading table reads as content arriving and not as a pattern. */
const SKELETON = ['38%', '26%', '33%', '29%', '35%', '23%'] as const

const Loading = ({ resource }: { resource: string }) => {
  const t = useT()

  return (
    <div>
      <div className="flex h-9 items-center gap-3 border-b border-line px-4 text-sm font-[650] tracking-[0.01em] text-ink-subdued">
        <Loader aria-hidden className="size-3.5 animate-spin" />
        {t('collection.reading', { resource })}
      </div>
      {SKELETON.map((width) => (
        <div key={width} className="flex h-[49px] items-center gap-4 border-b border-hairline px-4">
          <span aria-hidden className="size-4 shrink-0 rounded bg-canvas" />
          <Skeleton width={width} />
          <span aria-hidden className="ml-auto h-6 w-[76px] shrink-0 rounded-lg bg-canvas" />
          <span aria-hidden className="h-2.5 w-11 shrink-0 rounded-md bg-canvas" />
        </div>
      ))}
    </div>
  )
}

/* ---------------------------------------------------------------------------- screen */

export const Collection = () => {
  const { resource: name } = useParams({ from: '/shell/content/$resource' })
  const navigate = useNavigate()
  const queries = useQueryClient()
  const introspection = useIntrospection()
  const { locale } = useLocales()
  const t = useT()
  const resource = introspection.data?.resources?.find((entry) => entry.name === name)

  const [search, setSearch] = useState('')
  const [sort, setSort] = useState('')
  const [page, setPage] = useState(1)
  const [selected, setSelected] = useState<readonly string[]>([])
  /** The ids a confirmation is standing in front of. `undefined` while none is asked. */
  const [confirming, setConfirming] = useState<readonly string[]>()

  /**
   * `entries.list`, not `GET /api/<resource>`.
   *
   * Both are there for either kind of resource — the generated REST route dispatches
   * this very query, and a collection gets its paths the moment it is made rather than
   * at the next restart. So the choice is not about which one exists. It is that CRUD
   * is addressed by resource *name* and not by route (ADR-0012), which is what lets one
   * screen serve every resource this application has without ever building a path or
   * knowing the API prefix it would be under (ADR-0014, SPEC.md §37).
   */
  const listing = useQuery({
    queryKey: ['collection', name, { search, sort, page }],
    queryFn: ({ signal }) =>
      api.query<Listing>('entries.list', { resource: name, page, search, sort }, signal),
    enabled: resource !== undefined,
    placeholderData: keepPreviousData,
  })

  /**
   * Deleting what is selected, one command per entry.
   *
   * `entries.delete` takes one id, so a selection of twelve is twelve commands rather
   * than a bulk endpoint this screen would have to ask for. That is the honest shape:
   * each one is validated, authorized, revised and audited on its own, and a refusal on
   * the seventh leaves the six before it deleted and says so, instead of a partial
   * "bulk delete" nobody can reconstruct.
   */
  const remove = useMutation({
    mutationFn: async (ids: readonly string[]) => {
      for (const id of ids) await api.command('entries.delete', { resource: name, id })
    },
    onSuccess: async () => {
      setSelected([])
      await queries.invalidateQueries({ queryKey: ['collection', name] })
    },
  })

  if (introspection.isLoading) {
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
        <ScreenBody>
          <Empty
            icon={<SearchX className="size-[22px]" />}
            title={t('collection.unknown', { name })}
          >
            {t('collection.unknownBody')}
          </Empty>
        </ScreenBody>
      </Screen>
    )
  }

  const columns = columnFields(resource)
  const searchable = resource.fields.some((field) => field.searchable)
  // Never a collection's own fields: a dynamic resource is ordered by the entry's
  // columns and by nothing else, so an option built from `sortable` could only have
  // replaced this list with a refusal (ADR-0012).
  const sortable = sortableFields(resource)
  const singular = resource.label.replace(/s$/, '')
  const rows = listing.data?.data ?? []
  const create = () => void navigate({ to: '/content/$resource/new', params: { resource: name } })
  const open = (id: string) =>
    void navigate({ to: '/content/$resource/$id', params: { resource: name, id } })
  const idOf = (entry: Record<string, unknown>) => String(entry[resource.primaryKey] ?? entry.id)
  /** Nothing here at all, as opposed to nothing matching — see `pages.tsx`. */
  const blank = listing.data !== undefined && rows.length === 0 && search === ''
  const chosen = rows.filter((entry) => selected.includes(idOf(entry)))
  const all = chosen.length > 0 && chosen.length === rows.length

  /**
   * What to call one row in a sentence.
   *
   * The resource's own `titleField` first, then the first column — which is what the
   * table shows in its leftmost cell, so the words in the dialog are the words on the
   * screen behind it. An id is the last resort and still better than "1 entry".
   */
  const nameOf = (entry: Record<string, unknown>): string => {
    const named = resource.titleField ?? columns[0]?.name
    const value = named === undefined ? undefined : valueAt(entry, named)

    return typeof value === 'string' && value.trim() !== '' ? value : idOf(entry)
  }

  const doomed = (confirming ?? [])
    .map((id) => rows.find((entry) => idOf(entry) === id))
    .filter((entry): entry is Record<string, unknown> => entry !== undefined)

  return (
    <Screen>
      <ScreenHead>
        <ScreenTitle
          icon={<ResourceIcon name={resource.icon} className="size-5" />}
          title={resource.label}
          count={blank ? undefined : listing.data?.total}
          actions={
            !blank &&
            resource.api.create && (
              <Button onClick={create}>{t('entries.blank.create', { name: singular })}</Button>
            )
          }
        />

        {/* A search box and a sort order over nothing are two controls that can only
            return what is already on screen, and they crowd out the one sentence worth
            reading. A search that found nothing keeps them, or there would be no way to
            undo it. */}
        {!blank &&
          (selected.length === 0 ? (
            <Toolbar>
              {searchable && (
                <SearchField
                  className="max-w-[400px] flex-1"
                  placeholder={t('collection.searchPlaceholder')}
                  aria-label={t('collection.searchLabel', { name: resource.label })}
                  value={search}
                  onChange={(event) => {
                    setPage(1)
                    setSelected([])
                    setSearch(event.target.value)
                  }}
                />
              )}

              {sortable.length > 0 && (
                <div className="relative">
                  <SlidersHorizontal
                    aria-hidden
                    className="pointer-events-none absolute top-1/2 left-3 size-5 -translate-y-1/2 text-ink-soft"
                  />
                  <Select
                    size="panel"
                    aria-label={t('collection.sortOrder')}
                    className="w-56 pl-10"
                    value={sort}
                    onChange={(event) => {
                      setPage(1)
                      setSort(event.target.value)
                    }}
                  >
                    <option value="">{t('collection.defaultOrder')}</option>
                    {sortable.flatMap((field) => [
                      <option key={field.name} value={field.name}>
                        {labelOf(field)} ↑
                      </option>,
                      <option key={`-${field.name}`} value={`-${field.name}`}>
                        {labelOf(field)} ↓
                      </option>,
                    ])}
                  </Select>
                </div>
              )}
            </Toolbar>
          ) : (
            <div className="pt-4 pb-3">
              <div className="drop flex min-h-11 flex-wrap items-center gap-2 rounded-[10px] border border-line bg-surface-raised py-1.5 pr-2 pl-3.5">
                <span className="text-base font-[650] tabular-nums whitespace-nowrap">
                  {t('collection.selected', { count: selected.length })}
                </span>
                <span aria-hidden className="mx-1 h-5 w-px bg-line" />
                {resource.api.delete && (
                  <Button
                    variant="ghost"
                    size="sm"
                    busy={remove.isPending}
                    className="text-danger hover:bg-danger-soft"
                    onClick={() => setConfirming(selected)}
                  >
                    <Trash2 aria-hidden className="size-4" />
                    {t('common.delete')}
                  </Button>
                )}
                <IconButton
                  label={t('collection.clearSelection')}
                  size={30}
                  className="ml-auto"
                  onClick={() => setSelected([])}
                >
                  <X aria-hidden className="size-[18px]" />
                </IconButton>
              </div>
            </div>
          ))}
      </ScreenHead>

      <ScreenBody>
        {listing.isError && (
          <div className="pt-2 pb-4">
            <Failure error={listing.error} />
          </div>
        )}
        {remove.isError && (
          <div className="pt-2 pb-4">
            <Failure error={remove.error} />
          </div>
        )}

        {listing.isPending && <Loading resource={resource.name} />}

        {listing.data !== undefined &&
          (rows.length === 0 ? (
            blank ? (
              <NoEntries
                singular={singular}
                editable={resource.kind === 'dynamic'}
                {...(resource.api.create ? { onCreate: create } : {})}
              />
            ) : (
              <Empty
                icon={<SearchX className="size-[22px]" />}
                title={t('collection.noMatch', { search })}
                action={
                  <Button variant="secondary" onClick={() => setSearch('')}>
                    {t('collection.clearSearch')}
                  </Button>
                }
              >
                {t('collection.searchableOnly')}
              </Empty>
            )
          ) : (
            <Table>
              <thead>
                <tr className="border-b border-line">
                  <Th width="48px" className="pr-0 pl-4">
                    <Checkbox
                      label={t('collection.selectAll')}
                      checked={all}
                      mixed={chosen.length > 0 && !all}
                      onChange={(next) => setSelected(next ? rows.map(idOf) : [])}
                    />
                  </Th>
                  {columns.map((field) => (
                    <Th key={field.name}>{labelOf(field)}</Th>
                  ))}
                  <Th width="56px" />
                </tr>
              </thead>
              <tbody>
                {rows.map((entry) => {
                  const id = idOf(entry)
                  const picked = selected.includes(id)
                  /**
                   * A row answered in another language than the one being edited
                   * (SPEC.md §131).
                   *
                   * The listing falls back, which is right — a menu with twenty of its
                   * hundred dishes translated is still a menu. What would be wrong is
                   * showing those eighty rows as though somebody had written them in
                   * this language, so the row says which language it is actually in.
                   */
                  const wrote = entry.locale
                  const fallback =
                    typeof wrote === 'string' && locale !== undefined && wrote !== locale
                      ? wrote
                      : undefined

                  return (
                    <Tr key={id} selected={picked}>
                      <Td className="relative pr-0 pl-4">
                        {picked && (
                          <span
                            aria-hidden
                            className="absolute inset-y-0 left-0 w-[3px] rounded-r-sm bg-accent"
                          />
                        )}
                        <Checkbox
                          label={t('collection.selectOne', { id })}
                          checked={picked}
                          onChange={(next) =>
                            setSelected((current) =>
                              next ? [...current, id] : current.filter((kept) => kept !== id),
                            )
                          }
                        />
                      </Td>
                      {columns.map((field, at) => (
                        <Td key={field.name} className="max-w-[26rem]">
                          {at === 0 ? (
                            <button
                              type="button"
                              onClick={() => open(id)}
                              className="flex w-full items-center gap-2.5 text-left text-base font-[550] hover:underline hover:decoration-ink-disabled hover:underline-offset-2"
                            >
                              <span className="truncate">
                                <Cell field={field} value={valueAt(entry, field.name)} />
                              </span>
                              {fallback !== undefined && (
                                <span
                                  title={t('collection.notTranslated', { locale: fallback })}
                                  className="shrink-0 rounded bg-canvas px-1.5 py-0.5 text-xs font-semibold tracking-wide text-ink-faint uppercase"
                                >
                                  {fallback}
                                </span>
                              )}
                            </button>
                          ) : (
                            <Cell field={field} value={valueAt(entry, field.name)} />
                          )}
                        </Td>
                      ))}
                      <Td className="pr-0 text-right">
                        <RowMenu
                          onEdit={() => open(id)}
                          {...(resource.api.delete ? { onDelete: () => setConfirming([id]) } : {})}
                        />
                      </Td>
                    </Tr>
                  )
                })}
              </tbody>
            </Table>
          ))}

        {listing.isError && (
          <Empty
            icon={<TriangleAlert className="size-[22px]" />}
            tone="danger"
            title={t('collection.loadFailed')}
            action={<Button onClick={() => void listing.refetch()}>{t('common.retry')}</Button>}
          >
            {t('collection.loadFailedBody')}
          </Empty>
        )}
      </ScreenBody>

      {listing.data !== undefined && rows.length > 0 && (
        <ScreenFoot>
          <span className="tabular-nums">
            {listing.data.total === 0
              ? t('collection.noEntries')
              : `${t('paging.page', {
                  page: listing.data.page,
                  last: listing.data.lastPage,
                })} · ${t('collection.entryCount', { count: listing.data.total })}`}
          </span>
          <div className="flex gap-2">
            <Button
              variant="secondary"
              disabled={listing.data.page <= 1}
              onClick={() => setPage((current) => current - 1)}
            >
              {t('paging.previous')}
            </Button>
            <Button
              variant="secondary"
              disabled={listing.data.page >= listing.data.lastPage}
              onClick={() => setPage((current) => current + 1)}
            >
              {t('paging.next')}
            </Button>
          </div>
        </ScreenFoot>
      )}
      {/*
       * Nothing is deleted without this.
       *
       * The bulk bar and the row menu both used to call the command on the click, which
       * is how a whole collection went in one press by somebody expecting to be asked.
       * `entries.delete` is one command per row and each writes a revision, so the loss
       * is recoverable — but "recoverable" is not a substitute for being asked, and the
       * dialog says which rows so the answer is to a question about real names.
       */}
      <Dialog
        open={confirming !== undefined}
        title={
          doomed.length === 1
            ? t('entries.delete.one', { name: nameOf(doomed[0] as Record<string, unknown>) })
            : t('entries.delete.many', { count: doomed.length })
        }
        onClose={() => setConfirming(undefined)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirming(undefined)}>
              {t('common.cancel')}
            </Button>
            <Button
              variant="destructive"
              busy={remove.isPending}
              onClick={() => {
                const ids = confirming ?? []

                setConfirming(undefined)
                remove.mutate(ids)
              }}
            >
              {doomed.length === 1
                ? t('common.delete')
                : t('entries.delete.count', { count: doomed.length })}
            </Button>
          </>
        }
      >
        <p>
          {doomed.length === 1
            ? t('entries.delete.bodyOne', { name: resource.label })
            : t('entries.delete.bodyMany', { name: resource.label })}
        </p>

        {/* Named while there are few enough to read. Past that a count is the honest
            summary — a list of forty is a wall somebody scrolls past. */}
        {doomed.length > 1 && doomed.length <= 8 && (
          <ul className="mt-3 list-disc space-y-1 pl-5 text-ink">
            {doomed.map((entry) => (
              <li key={idOf(entry)} className="truncate">
                {nameOf(entry)}
              </li>
            ))}
          </ul>
        )}
      </Dialog>
    </Screen>
  )
}
