/**
 * The `.resources()` facet of `module()` (SPEC.md §13, ADR-0009).
 *
 * `@assemora/core` owns `module()` and must not learn what a resource is, so this
 * package contributes the method: the type through interface augmentation, the
 * behaviour through `defineModuleFacet`.
 */
import { defineModuleFacet, type ModuleBuilder } from '@assemora/core'

import { entryCommands } from './commands.js'
import { entryQueries } from './queries.js'
import { registerResource } from './registry.js'
import type { AnyResource } from './resource.js'
import { registerEntryRestorer } from './restorer.js'

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
        registerEntryRestorer(registered.name)
      }
    })
  })

  defined = true
}

defineResourceFacet()

export type { ModuleBuilder }
