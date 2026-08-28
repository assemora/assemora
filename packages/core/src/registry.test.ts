import { describe, expect, it } from 'vitest'

import { ConfigurationError } from './errors.js'
import {
  createSchemaRegistry,
  generatedCrudPrefix,
  publishGeneratedCrud,
  type RegistryChange,
} from './registry.js'

const descriptor = (name: string) => ({ name, input: { type: 'object' as const } })

describe('schema registry', () => {
  it('stores and returns a section', () => {
    const registry = createSchemaRegistry()
    registry.register('commands', descriptor('pages.publish'))

    expect(registry.section('commands')).toEqual([descriptor('pages.publish')])
  })

  it('finds an entry by name', () => {
    const registry = createSchemaRegistry()
    registry.register('commands', descriptor('pages.publish'))

    expect(registry.find('commands', 'pages.publish')?.name).toBe('pages.publish')
    expect(registry.find('commands', 'pages.delete')).toBeUndefined()
  })

  it('refuses a duplicate name, since commands are addressed by it', () => {
    const registry = createSchemaRegistry()
    registry.register('commands', descriptor('pages.publish'))

    expect(() => registry.register('commands', descriptor('pages.publish'))).toThrowError(
      ConfigurationError,
    )
  })

  it('returns an empty section rather than undefined', () => {
    expect(createSchemaRegistry().section('commands')).toEqual([])
  })

  it('withdraws a description, so a late arrival can also leave', () => {
    const registry = createSchemaRegistry()
    registry.register('commands', descriptor('testimonials.create'))

    expect(registry.withdraw('commands', 'testimonials.create')).toBe(true)
    expect(registry.find('commands', 'testimonials.create')).toBeUndefined()
    expect(registry.section('commands')).toEqual([])
  })

  it('says so when there was nothing to withdraw', () => {
    const registry = createSchemaRegistry()
    registry.register('commands', descriptor('pages.publish'))

    expect(registry.withdraw('commands', 'never.registered')).toBe(false)
    expect(registry.section('commands')).toHaveLength(1)
  })

  it('frees the name, so the same section can describe it again', () => {
    const registry = createSchemaRegistry()
    registry.register('commands', descriptor('testimonials.create'))
    registry.withdraw('commands', 'testimonials.create')

    expect(() =>
      registry.register('commands', descriptor('testimonials.create')),
    ).not.toThrowError()
    expect(registry.section('commands')).toHaveLength(1)
  })

  it('still refuses a duplicate: withdrawing is how a name is taken over', () => {
    const registry = createSchemaRegistry()
    registry.register('commands', descriptor('pages.publish'))

    expect(() => registry.register('commands', descriptor('pages.publish'))).toThrowError(
      ConfigurationError,
    )
  })

  it('describes itself as plain data', () => {
    const registry = createSchemaRegistry()
    registry.register('commands', descriptor('pages.publish'))

    expect(registry.describe()).toEqual({ commands: [descriptor('pages.publish')] })
    expect(registry.sections()).toEqual(['commands'])
  })
})

/**
 * A section derived from another has to be recomputed when that other one moves.
 *
 * `@assemora/http` describes a resource's generated REST paths, which are a consequence
 * of the resource rather than a declaration of their own (SPEC.md §37, §42). It used to
 * go looking on every request, because nothing told it — a full `describe()` per request
 * to find out that nothing had happened, and a description that was still one request
 * stale for anybody reading the registry without sending one.
 */
describe('watching the registry', () => {
  it('says what was registered, after it was registered', () => {
    const registry = createSchemaRegistry()
    const seen: RegistryChange[] = []

    registry.onChange((change) => {
      seen.push(change)
      // Told about a registry it can read, not one that is mid-change.
      expect(registry.find('commands', change.name)).toBeDefined()
    })

    registry.register('commands', descriptor('pages.publish'))

    expect(seen).toEqual([{ section: 'commands', name: 'pages.publish', change: 'registered' }])
  })

  it('says what was withdrawn', () => {
    const registry = createSchemaRegistry()
    const seen: RegistryChange[] = []

    registry.register('commands', descriptor('testimonials.create'))
    registry.onChange((change) => seen.push(change))
    registry.withdraw('commands', 'testimonials.create')

    expect(seen).toEqual([
      { section: 'commands', name: 'testimonials.create', change: 'withdrawn' },
    ])
  })

  it('stays quiet when there was nothing to withdraw', () => {
    const registry = createSchemaRegistry()
    const seen: RegistryChange[] = []

    registry.onChange((change) => seen.push(change))

    // Nothing happened, so nothing is announced: a listener that rebuilt a derived
    // section here would do the work of the whole registry for a call that did nothing.
    expect(registry.withdraw('commands', 'never.registered')).toBe(false)
    expect(seen).toEqual([])
  })

  it('tells every listener, and stops telling one that unsubscribed', () => {
    const registry = createSchemaRegistry()
    const first: string[] = []
    const second: string[] = []

    const stop = registry.onChange((change) => first.push(change.name))
    registry.onChange((change) => second.push(change.name))

    registry.register('commands', descriptor('pages.publish'))
    stop()
    registry.register('commands', descriptor('pages.delete'))

    expect(first).toEqual(['pages.publish'])
    expect(second).toEqual(['pages.publish', 'pages.delete'])
  })

  it('lets a listener register something of its own', () => {
    const registry = createSchemaRegistry()

    // The ordinary case rather than a corner: a derived section is written by a listener
    // to the section it derives from. The set is walked over a copy, so a listener added
    // or removed while it is being walked neither doubles nor disappears.
    registry.onChange((change) => {
      if (change.section === 'commands' && change.change === 'registered') {
        registry.register('queries', descriptor(`${change.name}.echo`))
        registry.onChange(() => undefined)
      }
    })

    registry.register('commands', descriptor('pages.publish'))

    expect(registry.find('queries', 'pages.publish.echo')).toBeDefined()
  })
})

/**
 * Where the resources section is published, for a package that may not ask the server.
 *
 * `collections.create` names the REST addresses of the collection it just made, and an
 * application built with `api: { crud: false }` serves none of them (SPEC.md §43).
 */
describe('the generated CRUD prefix', () => {
  it('is nothing until something publishes it', () => {
    publishGeneratedCrud()

    expect(generatedCrudPrefix()).toBeUndefined()
  })

  it('is whatever the last thing to say so said', () => {
    publishGeneratedCrud('/api')

    expect(generatedCrudPrefix()).toBe('/api')

    // A process has one server, and the one it built last speaks for it.
    publishGeneratedCrud('/v2')

    expect(generatedCrudPrefix()).toBe('/v2')

    publishGeneratedCrud()

    expect(generatedCrudPrefix()).toBeUndefined()
  })
})
