/**
 * What an agent proposed, and whether it happens (SPEC.md §75).
 *
 * The screen §75 draws: a count, one line per change, Apply and Reject. Nothing
 * here knows what a block or a resource is — the lines come from the stored diff,
 * and the two buttons are `changesets.apply` and `changesets.reject`.
 *
 * Production state does not change until somebody presses Apply, and when they do,
 * the commands run in *their* name, under their permissions.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'

import { api } from '../api/client.ts'
import type { Paged } from '../api/pages.ts'
import { Page } from '../app/shell.tsx'
import { Badge, Button, Card, Empty, Failure, Spinner } from '../ui/index.tsx'

type Change = {
  readonly entityType: string
  readonly entityId: string
  readonly summary: string
}

type ChangeSetRow = {
  readonly id: string
  readonly title: string
  readonly status: 'pending' | 'applied' | 'rejected' | 'expired' | 'conflicted'
  readonly actorType: string | null
  readonly actorId: string | null
  readonly changes: number
  readonly expiresAt: string
  readonly createdAt: string
}

type ChangeSetDetail = Omit<ChangeSetRow, 'changes'> & {
  readonly changes: readonly Change[]
  readonly commands: readonly { command: string }[]
}

const TONE = {
  pending: 'accent',
  applied: 'positive',
  rejected: 'neutral',
  expired: 'neutral',
  conflicted: 'danger',
} as const

const ACTOR = { agent: 'Agent', user: 'Person', api: 'API token' } as const

const Review = ({ id, onClose }: { id: string; onClose(): void }) => {
  const client = useQueryClient()
  const [outcome, setOutcome] = useState<string>()

  const proposal = useQuery({
    queryKey: ['changeset', id],
    queryFn: ({ signal }) => api.query<ChangeSetDetail>('changesets.get', { id }, signal),
  })

  const decide = useMutation({
    mutationFn: (command: 'apply' | 'reject') =>
      api.command<{ status: string }>(`changesets.${command}`, { id }),
    onSuccess: async (result) => {
      setOutcome(result.status)
      await client.invalidateQueries()
    },
  })

  const open = proposal.data?.status === 'pending' && outcome === undefined

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-ink/30 p-6">
      <Card className="flex max-h-[80dvh] w-full max-w-lg flex-col">
        <header className="border-b border-line px-5 py-4">
          <h2 className="text-sm font-semibold">{proposal.data?.title}</h2>
          <p className="mt-0.5 text-xs text-ink-faint">
            {proposal.data === undefined
              ? null
              : `${proposal.data.changes.length} ${
                  proposal.data.changes.length === 1 ? 'change' : 'changes'
                } · proposed by ${
                  ACTOR[proposal.data.actorType as keyof typeof ACTOR] ?? 'somebody'
                }`}
          </p>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {proposal.isPending && <Spinner />}
          {proposal.isError && <Failure error={proposal.error} />}
          {decide.isError && <Failure error={decide.error} />}

          {outcome === 'conflicted' && (
            <Card className="mb-3 border-danger/30 bg-danger-soft p-3">
              <p className="text-sm text-danger">
                Somebody changed one of these since it was proposed, so nothing was applied. Ask for
                it again against what the page says now.
              </p>
            </Card>
          )}

          {outcome === 'expired' && (
            <Card className="mb-3 bg-surface-sunken p-3">
              <p className="text-sm text-ink-soft">This proposal expired before anybody decided.</p>
            </Card>
          )}

          <ol className="space-y-3">
            {proposal.data?.changes.map((change, index) => (
              // The diff is stored, ordered and immutable: it is never reordered or
              // filtered, and two changes to one entity are legitimately identical
              // lines — so the position is the only stable identity there is.
              // biome-ignore lint/suspicious/noArrayIndexKey: a stored diff never reorders
              <li key={index} className="space-y-0.5">
                <p className="text-sm font-medium capitalize">{change.entityType}</p>
                <p className="font-mono text-xs text-ink-soft">{change.summary}</p>
              </li>
            ))}
          </ol>
        </div>

        <footer className="flex items-center gap-2 border-t border-line px-5 py-3">
          {open ? (
            <>
              <Button disabled={decide.isPending} onClick={() => decide.mutate('apply')}>
                {decide.isPending ? 'Applying…' : 'Apply'}
              </Button>
              <Button
                variant="secondary"
                disabled={decide.isPending}
                onClick={() => decide.mutate('reject')}
              >
                Reject
              </Button>
            </>
          ) : (
            <Badge tone={TONE[(outcome ?? proposal.data?.status ?? 'pending') as 'pending']}>
              {outcome ?? proposal.data?.status}
            </Badge>
          )}

          <Button variant="ghost" className="ml-auto" onClick={onClose}>
            Close
          </Button>
        </footer>
      </Card>
    </div>
  )
}

export const ChangeSets = () => {
  const [status, setStatus] = useState('pending')
  const [reviewing, setReviewing] = useState<string>()

  const listing = useQuery({
    queryKey: ['changesets', status],
    queryFn: ({ signal }) =>
      api.query<Paged<ChangeSetRow>>('changesets.list', status === '' ? {} : { status }, signal),
  })

  return (
    <Page
      title="Proposals"
      description="What agents have asked for. Nothing changes until you apply it"
    >
      <div className="mb-4 flex gap-1">
        {['pending', 'applied', 'rejected', ''].map((option) => (
          <button
            key={option || 'all'}
            type="button"
            className={[
              'rounded-lg px-3 py-1.5 text-sm font-medium capitalize transition',
              status === option
                ? 'bg-accent-soft text-accent'
                : 'text-ink-soft hover:bg-surface-sunken',
            ].join(' ')}
            onClick={() => setStatus(option)}
          >
            {option || 'all'}
          </button>
        ))}
      </div>

      {listing.isError && <Failure error={listing.error} />}

      <Card className="overflow-hidden">
        {listing.isPending && (
          <div className="p-6">
            <Spinner />
          </div>
        )}

        {listing.data?.data.length === 0 && (
          <Empty title="Nothing proposed">
            An agent connected over MCP proposes changes here, and they wait for you.
          </Empty>
        )}

        {listing.data?.data.map((proposal) => (
          <button
            key={proposal.id}
            type="button"
            className="flex w-full items-center gap-3 border-b border-line-soft px-4 py-3 text-left last:border-0 hover:bg-surface-sunken"
            onClick={() => setReviewing(proposal.id)}
          >
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{proposal.title}</p>
              <p className="text-xs text-ink-faint">
                {proposal.changes} {proposal.changes === 1 ? 'change' : 'changes'} ·{' '}
                {ACTOR[proposal.actorType as keyof typeof ACTOR] ?? 'somebody'} ·{' '}
                {new Date(proposal.createdAt).toLocaleString()}
              </p>
            </div>
            <Badge tone={TONE[proposal.status]}>{proposal.status}</Badge>
          </button>
        ))}
      </Card>

      {reviewing !== undefined && <Review id={reviewing} onClose={() => setReviewing(undefined)} />}
    </Page>
  )
}
