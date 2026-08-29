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
import { createJobBus, type JobBus, registerJobBus } from './jobs.js'
import { type LocaleSettings, resolveLocales } from './locales.js'
import { createLogger, type Logger, silentWriter } from './logger.js'
import {
  type LifecyclePhase,
  MODULE,
  type ModuleBuilder,
  type ModuleContext,
  type NotStarted,
} from './module.js'
import {
  type AuditPort,
  type AuthorizationPort,
  denyAll,
  discardAudit,
  discardRevisions,
  type ErrorTrackingPort,
  logErrors,
  type QueuePort,
  type RevisionPort,
  runJobsHere,
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
  /**
   * Defaults to running jobs in this process, awaited (ADR-0023). A job that vanishes
   * in development and works in production is the worst of the available defaults, so
   * an application with no queue registered still runs the work it schedules.
   */
  readonly queue?: QueuePort
  /**
   * Where an unexpected failure is reported (SPEC.md §88).
   *
   * Defaults to writing it to `logger`. Nothing is registered in most applications,
   * and a default that discarded would take the failures out of the logs that already
   * had them — the one default worse than having no port at all.
   */
  readonly errors?: ErrorTrackingPort
  readonly logger?: Logger
  /**
   * The languages this deployment serves (SPEC.md §131).
   *
   * ```ts
   * createApplication({ locales: ['uk', 'en', 'ru'], defaultLocale: 'uk' })
   * ```
   *
   * Left out, the application is in one language and nothing about it changes.
   */
  readonly locales?: readonly string[]
  /** Which of `locales` a missing translation falls back to. Defaults to the first. */
  readonly defaultLocale?: string
}

export type Application = {
  readonly container: Container
  readonly commands: CommandBus
  readonly queries: QueryBus
  readonly jobs: JobBus
  readonly events: EventBus
  readonly registry: SchemaRegistry
  readonly logger: Logger
  /** The languages this deployment serves, or `undefined` for one (SPEC.md §131). */
  readonly locales?: LocaleSettings
  readonly modules: readonly string[]
  /**
   * The modules that booted and are not running, and why (SPEC.md §88).
   *
   * Empty until something reports itself through `context.cannotStart()`, and the
   * only honest answer to "did this application actually start". Booting is not the
   * same question: a boot hook that tolerated a failure it could not work around
   * returns, so `boot()` resolves either way and this is what separates the two.
   *
   * Whoever booted decides what it means. A CLI command reading the registry can
   * ignore it; a process that serves must not report itself ready.
   */
  readonly notStarted: readonly NotStarted[]
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

  /**
   * Refused here rather than at the first query: a language set that does not make
   * sense is a deployment somebody has to fix before it serves anything, and the fifth
   * page in the wrong language is a worse place to find out.
   */
  const locales = resolveLocales(options)

  if (locales !== undefined) {
    for (const code of locales.locales) {
      registry.register('locales', { name: code, default: code === locales.defaultLocale })
    }
  }

  const authorization = options.authorization ?? denyAll()
  // One audit port for both buses: a read and a write belong in the same log.
  const audit = options.audit ?? discardAudit()
  // And one reporter, for the same reason: a read that broke and a write that broke
  // belong in the same tracker (SPEC.md §88).
  //
  // It is not exposed on the application. The composition root that wires a reporter
  // is the same one that wires the HTTP server, and it can hand the same port to
  // both — whereas an `Application` that carried its ports would be the first of them
  // to do so, for one consumer's convenience.
  const errors = options.errors ?? logErrors(logger)

  const queries = createQueryBus({ authorization, registry, logger, audit, errors })

  // The default queue runs this application's own jobs, and the bus that holds them
  // needs a queue — so the reference is closed over rather than passed. Nothing calls
  // it until something is dispatched, by which time both exist.
  const queue: QueuePort = options.queue ?? runJobsHere((queued) => jobs.run(queued))

  // One port for both buses: "after the commit" has to mean the same instant to a
  // command's batch and to a `dispatch()` that never entered one (ADR-0023).
  const transactions = options.transactions ?? withoutTransactions()

  const commands = createCommandBus({
    authorization,
    transactions,
    revisions: options.revisions ?? discardRevisions(),
    audit,
    events,
    queue,
    registry,
    logger,
    errors,
  })

  const jobs = createJobBus({
    commands,
    queries,
    events,
    container,
    queue,
    transactions,
    registry,
    logger,
  })

  // `dispatch()` and `runJob()` are free functions with no application in scope
  // (SPEC.md §82), so the application makes itself findable, the way an entity makes
  // its restorer findable.
  registerJobBus(jobs)

  const modules = options.modules ?? []
  const names = new Set<string>()

  for (const candidate of modules) {
    if (names.has(candidate.name)) {
      throw new ConfigurationError(`Module "${candidate.name}" is registered twice`)
    }
    names.add(candidate.name)
  }

  const notStarted: NotStarted[] = []

  const contextFor = (module: string): ModuleContext => ({
    container,
    commands,
    queries,
    jobs,
    events,
    registry,
    logger: logger.child({ module }),
    module,
    // Appended rather than set: two hooks of one module can each fail at something,
    // and a second reason replacing the first would hide it. The module name comes
    // from the context rather than the caller, so nothing can report on another one.
    cannotStart: (reason, details) => {
      notStarted.push({
        module,
        reason,
        ...(details?.remedy === undefined ? {} : { remedy: details.remedy }),
      })
    },
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

  /**
   * Fills in the languages the caller did not name.
   *
   * A caller that names one keeps it — a job replaying the language its actor was
   * working in, a CLI command asked for a particular one. A caller that names none gets
   * the deployment's default, so an operation is never in no language at all while the
   * application is in several.
   */
  const withLocales = (init: ContextInit): ContextInit =>
    locales === undefined
      ? init
      : {
          ...init,
          locale: init.locale ?? locales.defaultLocale,
          defaultLocale: locales.defaultLocale,
        }

  const application: Application = {
    container,
    commands,
    queries,
    jobs,
    events,
    registry,
    logger,
    modules: [...names],

    // A getter, because the list is written while the modules boot and read after
    // they have. A snapshot handed out at construction would always be empty.
    get notStarted() {
      return [...notStarted]
    },

    async boot() {
      if (phase !== 'created') {
        throw new ConfigurationError('The application has already been booted')
      }

      await runPhase('boot', modules)
      await runPhase('ready', modules)
      phase = 'booted'

      if (notStarted.length === 0) {
        logger.info('Application ready', { modules: modules.length })
      } else {
        // Warned rather than thrown. The application is up and every module that did
        // start is usable, and refusing to boot here would take `assemora db:generate`
        // down with it — the command whose whole job is to boot against a schema that
        // is not applied yet (ADR-0021). The line is deliberately not 'Application
        // ready': that string is what an operator greps for.
        logger.warn('Application booted without every module running', {
          modules: modules.length,
          notStarted,
        })
      }

      return application
    },

    async shutdown() {
      if (phase === 'stopped') return

      await runPhase('shutdown', [...modules].reverse())
      phase = 'stopped'
      logger.info('Application stopped')
    },

    ...(locales === undefined ? {} : { locales }),

    run(init, operation) {
      return runInContext(createContext(withLocales(init)), operation)
    },

    contextFor(init) {
      return createContext(withLocales(init))
    },
  }

  return application
}
