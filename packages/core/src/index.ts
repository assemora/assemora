/**
 * `@assemora/core` — the application kernel.
 *
 * Core owns the single mutation path (SPEC.md §2) and knows nothing about HTTP or a
 * database. Where a stage of that path needs a layer above core — authorization,
 * transactions, revisions, audit — core owns the interface and the other package
 * registers an implementation.
 */

export { type Application, type ApplicationOptions, createApplication } from './application.js'
export {
  type AnyCommand,
  type ChangedEntity,
  type CommandBus,
  type CommandBusOptions,
  type CommandContext,
  type CommandDefinition,
  command,
  createCommandBus,
  type Preview,
} from './commands.js'
export {
  type Container,
  createContainer,
  type Factory,
  type Token,
  token,
} from './container.js'
export {
  type Actor,
  type ActorType,
  type AssemoraContext,
  type ContextInit,
  type ContextSource,
  contextOrInternal,
  createContext,
  currentContext,
  runInContext,
} from './context.js'
export {
  AssemoraError,
  ConfigurationError,
  ConflictError,
  type ErrorPayload,
  ForbiddenError,
  NotFoundError,
  UnknownCommandError,
  UnknownQueryError,
  ValidationError,
} from './errors.js'
export {
  type AssemoraEventPayloads,
  createEventBus,
  type EventBus,
  type PayloadOf,
  type Unsubscribe,
} from './events.js'
export {
  createLogger,
  type LogFields,
  type Logger,
  type LogLevel,
  type LogRecord,
  type LogWriter,
  silentWriter,
  writeToConsole,
} from './logger.js'
export {
  clearModuleFacets,
  defineModuleFacet,
  type LifecycleHook,
  type LifecyclePhase,
  MODULE,
  type ModuleBuilder,
  type ModuleContext,
  type ModuleDefinition,
  type ModuleFacet,
  type ModuleInternals,
  module,
} from './module.js'
export {
  type AuditEntry,
  type AuditPort,
  type AuthorizationPort,
  type AuthorizationRequest,
  clearRestorers,
  collectAudit,
  collectRevisions,
  denyAll,
  discardAudit,
  discardRevisions,
  permitAll,
  type RecordAuthorizationRequest,
  type RestoreResult,
  type Restorer,
  type RevisionDraft,
  type RevisionEntry,
  type RevisionPort,
  registerRestorer,
  restorerFor,
  type TransactionOptions,
  type TransactionPort,
  withoutTransactions,
} from './ports.js'
export {
  type AnyQuery,
  createQueryBus,
  type QueryBus,
  type QueryBusOptions,
  type QueryContext,
  type QueryDefinition,
  type QueryDescriptor,
  query,
} from './queries.js'
export {
  type CommandDescriptor,
  createSchemaRegistry,
  type RegistryEntry,
  type RegistrySections,
  type SchemaRegistry,
  type SectionName,
} from './registry.js'
