/**
 * The `.resources()` facet of `module()` (SPEC.md §13, ADR-0009).
 *
 * `@assemora/core` owns `module()` and must not learn what a resource is, so this
 * package contributes the method: the type through interface augmentation, the
 * behaviour through `defineModuleFacet`.
 */
import { defineModuleFacet, type ModuleBuilder } from '@assemora/core'

import { entryCommands } from './commands.js'
import {
  layoutCommands,
  loadLayouts,
  registerLayoutRestorer,
  rememberLayout,
} from './layout-commands.js'
import { entryQueries } from './queries.js'
import { registerResource } from './registry.js'
import type { AnyResource } from './resource.js'
import { registerEntryRestorer } from './restorer.js'
import { registerSingleton, type Singleton } from './singleton.js'
import {
  registerSingletonRestorer,
  singletonCommands,
  singletonQueries,
} from './singleton-commands.js'

declare module '@assemora/core' {
  interface ModuleBuilder {
    /** Registers resources, and with them the CRUD commands they are reached through. */
    resources(...resources: AnyResource[]): ModuleBuilder
    /** Registers singletons — one row each — and the two commands they are reached through (SPEC.md §135). */
    singletons(...singletons: Singleton[]): ModuleBuilder
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

      // One write for every resource's form, registered with the resources it serves.
      for (const definition of layoutCommands(() => context.registry)) {
        if (!context.commands.has(definition.name)) {
          context.commands.register(definition, 'resources')
        }
      }

      for (const candidate of args) {
        const registered = candidate as AnyResource

        registerResource(registered)
        context.registry.register('resources', registered.descriptor)
        registerEntryRestorer(registered.name)
        // The declaration, in front of the registry until a stored one replaces it.
        rememberLayout(context.registry, registered.name, null)
      }

      registerLayoutRestorer(() => context.registry)
    })

    // The stored arrangements, once the database can be read. Tolerant of its own table
    // not existing, for the reason `collections()` is (ADR-0021); a form that cannot be
    // read is drawn from its declaration, and the boot says so.
    internals.addHook('boot', async (context) => {
      const { pending } = await loadLayouts(context.registry, context.logger)

      if (pending) {
        context.logger.warn(
          'assemora_resource_layouts does not exist, so no stored form layout was applied. Run assemora db:migrate.',
        )
      }
    })
  })

  defineModuleFacet('singletons', (internals, args) => {
    internals.addRegistration((context) => {
      for (const definition of singletonCommands) {
        if (!context.commands.has(definition.name)) {
          context.commands.register(definition, 'resources')
        }
      }

      for (const definition of singletonQueries) {
        if (!context.queries.has(definition.name)) {
          context.queries.register(definition, 'resources')
        }
      }

      for (const candidate of args) {
        const declared = candidate as Singleton

        registerSingleton(declared)
        context.registry.register('singletons', declared.descriptor)
        registerSingletonRestorer(declared.name)
      }
    })
  })

  defined = true
}

defineResourceFacet()

export type { ModuleBuilder }
