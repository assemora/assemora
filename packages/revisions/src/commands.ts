/**
 * Reading and undoing history (SPEC.md §65, §70).
 *
 * Restoring is itself a mutation, so it travels the Command Bus, passes policies and
 * leaves a revision of its own. Undoing is never a way around the pipeline.
 */
import { AssemoraError, type CommandContext, command, NotFoundError, query } from '@assemora/core'
import { changedFields, diff, enumOf, number, string, uuid } from '@assemora/schema'

import { Revision } from './models.js'
import { restorerFor } from './restore.js'

declare module '@assemora/core' {
  interface AssemoraEventPayloads {
    'revision.restored': { readonly entityType: string; readonly entityId: string }
  }
}

/**
 * A timeline row.
 *
 * Deliberately without `before` and `after`: for a page those are two complete block
 * trees, and twenty of them is a very large answer to "what happened here lately".
 * `revisions.get` hands over the snapshots when something actually needs them.
 */
const summarise = (revision: Awaited<ReturnType<typeof Revision.findOrFail>>) => ({
  id: revision.id,
  sequence: revision.sequence,
  entityType: revision.entityType,
  entityId: revision.entityId,
  actorType: revision.actorType,
  actorId: revision.actorId,
  command: revision.command,
  changed: changedFields(revision.patch),
  patch: revision.patch,
  metadata: revision.metadata,
  createdAt: revision.createdAt,
})

export const ListRevisions = query('revisions.list', {
  description: 'The history of one entity, newest first',
  input: {
    entityType: string(),
    entityId: string(),
    page: number().integer().optional(),
    perPage: number().integer().optional(),
  },
  handle: async ({ entityType, entityId, page, perPage }, context) => {
    // The input names what is read, so reading it is a second question: holding
    // `revisions.read` must not open the history of every entity in the application.
    await context.authorize(entityType, 'read', null)

    const found = await Revision.where('entityType', entityType)
      .where('entityId', entityId)
      .orderBy('sequence', 'desc')
      .paginate(page ?? 1, Math.min(perPage ?? 20, 100))

    return { ...found, data: found.data.map(summarise) }
  },
})

export const GetRevision = query('revisions.get', {
  description: 'One revision, with both snapshots',
  input: { id: uuid() },
  handle: async ({ id }, context) => {
    const revision = await Revision.find(id)

    if (revision === null) throw new NotFoundError('revision', id)

    await context.authorize(revision.entityType, 'read', revision.after)

    return { ...summarise(revision), before: revision.before, after: revision.after }
  },
})

export const CompareRevisions = query('revisions.compare', {
  description: 'What changed between two revisions of the same entity',
  input: { from: uuid(), to: uuid() },
  handle: async ({ from, to }, context) => {
    const earlier = await Revision.find(from)
    const later = await Revision.find(to)

    if (earlier === null) throw new NotFoundError('revision', from)
    if (later === null) throw new NotFoundError('revision', to)

    await context.authorize(later.entityType, 'read', later.after)

    return {
      entityType: later.entityType,
      entityId: later.entityId,
      patch: diff(earlier.after, later.after),
    }
  },
})

type StoredRevision = Awaited<ReturnType<typeof Revision.findOrFail>>

export type RestoreSide = 'before' | 'after'

/**
 * Applies one side of a revision and records the fact.
 *
 * Restoring is itself a mutation, so it travels the Command Bus, passes policies and
 * leaves a revision of its own. Undoing is never a way around the pipeline
 * (SPEC.md §65).
 */
const apply = async (
  revision: StoredRevision,
  side: RestoreSide,
  context: CommandContext,
  metadata: Readonly<Record<string, unknown>>,
) => {
  const target = side === 'before' ? revision.before : revision.after

  await context.authorize(revision.entityType, 'restore', target)

  const restored = await restorerFor(revision.entityType)(revision.entityId, target)

  // What the entity was a moment ago, not what the revision being applied happened to
  // hold on its other side. Restoring an old revision after other edits is exactly
  // where the two differ, and a timeline that recorded the wrong one would send an
  // undo of this restore to a state the page was never in.
  const replaced = restored?.replaced

  context.revise({
    entityType: revision.entityType,
    entityId: revision.entityId,
    before:
      replaced === undefined ? (side === 'before' ? revision.after : revision.before) : replaced,
    after: target,
    metadata,
  })
  context.emit('revision.restored', {
    entityType: revision.entityType,
    entityId: revision.entityId,
  })

  // The new version comes back, so an editor can carry on without a read in between:
  // its next command has to carry `expectedVersion` (SPEC.md §66).
  const { replaced: _replaced, ...answer } = restored ?? {}

  return {
    entityType: revision.entityType,
    entityId: revision.entityId,
    restoredFrom: revision.id,
    restoredTo: side,
    ...answer,
  }
}

