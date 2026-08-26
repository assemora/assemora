/**
 * Revision history (SPEC.md §64, §65).
 *
 * Every content mutation left a revision, whoever made it — a person in Studio, a
 * REST call, an agent through MCP. This is that log, and restoring from it is itself
 * a command, so undoing is never a way around the pipeline.
 */
import { type BlockTree, diffTrees } from '@assemora/schema'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate, useParams } from '@tanstack/react-router'
import { useState } from 'react'

import { api } from '../api/client.ts'
import type { Paged } from '../api/pages.ts'
import { usePage } from '../api/pages.ts'
import { Page } from '../app/shell.tsx'
import { Badge, Button, Card, Empty, Failure, Spinner } from '../ui/index.tsx'

type Revision = {
  readonly id: string
  readonly sequence: number
  readonly actorType: string | null
  readonly actorId: string | null
  readonly command: string
  readonly changed: readonly string[]
  readonly patch: Readonly<Record<string, { from: unknown; to: unknown }>>
  readonly metadata: Readonly<Record<string, unknown>>
  readonly createdAt: string
}

const ACTOR = { user: 'Person', agent: 'Agent', api: 'API token' } as const

/** Bookkeeping every write touches. True, and not what anybody came to read. */
const NOISE = new Set(['version', 'updatedAt', 'updatedBy'])

/** `spacing: xl → md` — what a person can act on, rather than the whole document. */
const Change = ({ field, from, to }: { field: string; from: unknown; to: unknown }) => {
  const shorten = (value: unknown): string => {
    if (value === null || value === undefined) return '—'

    const text = typeof value === 'object' ? JSON.stringify(value) : String(value)

    return text.length > 60 ? `${text.slice(0, 57)}…` : text
  }

  return (
    <li className="flex flex-wrap items-baseline gap-1.5 text-xs">
      <span className="font-medium text-ink">{field}</span>
      <span className="text-ink-faint line-through">{shorten(from)}</span>
      <span className="text-ink-faint">→</span>
      <span className="text-ink-soft">{shorten(to)}</span>
    </li>
  )
}

const isTree = (value: unknown): value is BlockTree =>
  typeof value === 'object' && value !== null && Array.isArray((value as BlockTree).blocks)

/**
 * What a tree change actually was.
 *
 * A field-level patch says `draftTree` changed and hands over two complete trees.
 * The tree knows better, and it is the tree that is asked (SPEC.md §65).
 */
const TreeChange = ({ from, to }: { from: unknown; to: unknown }) => {
  if (!isTree(from) || !isTree(to)) return null

  const change = diffTrees(from, to)

  const lines = [
    ...change.added.map((block) => `Added a ${block.type}`),
    ...change.removed.map((block) => `Removed a ${block.type}`),
    ...change.moved.map((block) => `Moved the ${block.type}`),
    ...change.changed.map((block) =>
      block.fields.length > 0
        ? `Changed the ${block.type}: ${block.fields.join(', ')}`
        : block.hidden
          ? `Hid or showed the ${block.type}`
          : `Restyled the ${block.type}`,
    ),
  ]

  if (lines.length === 0) return null

  return (
    <ul className="space-y-0.5">
      {lines.map((line) => (
        <li key={line} className="text-xs text-ink-soft">
          {line}
        </li>
      ))}
    </ul>
  )
}

const kindOf = (revision: Revision): string | undefined => {
  if (typeof revision.metadata.undoOf === 'string') return 'undo'
  if (typeof revision.metadata.redoOf === 'string') return 'redo'
  if (typeof revision.metadata.restoredFrom === 'string') return 'restore'

  return undefined
}

