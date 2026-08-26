/**
 * Proposing, applying and rejecting (SPEC.md §73, §74, §75).
 *
 * All three are commands, so an agent proposing and a person applying pass the same
 * pipeline, and both are audited. Apply re-executes the stored commands through the
 * Command Bus rather than writing the stored diff: the diff is a description of what
 * would happen, and treating it as the thing to write would be a second way to
 * mutate — which SPEC.md §14 does not allow.
 */
import { AssemoraError, command, NotFoundError, type Preview, query } from '@assemora/core'
import { array, json, number, string, unknown as unknownSchema, uuid } from '@assemora/schema'

import { ChangeSet, type ChangeSetStatus, type ProposedChange } from './models.js'
import { summarise } from './summary.js'

declare module '@assemora/core' {
  interface AssemoraEventPayloads {
    'changeset.proposed': { readonly changeSetId: string }
    'changeset.applied': { readonly changeSetId: string }
    'changeset.conflicted': { readonly changeSetId: string; readonly changed: readonly string[] }
    'changeset.rejected': { readonly changeSetId: string }
  }
}

/** Long enough for a person to read it, short enough that the world has not moved. */
const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000

const key = (entityType: string, entityId: string): string => `${entityType}:${entityId}`

/**
 * The version each touched entity was at when the diff was computed.
 *
 * Only entities that carry one are recorded. Pages and users do; resource rows do
 * not, because SPEC.md §66's versioning landed with pages — so conflict detection is
 * complete for pages and absent for entries until it is general.
 */
const versionsOf = (previews: readonly Preview[]): Record<string, number> => {
  const versions: Record<string, number> = {}

  for (const preview of previews) {
    for (const change of preview.changes) {
      const before = change.before as { version?: unknown } | null
      const version = before?.version

      if (typeof version === 'number' && !(key(change.entityType, change.entityId) in versions)) {
        versions[key(change.entityType, change.entityId)] = version
      }
    }
  }

  return versions
}

const changesOf = (previews: readonly Preview[]): ProposedChange[] =>
  previews.flatMap((preview) =>
    preview.changes.map((change) => ({
      entityType: change.entityType,
      entityId: change.entityId,
      patch: change.patch,
      summary: summarise(change.entityType, change.patch),
    })),
  )

export const ProposeChangeSet = command('changesets.propose', {
  description: 'Previews a sequence of commands and stores it for a person to approve',
  input: {
    title: string().min(1),
    commands: array(json<{ readonly command: string; readonly input: unknown }>()).min(1),
    ttlMs: number().integer().optional(),
  },
  handle: async ({ title, commands, ttlMs }, context) => {
    // The preview runs every command through validation, authorization and the real
    // handler, and undoes all of it. A proposal an actor could not perform is
    // refused here rather than at apply time (SPEC.md §73).
    const previews = await context.preview(commands)

    const proposal = await ChangeSet.create({
      actorType: context.actor?.type ?? null,
      actorId: context.actor?.id ?? null,
      title,
      commands,
      diff: { changes: changesOf(previews) },
      status: 'pending' satisfies ChangeSetStatus,
      baseVersions: versionsOf(previews),
      expiresAt: new Date(Date.now() + (ttlMs ?? DEFAULT_TTL_MS)),
      appliedAt: null,
    })

    context.emit('changeset.proposed', { changeSetId: proposal.id })

    return {
      id: proposal.id,
      status: proposal.status,
      changes: proposal.diff.changes,
      expiresAt: proposal.expiresAt,
    }
  },
})

/**
 * The proposal, if it is still open to being decided.
 *
 * Being already applied or rejected is the caller's mistake and throws. Having
 * expired is not: time passing is the expected way a proposal ends, and the row has
 * to record it — which a rejection could not do, because the transaction that
 * carried it would be undone along with the refusal.
 */
const openOrFail = async (id: string) => {
  const proposal = await ChangeSet.find(id)

  if (proposal === null) throw new NotFoundError('change set', id)

  if (proposal.status !== 'pending') {
    throw new AssemoraError('CHANGE_SET_CLOSED', `This change set was already ${proposal.status}`, {
      status: 409,
    })
  }

  return proposal
}

