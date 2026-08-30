/**
 * A collection, listed (SPEC.md §115).
 *
 * Nothing here knows what an article is. The table's columns, its search box and
 * its sort options are read from the resource description, and a list is always a
 * page of one — Studio never asks for a whole dataset (SPEC.md §89).
 */
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { Link, useNavigate, useParams } from '@tanstack/react-router'
import { useState } from 'react'

import { api } from '../api/client.ts'
import {
  columnFields,
  type FieldDescriptor,
  type ResourceDescriptor,
  sortableFields,
  useIntrospection,
  valueAt,
} from '../api/introspection.ts'
import { useLocales } from '../api/locale.tsx'
import { Page } from '../app/shell.tsx'
import { NoEntries } from '../ui/blank.tsx'
import { Badge, Button, Card, Empty, Failure, Input, Select, Spinner } from '../ui/index.tsx'

type Listing = {
  readonly data: readonly Record<string, unknown>[]
  readonly total: number
  readonly page: number
  readonly perPage: number
  readonly lastPage: number
}

const Cell = ({ field, value }: { field: FieldDescriptor; value: unknown }) => {
  if (value === null || value === undefined) return <span className="text-ink-faint">—</span>

  if (field.kind === 'boolean') {
    return (
      <Badge tone={value === true ? 'positive' : 'neutral'}>{value === true ? 'Yes' : 'No'}</Badge>
    )
  }

  if (field.kind === 'select') {
    return <Badge tone="accent">{String(value)}</Badge>
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
      <span className="flex items-center gap-1.5 font-mono text-xs">
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
            : `→ ${String(link.entry?.resource ?? 'an entry')}`}
      </span>
    )
  }

  if (field.kind === 'datetime' || field.kind === 'date') {
    return <span>{new Date(String(value)).toLocaleDateString()}</span>
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

  const text = typeof value === 'object' ? JSON.stringify(value) : String(value)

  return <span className="line-clamp-1">{text}</span>
}

