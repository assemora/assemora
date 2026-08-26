/**
 * Application lifecycle (SPEC.md §11, §13).
 *
 * The application wires the container, the buses and the registry, registers its
 * modules and then walks them through boot, ready and shutdown.
 */
import { type CommandBus, createCommandBus } from './commands.js'
import { type Container, createContainer } from './container.js'
import { type AssemoraContext, type ContextInit, createContext, runInContext } from './context.js'
import { ConfigurationError } from './errors.js'
import { createEventBus, type EventBus } from './events.js'
import { createLogger, type Logger, silentWriter } from './logger.js'
import { type LifecyclePhase, MODULE, type ModuleBuilder, type ModuleContext } from './module.js'
import {
  type AuditPort,
  type AuthorizationPort,
  denyAll,
  discardAudit,
  discardRevisions,
  type RevisionPort,
  type TransactionPort,
  withoutTransactions,
} from './ports.js'
import { createQueryBus, type QueryBus } from './queries.js'
import { createSchemaRegistry, type SchemaRegistry } from './registry.js'

export type ApplicationOptions = {
  readonly modules?: readonly ModuleBuilder[]
  /**
   * Defaults to `denyAll()`. An application without a policy provider refuses every
   * command rather than silently running unauthorized (SPEC.md §85).
   */
  readonly authorization?: AuthorizationPort
  readonly transactions?: TransactionPort
  readonly revisions?: RevisionPort
  readonly audit?: AuditPort
  readonly logger?: Logger
}

export type Application = {
  readonly container: Container
  readonly commands: CommandBus
  readonly queries: QueryBus
  readonly events: EventBus
  readonly registry: SchemaRegistry
  readonly logger: Logger
  readonly modules: readonly string[]
  boot(): Promise<Application>
  shutdown(): Promise<void>
  /** Runs an operation inside a fresh context (SPEC.md §12). */
  run<T>(init: ContextInit, operation: () => Promise<T>): Promise<T>
  /** The context an operation would get, without running one. */
  contextFor(init: ContextInit): AssemoraContext
}

export const createApplication = (options: ApplicationOptions = {}): Application => {
  const logger = options.logger ?? createLogger(silentWriter)
  const container = createContainer()
  const registry = createSchemaRegistry()
  const events = createEventBus(logger)

  const authorization = options.authorization ?? denyAll()
  // One audit port for both buses: a read and a write belong in the same log.
  const audit = options.audit ?? discardAudit()

  const queries = createQueryBus({ authorization, registry, logger, audit })

  const commands = createCommandBus({
    authorization,
    transactions: options.transactions ?? withoutTransactions(),
    revisions: options.revisions ?? discardRevisions(),
    audit,
    events,
    registry,
    logger,
  })

  const modules = options.modules ?? []
  const names = new Set<string>()

  for (const candidate of modules) {
    if (names.has(candidate.name)) {
      throw new ConfigurationError(`Module "${candidate.name}" is registered twice`)
    }
    names.add(candidate.name)
  }

  const contextFor = (module: string): ModuleContext => ({
    container,
    commands,
    queries,
    events,
    registry,
    logger: logger.child({ module }),
    module,
  })

  let phase: 'created' | 'booted' | 'stopped' = 'created'

  // Registration happens immediately: a module's commands must be discoverable
  // before anything boots, so introspection and wiring see a complete picture.
  for (const candidate of modules) {
    for (const register of candidate[MODULE].registrations) {
      const result = register(contextFor(candidate.name))
      if (result instanceof Promise) {
        throw new ConfigurationError(
          `Module "${candidate.name}" registered asynchronously; use boot() for async work`,
        )
      }
    }
  }

  const runPhase = async (name: LifecyclePhase, order: readonly ModuleBuilder[]): Promise<void> => {
    for (const candidate of order) {
      for (const hook of candidate[MODULE].hooks[name]) {
        await hook(contextFor(candidate.name))
      }
    }
  }

  const application: Application = {
    container,
    commands,
    queries,
    events,
    registry,
    logger,
    modules: [...names],

    async boot() {
      if (phase !== 'created') {
        throw new ConfigurationError('The application has already been booted')
      }

      await runPhase('boot', modules)
      await runPhase('ready', modules)
      phase = 'booted'
      logger.info('Application ready', { modules: modules.length })

      return application
    },

    async shutdown() {
      if (phase === 'stopped') return

      await runPhase('shutdown', [...modules].reverse())
      phase = 'stopped'
      logger.info('Application stopped')
    },

    run(init, operation) {
      return runInContext(createContext(init), operation)
    },

    contextFor(init) {
      return createContext(init)
    },
  }

  return application
}
