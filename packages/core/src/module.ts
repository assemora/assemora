/**
 * Module system (SPEC.md §13).
 *
 * A module is a registration unit with a lifecycle: register, boot, ready, shutdown.
 * `core` only knows about commands, providers and listeners; packages above it add
 * `.models()`, `.resources()` and `.routes()` through `defineModuleFacet` plus
 * interface augmentation, which keeps the API of §13 intact without `core` learning
 * what a model is (SPEC.md §8, ADR-0008).
 */
import type { AnyCommand, CommandBus } from './commands.js'
import type { Container, Factory, Token } from './container.js'
import { ConfigurationError } from './errors.js'
import type { EventBus, PayloadOf } from './events.js'
import type { Logger } from './logger.js'
import type { AnyQuery, QueryBus } from './queries.js'
import type { SchemaRegistry } from './registry.js'

export type ModuleContext = {
  readonly container: Container
  readonly commands: CommandBus
  readonly queries: QueryBus
  readonly events: EventBus
  readonly registry: SchemaRegistry
  readonly logger: Logger
  readonly module: string
}

export type LifecycleHook = (context: ModuleContext) => void | Promise<void>

export type LifecyclePhase = 'boot' | 'ready' | 'shutdown'

export type ModuleDefinition = {
  readonly name: string
  readonly registrations: readonly LifecycleHook[]
  readonly hooks: Readonly<Record<LifecyclePhase, readonly LifecycleHook[]>>
}

export const MODULE: unique symbol = Symbol('assemora.module')

export interface ModuleBuilder {
  readonly name: string
  readonly [MODULE]: ModuleDefinition
  commands(...definitions: AnyCommand[]): ModuleBuilder
  /** Read operations. They never reach the Command Bus (SPEC.md §15). */
  queries(...definitions: AnyQuery[]): ModuleBuilder
  provide<T>(key: Token<T>, factory: Factory<T>): ModuleBuilder
  on<K extends string>(
    event: K,
    listener: (payload: PayloadOf<K>) => void | Promise<void>,
  ): ModuleBuilder
  boot(hook: LifecycleHook): ModuleBuilder
  ready(hook: LifecycleHook): ModuleBuilder
  shutdown(hook: LifecycleHook): ModuleBuilder
}

/** What a facet from another package is handed. */
export type ModuleInternals = {
  readonly name: string
  addRegistration(registration: LifecycleHook): void
  addHook(phase: LifecyclePhase, hook: LifecycleHook): void
}

export type ModuleFacet = (module: ModuleInternals, args: readonly unknown[]) => void

const facets = new Map<string, ModuleFacet>()

/**
 * Registers a builder method contributed by another package. Call it at import time
 * and augment `ModuleBuilder` with the matching signature.
 */
export const defineModuleFacet = (name: string, apply: ModuleFacet): void => {
  if (facets.has(name)) {
    throw new ConfigurationError(`Module facet "${name}" is already defined`)
  }
  facets.set(name, apply)
}

/** Exposed for tests; production code has no reason to unregister a facet. */
export const clearModuleFacets = (): void => {
  facets.clear()
}

export const module = (name: string): ModuleBuilder => {
  const registrations: LifecycleHook[] = []
  const hooks: Record<LifecyclePhase, LifecycleHook[]> = { boot: [], ready: [], shutdown: [] }

  const internals: ModuleInternals = {
    name,
    addRegistration: (registration) => {
      registrations.push(registration)
    },
    addHook: (phase, hook) => {
      hooks[phase].push(hook)
    },
  }

  const builder = {
    name,

    [MODULE]: { name, registrations, hooks } satisfies ModuleDefinition,

    commands(...definitions: AnyCommand[]) {
      registrations.push((context) => {
        for (const definition of definitions) context.commands.register(definition, name)
      })
      return builder
    },

    queries(...definitions: AnyQuery[]) {
      registrations.push((context) => {
        for (const definition of definitions) context.queries.register(definition, name)
      })
      return builder
    },

    provide<T>(key: Token<T>, factory: Factory<T>) {
      registrations.push((context) => {
        context.container.provide(key, factory)
      })
      return builder
    },

    on<K extends string>(event: K, listener: (payload: PayloadOf<K>) => void | Promise<void>) {
      registrations.push((context) => {
        context.events.on(event, listener)
      })
      return builder
    },

    boot(hook: LifecycleHook) {
      hooks.boot.push(hook)
      return builder
    },

    ready(hook: LifecycleHook) {
      hooks.ready.push(hook)
      return builder
    },

    shutdown(hook: LifecycleHook) {
      hooks.shutdown.push(hook)
      return builder
    },
  } as ModuleBuilder

  // Methods contributed by packages above core, e.g. `.models()` from @assemora/data.
  for (const [facetName, apply] of facets) {
    Object.defineProperty(builder, facetName, {
      enumerable: false,
      value: (...args: unknown[]) => {
        apply(internals, args)
        return builder
      },
    })
  }

  return builder
}
