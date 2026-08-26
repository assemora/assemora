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
  useIntrospection,
} from '../api/introspection.ts'
import { Page } from '../app/shell.tsx'
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

          return (
            <tr
              key={id}
              className="border-b border-line-soft last:border-0 hover:bg-surface-sunken"
            >
              {columns.map((field) => (
                <td key={field.name} className="max-w-[22rem] px-4 py-2.5">
                  <Cell field={field} value={entry[field.name]} />
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

  const listing = useQuery({
    queryKey: ['collection', name, { search, sort, page }],
    queryFn: ({ signal }) => {
      const query = new URLSearchParams({ page: String(page) })

      if (search !== '') query.set('search', search)
      if (sort !== '') query.set('sort', sort)

      return api.get<Listing>(`/${name}?${query.toString()}`, signal)
    },
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
  const sortable = resource.fields.filter((field) => field.sortable)

  return (
    <Page
      title={resource.label}
      description={
        listing.data === undefined
          ? undefined
          : `${listing.data.total} ${listing.data.total === 1 ? 'entry' : 'entries'}`
      }
      actions={
        resource.api.create && (
          <Button
            onClick={() =>
              void navigate({ to: '/content/$resource/new', params: { resource: name } })
            }
          >
            New {resource.label.replace(/s$/, '')}
          </Button>
        )
      }
    >
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

      {listing.isError && <Failure error={listing.error} />}

      <Card className="overflow-hidden">
        {listing.isPending && (
          <div className="p-6">
            <Spinner />
          </div>
        )}

        {listing.data !== undefined &&
          (listing.data.data.length === 0 ? (
            <Empty title="Nothing here yet">
              {search === '' ? 'Create the first entry.' : 'No entry matches that search.'}
            </Empty>
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