export const History = () => {
  const { id } = useParams({ from: '/pages/$id/history' })
  const navigate = useNavigate()
  const client = useQueryClient()
  const page = usePage(id, 'draft')
  const [compare, setCompare] = useState<string[]>([])
  const [at, setAt] = useState(1)

  const history = useQuery({
    queryKey: ['revisions', 'pages', id, at],
    queryFn: ({ signal }) =>
      api.query<Paged<Revision>>(
        'revisions.list',
        { entityType: 'pages', entityId: id, page: at },
        signal,
      ),
  })

  const difference = useQuery({
    queryKey: ['revisions', 'compare', compare],
    queryFn: ({ signal }) =>
      api.query<{ patch: Record<string, { from: unknown; to: unknown }> }>(
        'revisions.compare',
        { from: compare[0], to: compare[1] },
        signal,
      ),
    enabled: compare.length === 2,
  })

  const restore = useMutation({
    mutationFn: (revisionId: string) => api.command('revisions.restore', { id: revisionId }),
    onSuccess: async () => {
      await client.invalidateQueries()
    },
  })

  const toggle = (revisionId: string) =>
    setCompare((current) =>
      current.includes(revisionId)
        ? current.filter((entry) => entry !== revisionId)
        : [...current, revisionId].slice(-2),
    )

  return (
    <Page
      title="History"
      description={page.data === undefined ? undefined : `${page.data.title} · /${page.data.slug}`}
      actions={
        <Button
          variant="secondary"
          onClick={() => void navigate({ to: '/pages/$id', params: { id } })}
        >
          Back to builder
        </Button>
      }
    >
      {history.isError && <Failure error={history.error} />}
      {restore.isError && <Failure error={restore.error} />}

      {compare.length === 2 && (
        <Card className="mb-4 p-4">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-sm font-semibold">Comparing two revisions</h2>
            <Button variant="ghost" size="sm" onClick={() => setCompare([])}>
              Clear
            </Button>
          </div>

          {difference.isPending && <Spinner />}
          {difference.data !== undefined &&
            (Object.keys(difference.data.patch).length === 0 ? (
              <p className="text-sm text-ink-soft">Nothing differs between them.</p>
            ) : (
              <ul className="space-y-1">
                {Object.entries(difference.data.patch).map(([field, change]) => (
                  <Change key={field} field={field} from={change.from} to={change.to} />
                ))}
              </ul>
            ))}
        </Card>
      )}

      <Card className="overflow-hidden">
        {history.isPending && (
          <div className="p-6">
            <Spinner />
          </div>
        )}

        {history.data?.data.length === 0 && <Empty title="Nothing has happened yet" />}

        <ol>
          {history.data?.data.map((revision) => {
            const kind = kindOf(revision)

            return (
              <li
                key={revision.id}
                className="flex gap-4 border-b border-line-soft px-4 py-3 last:border-0"
              >
                <div className="w-28 shrink-0 space-y-0.5">
                  <p className="text-sm font-medium">#{revision.sequence}</p>
                  <p className="text-xs text-ink-faint">
                    {new Date(revision.createdAt).toLocaleString()}
                  </p>
                </div>

                <div className="min-w-0 flex-1 space-y-1.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <code className="font-mono text-xs text-ink-soft">{revision.command}</code>
                    <Badge>{ACTOR[revision.actorType as keyof typeof ACTOR] ?? 'Unknown'}</Badge>
                    {kind !== undefined && <Badge tone="accent">{kind}</Badge>}
                  </div>

                  {revision.changed.length === 0 ? (
                    <p className="text-xs text-ink-faint">Nothing changed.</p>
                  ) : (
                    <>
                      {Object.entries(revision.patch)
                        .filter(([field]) => field === 'draftTree' || field === 'publishedTree')
                        .map(([field, change]) => (
                          <TreeChange key={field} from={change.from} to={change.to} />
                        ))}

                      <ul className="space-y-0.5">
                        {Object.entries(revision.patch)
                          .filter(
                            ([field]) =>
                              !NOISE.has(field) &&
                              field !== 'draftTree' &&
                              field !== 'publishedTree',
                          )
                          .map(([field, change]) => (
                            <Change key={field} field={field} from={change.from} to={change.to} />
                          ))}
                      </ul>
                    </>
                  )}
                </div>

                <div className="flex shrink-0 items-start gap-2">
                  <Button
                    variant={compare.includes(revision.id) ? 'primary' : 'secondary'}
                    size="sm"
                    onClick={() => toggle(revision.id)}
                  >
                    Compare
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={restore.isPending}
                    onClick={() => {
                      if (window.confirm('Put the page back the way it was at this revision?')) {
                        restore.mutate(revision.id)
                      }
                    }}
                  >
                    Restore
                  </Button>
                </div>
              </li>
            )
          })}
        </ol>
      </Card>

      {history.data !== undefined && history.data.lastPage > 1 && (
        <div className="mt-4 flex items-center justify-between text-sm text-ink-soft">
          <span>
            Page {history.data.page} of {history.data.lastPage} · {history.data.total} revisions
          </span>
          <div className="flex gap-2">
            <Button
              variant="secondary"
              size="sm"
              disabled={at <= 1}
              onClick={() => setAt((current) => current - 1)}
            >
              Newer
            </Button>
            <Button
              variant="secondary"
              size="sm"
              disabled={at >= history.data.lastPage}
              onClick={() => setAt((current) => current + 1)}
            >
              Older
            </Button>
          </div>
        </div>
      )}
    </Page>
  )
}
