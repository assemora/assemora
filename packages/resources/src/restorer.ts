/**
 * How an entry goes back to an earlier state (SPEC.md §65).
 *
 * Without this a revision history could be read and never acted on: `revisions.restore`
 * refuses an entity type nobody has taught it about. Every resource registers one —
 * static resources when their module is registered, collections when they are created
 * or loaded — and the restorer is the same either way, because a dynamic resource is a
 * resource and not a special case.
 */
import { registerRestorer } from '@assemora/core'

import { resourceByName } from './registry.js'
import { PERSISTENCE } from './resource.js'

/**
 * Teaches `revisions.restore` how to put one of this resource's entries back.
 *
 * The resource is looked up by name when the restore runs rather than captured here,
 * so a collection that has since been deleted answers `UNKNOWN_RESOURCE` instead of
 * quietly re-creating a row into a collection whose definition is gone — the definition
 * is what makes the JSONB readable.
 *
 * The write goes through the same persistence seam the CRUD commands use, so it is
 * subject to the resource's own validation and projection, and the caller has already
 * been authorized for `restore` on this subject.
 */
export const registerEntryRestorer = (name: string): void => {
  registerRestorer(name, async (entityId, state) => {
    const target = resourceByName(name)
    const existing = await target[PERSISTENCE].load(entityId).catch(() => undefined)

    // `null` means the entry did not exist then, so putting it back means taking it
    // away again (SPEC.md §65).
    if (state === null || state === undefined) {
      if (existing === undefined) return { replaced: null }

      const removed = await target[PERSISTENCE].remove(entityId)

      return { replaced: removed.before }
    }

    const snapshot = state as Record<string, unknown>
    const writable = Object.fromEntries(
      target.descriptor.fields
        .filter((field) => !field.readOnly && Object.hasOwn(snapshot, field.name))
        .map((field) => [field.name, snapshot[field.name]]),
    )

    if (existing === undefined) {
      const created = await target[PERSISTENCE].create(target.validate(writable, 'create'))

      return { replaced: null, id: created.id }
    }

    const written = await target[PERSISTENCE].update(entityId, target.validate(writable, 'update'))

    return { replaced: written.before }
  })
}
