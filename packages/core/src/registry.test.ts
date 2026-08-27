import { describe, expect, it } from 'vitest'

import { ConfigurationError } from './errors.js'
import { createSchemaRegistry } from './registry.js'

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
