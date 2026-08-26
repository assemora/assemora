/**
 * The page list (SPEC.md §53, §115).
 */
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate } from '@tanstack/react-router'
import { type FormEvent, useState } from 'react'

import { ApiError, api } from '../api/client.ts'
import { type PageSummary, usePages } from '../api/pages.ts'
import { Page } from '../app/shell.tsx'
import { Badge, Button, Card, Empty, Failure, Field, Input, Select, Spinner } from '../ui/index.tsx'

const TONE = {
  published: 'positive',
  draft: 'neutral',
  archived: 'danger',
} as const

const NewPage = ({ onClose }: { onClose(): void }) => {
  const navigate = useNavigate()
  const client = useQueryClient()
  const [title, setTitle] = useState('')
  const [slug, setSlug] = useState('')

  const create = useMutation({
    mutationFn: () => api.command<{ id: string }>('pages.create', { title, slug }),
    onSuccess: async (created) => {
      await client.invalidateQueries({ queryKey: ['pages'] })
      await navigate({ to: '/pages/$id', params: { id: created.id } })
    },
  })

  const submit = (event: FormEvent) => {
    event.preventDefault()
    create.mutate()
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-ink/30 p-6">
      <Card className="w-full max-w-md p-6">
        <h2 className="mb-4 text-sm font-semibold">New page</h2>

        <form className="space-y-4" onSubmit={submit}>
          <Field label="Title" required>
            <Input
              required
              value={title}
              onChange={(event) => {
                setTitle(event.target.value)
                setSlug(
                  event.target.value
                    .toLowerCase()
                    .normalize('NFKD')
                    .replace(/[^a-z0-9]+/g, '-')
                    .replace(/^-+|-+$/g, ''),
                )
              }}
            />
          </Field>

          <Field label="Slug" help="Where the page lives on the site" required>
            <Input required value={slug} onChange={(event) => setSlug(event.target.value)} />
          </Field>

          {create.isError && (
            <p className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">
              {create.error instanceof ApiError ? create.error.message : 'Could not create it'}
            </p>
          )}

          <div className="flex gap-2">
            <Button type="submit" disabled={create.isPending}>
              {create.isPending ? 'Creating…' : 'Create page'}
            </Button>
            <Button variant="secondary" onClick={onClose}>
              Cancel
            </Button>
          </div>
        </form>
      </Card>
    </div>
  )
}

const Row = ({ page }: { page: PageSummary }) => (
  <tr className="border-b border-line-soft last:border-0 hover:bg-surface-sunken">
    <td className="px-4 py-2.5">
      <Link
        to="/pages/$id"
        params={{ id: page.id }}
        className="font-medium text-ink hover:text-accent"
      >
        {page.title}
      </Link>
    </td>
    <td className="px-4 py-2.5 font-mono text-xs text-ink-soft">/{page.slug}</td>
    <td className="px-4 py-2.5">
      <Badge tone={TONE[page.status]}>{page.status}</Badge>
    </td>
    <td className="px-4 py-2.5 text-sm text-ink-soft">v{page.version}</td>
    <td className="px-4 py-2.5 text-sm text-ink-soft">
      {new Date(page.updatedAt).toLocaleDateString()}
    </td>
    <td className="px-4 py-2.5 text-right">
      <Link
        to="/pages/$id"
        params={{ id: page.id }}
        className="text-sm font-medium text-accent hover:underline"
      >
        Open builder
      </Link>
    </td>
  </tr>
)

export const Pages = () => {
  const [status, setStatus] = useState('')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [creating, setCreating] = useState(false)

  const listing = usePages({
    ...(status === '' ? {} : { status }),
    ...(search === '' ? {} : { search }),
    page,
  })

  return (
    <Page
      title="Pages"
      description={listing.data === undefined ? undefined : `${listing.data.total} pages`}
      actions={<Button onClick={() => setCreating(true)}>New page</Button>}
    >
      <div className="mb-4 flex flex-wrap items-center gap-3">
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
        <Select
          className="max-w-40"
          value={status}
          onChange={(event) => {
            setPage(1)
            setStatus(event.target.value)
          }}
        >
          <option value="">Any status</option>
          <option value="draft">Draft</option>
          <option value="published">Published</option>
          <option value="archived">Archived</option>
        </Select>
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
            <Empty title="No pages yet">A page is a tree of blocks, not a document.</Empty>
          ) : (
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-line text-xs uppercase tracking-wide text-ink-faint">
                  <th className="px-4 py-2.5 font-medium">Title</th>
                  <th className="px-4 py-2.5 font-medium">Slug</th>
                  <th className="px-4 py-2.5 font-medium">Status</th>
                  <th className="px-4 py-2.5 font-medium">Version</th>
                  <th className="px-4 py-2.5 font-medium">Updated</th>
                  <th className="w-0 px-4 py-2.5" />
                </tr>
              </thead>
              <tbody>
                {listing.data.data.map((entry) => (
                  <Row key={entry.id} page={entry} />
                ))}
              </tbody>
            </table>
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
              disabled={page <= 1}
              onClick={() => setPage((current) => current - 1)}
            >
              Previous
            </Button>
            <Button
              variant="secondary"
              size="sm"
              disabled={page >= listing.data.lastPage}
              onClick={() => setPage((current) => current + 1)}
            >
              Next
            </Button>
          </div>
        </div>
      )}

      {creating && <NewPage onClose={() => setCreating(false)} />}
    </Page>
  )
}
