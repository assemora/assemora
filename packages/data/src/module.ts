/**
 * The `.models()` facet of `module()` (SPEC.md §13, §42, ADR-0009).
 *
 * Registering a model describes its table in the Schema Registry, which is where
 * migrations, introspection and `assemora.describe` read it from.
 */
import { defineModuleFacet } from '@assemora/core'
import type { TableDescriptor } from '@assemora/database'

declare module '@assemora/core' {
  interface RegistrySections {
    models: ModelDescriptor
  }

  interface ModuleBuilder {
    models(
      ...models: { readonly table: string; readonly descriptor: TableDescriptor }[]
    ): ModuleBuilder
  }
}

export type ModelDescriptor = {
  readonly name: string
  readonly table: TableDescriptor
  readonly module?: string
}

let defined = false

export const defineModelFacet = (): void => {
  if (defined) return

  defineModuleFacet('models', (internals, args) => {
    internals.addRegistration((context) => {
      for (const candidate of args) {
        const declared = candidate as { table: string; descriptor: TableDescriptor }

        if (typeof declared?.table !== 'string') continue

        context.registry.register('models', {
          name: declared.table,
          table: declared.descriptor,
          module: internals.name,
        })
      }
    })
  })

  defined = true
}

defineModelFacet()
