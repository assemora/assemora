/**
 * Watching the registry, and asking where its resources are published (SPEC.md §42, §43).
 *
 * Both additions exist so that a description derived from the registry can be *correct*
 * rather than eventually correct: `@assemora/http` keeps a resource's REST paths level
 * with the resource by being told, and `@assemora/resources` finds out whether this
 * application publishes any before it promises somebody five addresses.
 */
import { expectTypeOf, test } from 'vitest'

import {
  createSchemaRegistry,
  generatedCrudPrefix,
  publishGeneratedCrud,
  type RegistryChange,
  type SchemaRegistry,
} from './registry.js'

const registry: SchemaRegistry = createSchemaRegistry()

test('a listener is handed the change and answers with the way to stop', () => {
  const stop = registry.onChange((change) => {
    expectTypeOf(change).toEqualTypeOf<RegistryChange>()
    expectTypeOf(change.change).toEqualTypeOf<'registered' | 'withdrawn'>()
  })

  expectTypeOf(stop).toEqualTypeOf<() => void>()
})

test('the section a change names is a string, because sections are declared elsewhere', () => {
  registry.onChange((change) => {
    // `keyof RegistrySections` means something different in every package (SPEC.md §8),
    // and the packages that most need to watch a section are the ones that may not
    // depend on its owner. So this compiles here, where `resources` is not declared.
    expectTypeOf(change.section).toEqualTypeOf<string>()
  })
})

test('a prefix goes in, and a prefix or nothing comes back', () => {
  publishGeneratedCrud('/api')
  // No argument is how a process says it publishes none.
  publishGeneratedCrud()

  expectTypeOf(generatedCrudPrefix()).toEqualTypeOf<string | undefined>()
})

test('invalid usage', () => {
  // @ts-expect-error a listener is called with the change, so it cannot take two
  registry.onChange((change: RegistryChange, second: string) => `${change.name}${second}`)

  registry.onChange((change) => {
    // @ts-expect-error a change says what happened, and nothing else did
    const _unknown: 'renamed' = change.change

    return _unknown
  })

  // @ts-expect-error the prefix is a path, not a flag
  publishGeneratedCrud(true)

  // @ts-expect-error reading it takes no arguments: it is a fact about the process
  generatedCrudPrefix('/api')
})
