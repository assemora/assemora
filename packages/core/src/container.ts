/**
 * Service container (SPEC.md §11).
 *
 * Tokens instead of decorators: a token is an ordinary value, so wiring is explicit,
 * greppable and needs no metadata reflection (SPEC.md §3.2).
 */
import { ConfigurationError } from './errors.js'

declare const provided: unique symbol

/** A typed key. Identity, not the name, is what the container looks up. */
export type Token<T> = {
  readonly name: string
  readonly [provided]?: T
}

export const token = <T>(name: string): Token<T> => ({ name })

export type Factory<T> = (container: Container) => T

export type Container = {
  /** Registers how to build a value. The factory runs at most once per container. */
  provide<T>(key: Token<T>, factory: Factory<T>): Container
  /** Registers an already-built value. */
  provideValue<T>(key: Token<T>, value: T): Container
  get<T>(key: Token<T>): T
  has(key: Token<unknown>): boolean
  /** A container that inherits registrations but keeps its own instances. */
  child(): Container
}

type Registration = {
  readonly factory: Factory<unknown>
}

export const createContainer = (parent?: Container): Container => {
  const registrations = new Map<Token<unknown>, Registration>()
  const instances = new Map<Token<unknown>, unknown>()
  const building = new Set<Token<unknown>>()

  const container: Container = {
    provide<T>(key: Token<T>, factory: Factory<T>): Container {
      registrations.set(key as Token<unknown>, { factory: factory as Factory<unknown> })
      instances.delete(key as Token<unknown>)
      return container
    },

    provideValue<T>(key: Token<T>, value: T): Container {
      return container.provide(key, () => value)
    },

    get<T>(key: Token<T>): T {
      const owned = key as Token<unknown>

      if (instances.has(owned)) return instances.get(owned) as T

      const registration = registrations.get(owned)

      if (registration === undefined) {
        if (parent?.has(owned) === true) return parent.get(key)
        throw new ConfigurationError(`Nothing is registered for "${key.name}"`)
      }

      if (building.has(owned)) {
        throw new ConfigurationError(`Circular dependency while resolving "${key.name}"`)
      }

      building.add(owned)
      try {
        const value = registration.factory(container)
        instances.set(owned, value)
        return value as T
      } finally {
        building.delete(owned)
      }
    },

    has(key: Token<unknown>): boolean {
      return registrations.has(key) || parent?.has(key) === true
    },

    child(): Container {
      return createContainer(container)
    },
  }

  return container
}
