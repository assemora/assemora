/**
 * The `.resources()` facet of `module()` (SPEC.md §13, ADR-0009).
 *
 * `@assemora/core` owns `module()` and must not learn what a resource is, so this
 * package contributes the method: the type through interface augmentation, the
 * behaviour through `defineModuleFacet`.
 */
import { defineModuleFacet, type ModuleBuilder, registerRestorer } from '@assemora/core'

import { entryCommands } from './commands.js'
import { entryQueries } from './queries.js'
import { registerResource } from './registry.js'
import { type AnyResource, PERSISTENCE } from './resource.js'

declare module '@assemora/core' {
  interface ModuleBuilder {
    /** Registers resources, and with them the CRUD commands they are reached through. */
    resources(...resources: AnyResource[]): ModuleBuilder
  }
}

let defined = false

/** Called once when this package is imported. Exposed so tests can reset it. */
export const defineResourceFacet = (): void => {
  if (defined) return

  defineModuleFacet('resources', (internals, args) => {
    internals.addRegistration((context) => {
      // A resource with no commands cannot be written to at all, since the Command
      // Bus is the only mutation path (SPEC.md §2). The two always ship together.
      for (const entryCommand of entryCommands) {
        if (!context.commands.has(entryCommand.name)) {
          context.commands.register(entryCommand, 'resources')
        }
      }

      for (const entryQuery of entryQueries) {
        if (!context.queries.has(entryQuery.name)) {
          context.queries.register(entryQuery, 'resources')
        }
      }

      for (const candidate of args) {
        const registered = candidate as AnyResource

        registerResource(registered)
        context.registry.register('resources', registered.descriptor)

        // How an entry goes back to an earlier state (SPEC.md §65). Without this a
        // revision history could be read and never acted on: `revisions.restore`
        // refuses an entity type nobody has taught it about.
        //
        // The write goes through the same persistence seam the CRUD commands use, so
        // it is subject to the resource's own projection — and the caller has already
        // been authorized for `restore` on this subject.
        registerRestorer(registered.name, async (entityId, state) => {
          const existing = await registered[PERSISTENCE].load(entityId).catch(() => undefined)

          // `null` means the entry did not exist then, so putting it back means
          // taking it away again (SPEC.md §65).
          if (state === null || state === undefined) {
            if (existing === undefined) return { replaced: null }

            const removed = await registered[PERSISTENCE].remove(entityId)

            return { replaced: removed.before }
          }

          const snapshot = state as Record<string, unknown>
          const writable = Object.fromEntries(
            registered.descriptor.fields
              .filter((field) => !field.readOnly && field.name in snapshot)
              .map((field) => [field.name, snapshot[field.name]]),
          )

          if (existing === undefined) {
            const created = await registered[PERSISTENCE].create(
              registered.validate(writable, 'create'),
            )

            return { replaced: null, id: created.id }
          }

          const written = await registered[PERSISTENCE].update(
            entityId,
            registered.validate(writable, 'update'),
          )

          return { replaced: written.before }
        })
      }
    })
  })

  defined = true
}

defineResourceFacet()

export type { ModuleBuilder }
