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
import { Sparkles } from 'lucide-react'
import { useState } from 'react'

import { api } from '../api/client.ts'
import type { Paged } from '../api/pages.ts'
import type { MessageKey } from '../i18n/messages.ts'
import { useDates, useT } from '../i18n/translate.tsx'
import { Badge, Button, Card, Empty, Failure, Spinner } from '../ui/index.tsx'
import { Screen, ScreenBody, ScreenHead, ScreenTitle, Tabs } from '../ui/layout.tsx'

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

/** `''` is "all": the query drops the filter rather than sending an empty status. */
const STATUSES = [
  { value: 'pending', label: 'proposals.status.pending' },
  { value: 'applied', label: 'proposals.status.applied' },
  { value: 'rejected', label: 'proposals.status.rejected' },
  { value: '', label: 'proposals.status.all' },
] as const satisfies readonly { value: string; label: MessageKey }[]

/** Every state a proposal can be shown in, including the two it is only ever put into. */
const STATE = {
  pending: 'proposals.status.pending',
  applied: 'proposals.status.applied',
  rejected: 'proposals.status.rejected',
  expired: 'proposals.status.expired',
  conflicted: 'proposals.status.conflicted',
} as const satisfies Record<ChangeSetRow['status'], MessageKey>

const ACTOR = {
  agent: 'history.actor.agent',
  user: 'history.actor.person',
  api: 'history.actor.token',
} as const satisfies Record<string, MessageKey>

const Review = ({ id, onClose }: { id: string; onClose(): void }) => {
  const client = useQueryClient()
  const t = useT()
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
          <h2 className="text-base font-semibold">{proposal.data?.title}</h2>
          <p className="mt-0.5 text-sm text-ink-faint">
            {proposal.data === undefined
              ? null
              : `${t('proposals.changeCount', {
                  count: proposal.data.changes.length,
                })} · ${t('proposals.proposedBy', {
                  who: t(
                    ACTOR[proposal.data.actorType as keyof typeof ACTOR] ?? 'proposals.somebody',
                  ),
                })}`}
          </p>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {proposal.isPending && <Spinner />}
          {proposal.isError && <Failure error={proposal.error} />}
          {decide.isError && <Failure error={decide.error} />}

          {outcome === 'conflicted' && (
            <Card className="mb-3 border-danger/30 bg-danger-soft p-3">
              <p className="text-base text-danger">{t('proposals.conflicted')}</p>
            </Card>
          )}

          {outcome === 'expired' && (
            <Card className="mb-3 bg-surface-sunken p-3">
              <p className="text-base text-ink-soft">{t('proposals.expired')}</p>
            </Card>
          )}

          <ol className="space-y-3">
            {proposal.data?.changes.map((change, index) => (
              // The diff is stored, ordered and immutable: it is never reordered or
              // filtered, and two changes to one entity are legitimately identical
              // lines — so the position is the only stable identity there is.
              // biome-ignore lint/suspicious/noArrayIndexKey: a stored diff never reorders
              <li key={index} className="space-y-0.5">
                <p className="text-base font-medium capitalize">{change.entityType}</p>
                <p className="font-mono text-sm text-ink-soft">{change.summary}</p>
              </li>
            ))}
          </ol>
        </div>

        <footer className="flex items-center gap-2 border-t border-line px-5 py-3">
          {open ? (
            <>
              <Button disabled={decide.isPending} onClick={() => decide.mutate('apply')}>
                {decide.isPending ? t('proposals.applying') : t('proposals.apply')}
              </Button>
              <Button
                variant="secondary"
                disabled={decide.isPending}
                onClick={() => decide.mutate('reject')}
              >
                {t('proposals.reject')}
              </Button>
            </>
          ) : (
            <Badge tone={TONE[(outcome ?? proposal.data?.status ?? 'pending') as 'pending']}>
              {t(STATE[(outcome ?? proposal.data?.status ?? 'pending') as 'pending'])}
            </Badge>
          )}

          <Button variant="ghost" className="ml-auto" onClick={onClose}>
            {t('common.close')}
          </Button>
        </footer>
      </Card>
    </div>
  )
}

export const ChangeSets = () => {
  const t = useT()
  const dates = useDates()
  const [status, setStatus] = useState('pending')
  const [reviewing, setReviewing] = useState<string>()

  const listing = useQuery({
    queryKey: ['changesets', status],
    queryFn: ({ signal }) =>
      api.query<Paged<ChangeSetRow>>('changesets.list', status === '' ? {} : { status }, signal),
  })

  return (
    <Screen>
      <ScreenHead>
        <ScreenTitle
          icon={<Sparkles className="size-5" />}
          title={t('nav.proposals')}
          description={t('proposals.lede')}
          count={listing.data?.total}
        />
        <Tabs
          value={status}
          options={STATUSES.map((entry) => ({ value: entry.value, label: t(entry.label) }))}
          onChange={setStatus}
          label={t('proposals.statuses')}
        />
      </ScreenHead>

      <ScreenBody className="pt-6 pb-10">
        {listing.isError && <Failure error={listing.error} />}

        <Card className="overflow-hidden">
          {listing.isPending && (
            <div className="p-6">
              <Spinner />
            </div>
          )}

          {listing.data?.data.length === 0 && (
            <Empty title={t('proposals.none')}>{t('proposals.noneBody')}</Empty>
          )}

          {listing.data?.data.map((proposal) => (
            <button
              key={proposal.id}
              type="button"
              className="flex w-full items-center gap-3 border-b border-hairline px-4 py-3 text-left last:border-0 hover:bg-surface-sunken"
              onClick={() => setReviewing(proposal.id)}
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-base font-medium">{proposal.title}</p>
                <p className="text-sm text-ink-faint">
                  {t('proposals.changeCount', { count: proposal.changes })} ·{' '}
                  {t(ACTOR[proposal.actorType as keyof typeof ACTOR] ?? 'proposals.somebody')} ·{' '}
                  {dates.dateTime(proposal.createdAt)}
                </p>
              </div>
              <Badge tone={TONE[proposal.status]}>{t(STATE[proposal.status])}</Badge>
            </button>
          ))}
        </Card>

        {reviewing !== undefined && (
          <Review id={reviewing} onClose={() => setReviewing(undefined)} />
        )}
      </ScreenBody>
    </Screen>
  )
}