const Table = ({ resource, listing }: { resource: ResourceDescriptor; listing: Listing }) => {
  const columns = columnFields(resource)
  const { locale } = useLocales()

  return (
    <table className="w-full text-left text-sm">
      <thead>
        <tr className="border-b border-line text-xs uppercase tracking-wide text-ink-faint">
          {columns.map((field) => (
            <th key={field.name} className="px-4 py-2.5 font-medium">
              {field.label ?? field.name}
            </th>
          ))}
          <th className="w-0 px-4 py-2.5" />
        </tr>
      </thead>
      <tbody>
        {listing.data.map((entry) => {
          const id = String(entry[resource.primaryKey] ?? entry.id)
          /**
           * A row answered in another language than the one being edited (SPEC.md §131).
           *
           * The listing falls back, which is right — a menu with twenty of its hundred
           * dishes translated is still a menu. What would be wrong is showing those
           * eighty rows as though somebody had written them in this language, so the row
           * says which language it is actually in.
           */
          const wrote = entry.locale
          const fallback =
            typeof wrote === 'string' && locale !== undefined && wrote !== locale
              ? wrote
              : undefined

          return (
            <tr
              key={id}
              className="border-b border-line-soft last:border-0 hover:bg-surface-sunken"
            >
              {columns.map((field, at) => (
                <td key={field.name} className="max-w-[22rem] px-4 py-2.5">
                  <span className="flex items-center gap-2">
                    <Cell field={field} value={valueAt(entry, field.name)} />
                    {at === 0 && fallback !== undefined && (
                      <span
                        title={`Not translated — this is the ${fallback} original`}
                        className="shrink-0 rounded bg-surface-sunken px-1.5 py-0.5 text-[0.6875rem] font-semibold uppercase tracking-wide text-ink-faint"
                      >
                        {fallback}
                      </span>
                    )}
                  </span>
                </td>
              ))}
              <td className="px-4 py-2.5 text-right">
                <Link
                  to="/content/$resource/$id"
                  params={{ resource: resource.name, id }}
                  className="text-sm font-medium text-accent hover:underline"
                >
                  Edit
                </Link>
              </td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}

export const Collection = () => {
  const { resource: name } = useParams({ from: '/content/$resource' })
  const navigate = useNavigate()
  const introspection = useIntrospection()
  const resource = introspection.data?.resources?.find((entry) => entry.name === name)

  const [search, setSearch] = useState('')
  const [sort, setSort] = useState('')
  const [page, setPage] = useState(1)

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

  if (introspection.isLoading)
    return (
      <Page title="Loading">
        <Spinner />
      </Page>
    )

  if (resource === undefined) {
    return (
      <Page title="Not found">
        <Card>
          <Empty title={`No collection called “${name}”`}>
            The application does not describe a resource by that name.
          </Empty>
        </Card>
      </Page>
    )
  }

  const searchable = resource.fields.some((field) => field.searchable)
  // Never a collection's own fields: a dynamic resource is ordered by the entry's
  // columns and by nothing else, so an option built from `sortable` could only have
  // replaced this list with a refusal (ADR-0012).
  const sortable = sortableFields(resource)
  const singular = resource.label.replace(/s$/, '')
  const create = () => void navigate({ to: '/content/$resource/new', params: { resource: name } })
  /** Nothing here at all, as opposed to nothing matching — see `pages.tsx`. */
  const blank = listing.data !== undefined && listing.data.data.length === 0 && search === ''

  return (
    <Page
      title={resource.label}
      description={
        listing.data === undefined || blank
          ? undefined
          : `${listing.data.total} ${listing.data.total === 1 ? 'entry' : 'entries'}`
      }
      actions={!blank && resource.api.create && <Button onClick={create}>New {singular}</Button>}
    >
      {/* A search box and a sort order over nothing are two controls that can only
          return what is already on screen, and they crowd out the one sentence worth
          reading. A search that found nothing keeps them, or there would be no way to
          undo it. */}
      {!blank && (
        <div className="mb-4 flex flex-wrap items-center gap-3">
          {searchable && (
            <Input
              type="search"
              placeholder="Search…"
              className="max-w-xs"
              value={search}
              onChange={(event) => {
                setPage(1)
                setSearch(event.target.value)
              }}
            />
          )}

          {sortable.length > 0 && (
            <Select
              className="max-w-48"
              value={sort}
              onChange={(event) => {
                setPage(1)
                setSort(event.target.value)
              }}
            >
              <option value="">Default order</option>
              {sortable.flatMap((field) => [
                <option key={field.name} value={field.name}>
                  {field.label ?? field.name} ↑
                </option>,
                <option key={`-${field.name}`} value={`-${field.name}`}>
                  {field.label ?? field.name} ↓
                </option>,
              ])}
            </Select>
          )}
        </div>
      )}

      {listing.isError && <Failure error={listing.error} />}

      <Card className="overflow-hidden">
        {listing.isPending && (
          <div className="p-6">
            <Spinner />
          </div>
        )}

        {listing.data !== undefined &&
          (listing.data.data.length === 0 ? (
            blank ? (
              <NoEntries
                singular={singular}
                editable={resource.kind === 'dynamic'}
                {...(resource.api.create ? { onCreate: create } : {})}
              />
            ) : (
              <Empty title="No entry matches that">Try another word.</Empty>
            )
          ) : (
            <Table resource={resource} listing={listing.data} />
          ))}
      </Card>

      {listing.data !== undefined && listing.data.lastPage > 1 && (
        <div className="mt-4 flex items-center justify-between text-sm text-ink-soft">
          <span>
            Page {listing.data.page} of {listing.data.lastPage}
          </span>
          <div className="flex gap-2">
            <Button
              variant="secondary"
              size="sm"
              disabled={listing.data.page <= 1}
              onClick={() => setPage((current) => current - 1)}
            >
              Previous
            </Button>
            <Button
              variant="secondary"
              size="sm"
              disabled={listing.data.page >= listing.data.lastPage}
              onClick={() => setPage((current) => current + 1)}
            >
              Next
            </Button>
          </div>
        </div>
      )}
    </Page>
  )
}
