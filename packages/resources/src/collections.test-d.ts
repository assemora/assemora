import { createSchemaRegistry, type ModuleBuilder } from '@assemora/core'
import { describe, expectTypeOf, it } from 'vitest'

import type { CollectionSummary } from './collection-commands.js'
import { collections } from './collection-module.js'
import type { Collection } from './collections.js'
import type { DynamicDefinition } from './dynamic.js'

describe('the collections module', () => {
  it('is an ordinary module, so an application lists it beside the others', () => {
    expectTypeOf(collections()).toEqualTypeOf<ModuleBuilder>()
  })
})

describe('withdrawing from the Schema Registry (SPEC.md §42, §47)', () => {
  const registry = createSchemaRegistry()

  it('answers whether a description was there', () => {
    expectTypeOf(registry.withdraw('resources', 'testimonials')).toEqualTypeOf<boolean>()
  })

  it('takes a section the registry actually declares, and nothing else', () => {
    // @ts-expect-error — "collectionz" is not a declared registry section.
    registry.withdraw('collectionz', 'testimonials')

    // @ts-expect-error — a name is required; withdrawing a whole section is not a thing.
    registry.withdraw('resources')
  })
})

describe('what a collection is', () => {
  it('carries the stored definition, not a copy of the descriptor', () => {
    expectTypeOf<Collection['definition']>().toEqualTypeOf<DynamicDefinition>()
    expectTypeOf<Collection['id']>().toEqualTypeOf<string>()
    expectTypeOf<Collection['dropped']>().toEqualTypeOf<readonly string[]>()
  })

  it('summarizes as plain data a screen can render', () => {
    expectTypeOf<CollectionSummary['fields']>().toEqualTypeOf<number>()
    expectTypeOf<CollectionSummary['name']>().toEqualTypeOf<string>()
  })
})
