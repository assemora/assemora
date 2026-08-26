import { describe, expect, it } from 'vitest'

import { createContainer, token } from './container.js'
import { ConfigurationError } from './errors.js'

type Clock = { now(): number }

const clock = token<Clock>('clock')
const greeting = token<string>('greeting')

describe('container', () => {
  it('builds a registered value on demand', () => {
    const container = createContainer()
    container.provide(clock, () => ({ now: () => 42 }))

    expect(container.get(clock).now()).toBe(42)
  })

  it('builds each value at most once', () => {
    const container = createContainer()
    let built = 0

    container.provide(clock, () => {
      built += 1
      return { now: () => built }
    })

    container.get(clock)
    container.get(clock)

    expect(built).toBe(1)
  })

  it('resolves dependencies through the container it is given', () => {
    const container = createContainer()
    container.provideValue(greeting, 'hello')
    container.provide(clock, (resolve) => ({ now: () => resolve.get(greeting).length }))

    expect(container.get(clock).now()).toBe(5)
  })

  it('distinguishes tokens by identity, not by name', () => {
    const container = createContainer()
    const first = token<string>('same')
    const second = token<string>('same')

    container.provideValue(first, 'first')
    container.provideValue(second, 'second')

    expect(container.get(first)).toBe('first')
    expect(container.get(second)).toBe('second')
  })

  it('explains what is missing', () => {
    expect(() => createContainer().get(clock)).toThrowError(ConfigurationError)
    expect(() => createContainer().get(clock)).toThrowError('Nothing is registered for "clock"')
  })

  it('refuses to spin on a circular dependency', () => {
    const container = createContainer()
    const a = token<string>('a')
    const b = token<string>('b')

    container.provide(a, (resolve) => resolve.get(b))
    container.provide(b, (resolve) => resolve.get(a))

    expect(() => container.get(a)).toThrowError('Circular dependency while resolving "a"')
  })

  it('lets a child inherit registrations but keep its own instances', () => {
    const parent = createContainer()
    let built = 0
    parent.provide(clock, () => {
      built += 1
      return { now: () => built }
    })

    const child = parent.child()

    expect(child.get(clock).now()).toBe(1)
    expect(child.has(clock)).toBe(true)

    child.provideValue(clock, { now: () => 99 })

    expect(child.get(clock).now()).toBe(99)
    expect(parent.get(clock).now()).toBe(1)
  })
})
