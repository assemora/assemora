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
import type { MessageKey } from '../i18n/messages.ts'
import { useDates, useT } from '../i18n/translate.tsx'
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

const ACTOR = {
  user: 'history.actor.person',
  agent: 'history.actor.agent',
  api: 'history.actor.token',
} as const satisfies Record<string, MessageKey>

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
    <li className="flex flex-wrap items-baseline gap-1.5 text-sm">
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
  const t = useT()

  if (!isTree(from) || !isTree(to)) return null

  const change = diffTrees(from, to)

  const lines = [
    ...change.added.map((block) => t('history.tree.added', { type: block.type })),
    ...change.removed.map((block) => t('history.tree.removed', { type: block.type })),
    ...change.moved.map((block) => t('history.tree.moved', { type: block.type })),
    ...change.changed.map((block) =>
      block.fields.length > 0
        ? t('history.tree.changed', { type: block.type, fields: block.fields.join(', ') })
        : block.hidden
          ? t('history.tree.hidden', { type: block.type })
          : t('history.tree.restyled', { type: block.type }),
    ),
  ]

  if (lines.length === 0) return null

  return (
    <ul className="space-y-0.5">
      {lines.map((line) => (
        <li key={line} className="text-sm text-ink-soft">
          {line}
        </li>
      ))}
    </ul>
  )
}

/**
 * Which of the three special revisions this is, as the key that names it.
 *
 * Typed to the three keys rather than to `MessageKey`, because a message may take
 * parameters and `t` asks for them at the call site — so a variable that could be *any*
 * key is not callable. That is the machinery working: a table of keys has to declare
 * which ones it holds.
 */
const kindOf = (
  revision: Revision,
): 'history.kind.undo' | 'history.kind.redo' | 'history.kind.restore' | undefined => {
  if (typeof revision.metadata.undoOf === 'string') return 'history.kind.undo'
  if (typeof revision.metadata.redoOf === 'string') return 'history.kind.redo'
  if (typeof revision.metadata.restoredFrom === 'string') return 'history.kind.restore'

  return undefined
}

export const History = () => {
  const { id } = useParams({ from: '/shell/pages/$id/history' })
  const navigate = useNavigate()
  const client = useQueryClient()
  const page = usePage(id, 'draft')
  const t = useT()
  const dates = useDates()
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
      title={t('crumb.history')}
      description={page.data === undefined ? undefined : `${page.data.title} · /${page.data.slug}`}
      actions={
        <Button
          variant="secondary"
          onClick={() => void navigate({ to: '/pages/$id', params: { id } })}
        >
          {t('history.backToBuilder')}
        </Button>
      }
    >
      {history.isError && <Failure error={history.error} />}
      {restore.isError && <Failure error={restore.error} />}

      {compare.length === 2 && (
        <Card className="mb-4 p-4">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-base font-semibold">{t('history.comparing')}</h2>
            <Button variant="ghost" size="sm" onClick={() => setCompare([])}>
              {t('common.clear')}
            </Button>
          </div>

          {difference.isPending && <Spinner />}
          {difference.data !== undefined &&
            (Object.keys(difference.data.patch).length === 0 ? (
              <p className="text-base text-ink-soft">{t('history.noDifference')}</p>
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

        {history.data?.data.length === 0 && <Empty title={t('history.nothingYet')} />}

        <ol>
          {history.data?.data.map((revision) => {
            const kind = kindOf(revision)

            return (
              <li
                key={revision.id}
                className="flex gap-4 border-b border-hairline px-4 py-3 last:border-0"
              >
                <div className="w-28 shrink-0 space-y-0.5">
                  <p className="text-base font-medium">#{revision.sequence}</p>
                  <p className="text-sm text-ink-faint">{dates.dateTime(revision.createdAt)}</p>
                </div>

                <div className="min-w-0 flex-1 space-y-1.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <code className="font-mono text-sm text-ink-soft">{revision.command}</code>
                    <Badge>
                      {t(
                        ACTOR[revision.actorType as keyof typeof ACTOR] ?? 'history.actor.unknown',
                      )}
                    </Badge>
                    {kind !== undefined && <Badge tone="accent">{t(kind)}</Badge>}
                  </div>

                  {revision.changed.length === 0 ? (
                    <p className="text-sm text-ink-faint">{t('history.nothingChanged')}</p>
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
                    {t('history.compare')}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={restore.isPending}
                    onClick={() => {
                      if (window.confirm(t('history.confirmRestore'))) {
                        restore.mutate(revision.id)
                      }
                    }}
                  >
                    {t('history.restore')}
                  </Button>
                </div>
              </li>
            )
          })}
        </ol>
      </Card>

      {history.data !== undefined && history.data.lastPage > 1 && (
        <div className="mt-4 flex items-center justify-between text-base text-ink-soft">
          <span>
            {`${t('paging.page', {
              page: history.data.page,
              last: history.data.lastPage,
            })} · ${t('history.revisionCount', { count: history.data.total })}`}
          </span>
          <div className="flex gap-2">
            <Button
              variant="secondary"
              size="sm"
              disabled={at <= 1}
              onClick={() => setAt((current) => current - 1)}
            >
              {t('history.newer')}
            </Button>
            <Button
              variant="secondary"
              size="sm"
              disabled={at >= history.data.lastPage}
              onClick={() => setAt((current) => current + 1)}
            >
              {t('history.older')}
            </Button>
          </div>
        </div>
      )}
    </Page>
  )
}
