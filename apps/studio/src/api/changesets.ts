/**
 * How many proposals are waiting for a person (SPEC.md §75).
 *
 * An agent proposes in the background — over MCP, from a session nobody in Studio is
 * watching — and nothing changes until somebody presses Apply. Unless the sidebar says
 * there is something to decide, a proposal waits out its lifetime on a screen nobody
 * thought to open.
 *
 * One row is asked for, because the answer is `total` and the rows are the screen's job.
 * It is the same `status=pending` the screen's first tab reads, so the number beside the
 * link and the number in that screen's heading are one number.
 */
import { useQuery } from '@tanstack/react-query'

import { api } from './client.ts'

/** Soon enough to notice an agent within a minute, rare enough to cost nothing. */
const EVERY_MS = 60_000

/**
 * The count, or `0` while it is not known.
 *
 * `enabled` is the caller's: an application without change sets has no
 * `changesets.list` to ask, and a viewer without `changesets.read` would be refused —
 * and a badge is not worth a request that can only fail.
 */
export const usePendingProposals = (enabled: boolean): number => {
  const pending = useQuery({
    queryKey: ['changesets', 'pending', 'total'],
    queryFn: ({ signal }) =>
      api.query<{ total: number }>('changesets.list', { status: 'pending', perPage: 1 }, signal),
    select: (page) => page.total,
    enabled,
    refetchInterval: EVERY_MS,
    // Off everywhere else in Studio (`main.tsx`). This is the one read a person comes
    // back to the tab for: they asked an agent something in another window, and the
    // answer is a proposal.
    refetchOnWindowFocus: true,
  })

  // `enabled: false` stops the request and not the answer: a count already in the cache
  // — the last viewer's, in the same tab — would still be handed back.
  return enabled ? (pending.data ?? 0) : 0
}
