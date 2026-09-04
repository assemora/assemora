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
import type { AnyJob, JobBus } from './jobs.js'
import type { Logger } from './logger.js'
import type { AnyQuery, QueryBus } from './queries.js'
import type { SchemaRegistry } from './registry.js'
import { type SettingsGroupDescriptor, settingsGroup } from './settings.js'

/**
 * A module that booted and is not running, and why (SPEC.md §88).
 *
 * `reason` and `remedy` are sentences the module wrote, never a message it caught. A
 * readiness answer is served to whoever can reach the probe, and a raw driver failure
 * carries a host, a user and sometimes a query.
 */
export type NotStarted = {
  readonly module: string
  readonly reason: string
  /** What a person should do about it, when there is one thing to do. */
  readonly remedy?: string
}

export type ModuleContext = {
  readonly container: Container
  readonly commands: CommandBus
  readonly queries: QueryBus
  readonly jobs: JobBus
  readonly events: EventBus
  readonly registry: SchemaRegistry
  readonly logger: Logger
  readonly module: string
  /**
   * Says this module is registered but not running, and why (SPEC.md §88).
   *
   * For a boot hook that survived something it could not do its job without: the
   * application goes on, because what to do next depends on why it was booted and a
   * hook is the one place that cannot know — `assemora db:generate` boots to read a
   * registry it can read anyway, while a server that reported ready would be handed
   * production traffic it can only refuse. The fact reaches that decision through
   * `Application.notStarted`.
   *
   * ```ts
   * module('search').boot(async (context) => {
   *   if (!(await index.exists())) {
   *     context.cannotStart('The search index has not been built.', {
   *       remedy: 'Run assemora search:reindex.',
   *     })
   *   }
   * })
   * ```
   *
   * A module that cannot work *and* has nothing to offer a caller who does not need
   * it should throw instead. This is for the middle case, which is the common one.
   */
  cannotStart(reason: string, details?: { readonly remedy?: string }): void
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
  /** Durable work the module can schedule (SPEC.md §82). */
  jobs(...definitions: AnyJob[]): ModuleBuilder
  /**
   * What this module wants the settings screen to say about it (ADR-0031).
   *
   * A group written out is checked where it is written and registered with the
   * module. A group given as a function is called at boot, for the module whose
   * values are not known until then — which storage driver it was handed, what
   * ceiling — and is checked the moment it is.
   */
  settings(...groups: (SettingsGroupDescriptor | (() => SettingsGroupDescriptor))[]): ModuleBuilder
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

    // A method rather than a facet, because a job is a thing core knows about. Facets
    // exist so that core need not learn what a model or a resource is (ADR-0009), and
    // `job()` lives here beside `command()` and `query()`.
    jobs(...definitions: AnyJob[]) {
      registrations.push((context) => {
        for (const definition of definitions) context.jobs.register(definition, name)
      })
      return builder
    },

    // Checked when the module is *built* rather than when it registers: a group that
    // cannot be drawn is a mistake in the file the author has open, and the stack that
    // says so should end there rather than in `boot()`.
    settings(...groups: (SettingsGroupDescriptor | (() => SettingsGroupDescriptor))[]) {
      for (const group of groups) {
        if (typeof group === 'function') {
          hooks.boot.push((context) => {
            context.registry.register('settings', settingsGroup(group()))
          })
          continue
        }

        const checked = settingsGroup(group)

        registrations.push((context) => {
          context.registry.register('settings', checked)
        })
      }
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