export const ApplyChangeSet = command('changesets.apply', {
  description: 'Runs the commands a change set proposed, in the applier’s own name',
  input: { id: uuid() },
  // Applying runs real commands; previewing a preview is not a thing.
  previewable: false,
  handle: async ({ id }, context) => {
    const proposal = await openOrFail(id)

    await context.authorize('changesets', 'apply', proposal.toJSON())

    if (proposal.expiresAt.getTime() < Date.now()) {
      await proposal.update({ status: 'expired' satisfies ChangeSetStatus })

      return { id, status: 'expired' as const, applied: false, results: [] }
    }

    // Everything the diff was computed against must still be where it was. A person
    // approved a description of a change, and that description is stale the moment
    // somebody else writes (SPEC.md §66, §74).
    //
    // The versions are read by previewing the proposal again rather than by asking
    // core to know what a page is: the preview's `before` snapshots carry them, and
    // it re-proves that the commands still run at the same time.
    const now = versionsOf(await context.preview(proposal.commands))

    const moved = Object.entries(proposal.baseVersions)
      .filter(([entity, version]) => now[entity] !== undefined && now[entity] !== version)
      .map(([entity]) => entity)

    if (moved.length > 0) {
      // Not an exception: declining to apply a stale proposal is what applying one
      // is supposed to do, and the row has to remember that it did. Throwing would
      // undo the very status that records the refusal.
      await proposal.update({ status: 'conflicted' satisfies ChangeSetStatus })
      context.emit('changeset.conflicted', { changeSetId: id, changed: moved })

      return { id, status: 'conflicted' as const, applied: false, changed: moved, results: [] }
    }

    // Re-executed through the bus, in the applier's context — so the commands pass
    // the approving person's permissions and policies, not the proposer's.
    const results: unknown[] = []

    for (const proposed of proposal.commands) {
      results.push(await context.execute(proposed.command, proposed.input))
    }

    await proposal.update({
      status: 'applied' satisfies ChangeSetStatus,
      appliedAt: new Date(),
    })

    context.emit('changeset.applied', { changeSetId: id })

    return { id, status: 'applied' as const, applied: true, results }
  },
})

export const RejectChangeSet = command('changesets.reject', {
  description: 'Closes a change set without running any of it',
  input: { id: uuid(), reason: string().optional() },
  handle: async ({ id, reason }, context) => {
    const proposal = await openOrFail(id)

    await context.authorize('changesets', 'reject', proposal.toJSON())
    await proposal.update({ status: 'rejected' satisfies ChangeSetStatus })

    context.emit('changeset.rejected', { changeSetId: id })

    return { id, status: 'rejected', reason: reason ?? null }
  },
})

export const ListChangeSets = query('changesets.list', {
  description: 'Proposals, newest first',
  input: {
    status: string().optional(),
    actorId: string().optional(),
    page: number().integer().optional(),
    perPage: number().integer().optional(),
  },
  handle: async ({ status, actorId, page, perPage }) => {
    let found = ChangeSet.orderBy('createdAt', 'desc')

    if (status !== undefined) found = found.where('status', status)
    if (actorId !== undefined) found = found.where('actorId', actorId)

    const listed = await found.paginate(page ?? 1, Math.min(perPage ?? 20, 100))

    return {
      ...listed,
      data: listed.data.map((proposal) => ({
        id: proposal.id,
        title: proposal.title,
        status: proposal.status,
        actorType: proposal.actorType,
        actorId: proposal.actorId,
        changes: proposal.diff.changes.length,
        expiresAt: proposal.expiresAt,
        createdAt: proposal.createdAt,
        appliedAt: proposal.appliedAt,
      })),
    }
  },
})

export const GetChangeSet = query('changesets.get', {
  description: 'One proposal, with every line a person is approving',
  input: { id: uuid() },
  handle: async ({ id }) => {
    const proposal = await ChangeSet.find(id)

    if (proposal === null) throw new NotFoundError('change set', id)

    return {
      id: proposal.id,
      title: proposal.title,
      status: proposal.status,
      actorType: proposal.actorType,
      actorId: proposal.actorId,
      commands: proposal.commands,
      changes: proposal.diff.changes,
      expiresAt: proposal.expiresAt,
      createdAt: proposal.createdAt,
      appliedAt: proposal.appliedAt,
    }
  },
})

export { unknownSchema }

export const changeSetCommands = [ProposeChangeSet, ApplyChangeSet, RejectChangeSet] as const
export const changeSetQueries = [ListChangeSets, GetChangeSet] as const