/**
 * How deep an undo stack is read.
 *
 * Undo walks the history rather than keeping a stack of its own, because a stack in
 * a browser tab does not survive a reload and does not exist for an agent. Two
 * hundred is far past where anyone is still undoing, and it bounds the read.
 */
const STACK_DEPTH = 200

type Kind = 'edit' | 'undo' | 'redo'

const kindOf = (revision: StoredRevision): Kind => {
  const metadata = revision.metadata

  if (typeof metadata.undoOf === 'string') return 'undo'
  if (typeof metadata.redoOf === 'string') return 'redo'

  return 'edit'
}

const historyOf = async (entityType: string, entityId: string): Promise<StoredRevision[]> =>
  await Revision.where('entityType', entityType)
    .where('entityId', entityId)
    .orderBy('sequence', 'desc')
    .limit(STACK_DEPTH)
    .get()

/**
 * The change an undo should reverse.
 *
 * Walking newest-first: every undo already in the history has consumed one edge
 * further back, and every redo has given one back. The first edit reached with
 * nothing outstanding is the one still in effect, and therefore the one to undo.
 */
const undoable = (history: readonly StoredRevision[]): StoredRevision | undefined => {
  let outstanding = 0

  for (const revision of history) {
    const kind = kindOf(revision)

    if (kind === 'undo') outstanding += 1
    else if (kind === 'redo') outstanding -= 1
    else if (outstanding === 0) return revision
    else outstanding -= 1
  }

  return undefined
}

/**
 * The undo a redo should reverse: the most recent one not already redone.
 *
 * An ordinary edit ends the search. Undoing and then editing abandons whatever the
 * undo took away — the history has branched, and the branch nobody is on is gone.
 * Without that rule a redo would reach past the new edit and overwrite it with a
 * state the page left long ago.
 */
const redoable = (history: readonly StoredRevision[]): StoredRevision | undefined => {
  let redone = 0

  for (const revision of history) {
    const kind = kindOf(revision)

    if (kind === 'edit') return undefined
    if (kind === 'redo') redone += 1
    else if (redone === 0) return revision
    else redone -= 1
  }

  return undefined
}

const NOTHING_TO_UNDO = (what: string) =>
  new AssemoraError('NOTHING_TO_UNDO', `There is nothing left to ${what}`, { status: 409 })

export const UndoChange = command('revisions.undo', {
  description: 'Reverses the most recent change to an entity (SPEC.md §60, §65)',
  input: { entityType: string(), entityId: string() },
  handle: async ({ entityType, entityId }, context) => {
    const revision = undoable(await historyOf(entityType, entityId))

    if (revision === undefined) throw NOTHING_TO_UNDO('undo')

    return apply(revision, 'before', context, { undoOf: revision.id })
  },
})

export const RedoChange = command('revisions.redo', {
  description: 'Puts back what the last undo took away (SPEC.md §60)',
  input: { entityType: string(), entityId: string() },
  handle: async ({ entityType, entityId }, context) => {
    const revision = redoable(await historyOf(entityType, entityId))

    if (revision === undefined) throw NOTHING_TO_UNDO('redo')

    // The undo recorded the state it left as `before`; going back to it is the redo.
    return apply(revision, 'before', context, { redoOf: revision.id })
  },
})

export const RestoreRevision = command('revisions.restore', {
  description: 'Puts an entity back to one of the two states a revision recorded',
  input: {
    id: uuid(),
    /**
     * Which side of the revision to go back to.
     *
     * `after` puts the entity back the way that revision left it — what "restore
     * this version" means on a timeline. `before` reverses it instead. They are
     * genuinely different acts and the caller says which (SPEC.md §65).
     */
    to: enumOf('before', 'after').optional(),
  },
  handle: async ({ id, to }, context) => {
    const revision = await Revision.find(id)

    if (revision === null) throw new NotFoundError('revision', id)

    const side = to ?? 'after'

    return apply(revision, side, context, { restoredFrom: revision.id, restoredTo: side })
  },
})

export const revisionCommands = [RestoreRevision, UndoChange, RedoChange] as const
export const revisionQueries = [ListRevisions, GetRevision, CompareRevisions] as const
