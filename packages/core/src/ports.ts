/**
 * The seams where `core` meets layers that sit above it.
 *
 * SPEC.md §8 forbids `core` from depending on `auth`, `revisions` or a database
 * package, yet SPEC.md §14 puts authorization, transactions, revisions and audit
 * inside the command pipeline. Core therefore owns the interfaces and those packages
 * register implementations — the check stays in the mutation path and cannot be
 * bypassed (see docs/architecture/package-graph.md).
 */
import type { AssemoraContext } from './context.js'
import { ConfigurationError, ForbiddenError } from './errors.js'

// --- authorization -----------------------------------------------------------

export type AuthorizationRequest = {
  readonly command: string
  readonly input: unknown
  readonly context: AssemoraContext
}

/**
 * A check that needs the record itself (SPEC.md §51).
 *
 * `update: ({ actor, article }) => actor.id === article.authorId` cannot be answered
 * before the row is loaded, so the command loads it, asks, and only then writes.
 */
export type RecordAuthorizationRequest = {
  /** What is being acted on: a resource name, a page, a media item. */
  readonly subject: string
  readonly action: string
  readonly record: unknown
  readonly context: AssemoraContext
}

export type AuthorizationPort = {
  /** Resolves when the actor may run the command; throws `ForbiddenError` otherwise. */
  authorize(request: AuthorizationRequest): Promise<void>
  /**
   * Resolves when the actor may act on this particular record. Optional: a provider
   * with no record-level rules simply does not implement it.
   */
  authorizeRecord?(request: RecordAuthorizationRequest): Promise<void>
}

/**
 * The default. Nothing is permitted until a policy provider is registered, so an
 * application cannot accidentally ship with authorization missing (SPEC.md §85).
 */
export const denyAll = (): AuthorizationPort => ({
  authorize: (request) =>
    Promise.reject(
      new ForbiddenError(
        `No authorization provider is registered, so "${request.command}" is denied. Register the auth module, or pass permitAll() to run without authorization.`,
      ),
    ),
  authorizeRecord: (request) =>
    Promise.reject(
      new ForbiddenError(
        `No authorization provider is registered, so "${request.action}" on ${request.subject} is denied.`,
      ),
    ),
})

/**
 * Permits every command. Development and tests only — the name is deliberately
 * blunt so that shipping it is a visible choice rather than an oversight.
 */
export const permitAll = (): AuthorizationPort => ({
  authorize: () => Promise.resolve(),
  authorizeRecord: () => Promise.resolve(),
})

// --- transactions ------------------------------------------------------------

export type TransactionOptions = {
  /**
   * Undo everything the operation wrote, and still answer with what it returned
   * (SPEC.md §73, ADR-0019).
   *
   * A preview is the one case where the value matters and the writes do not, and
   * rejecting — the only way to undo today — throws that value away. A port that
   * cannot undo must refuse rather than commit: silently committing a preview is
   * the one outcome worse than having no previews.
   */
  readonly rollback?: boolean
}

export type TransactionPort = {
  run<T>(operation: () => Promise<T>, options?: TransactionOptions): Promise<T>
}

/**
 * Runs the operation directly. Used until a database adapter is registered.
 *
 * It refuses a rollback rather than pretending: with nothing to undo, a preview
 * would be a real mutation wearing the wrong name.
 */
export const withoutTransactions = (): TransactionPort => ({
  run: (operation, options) => {
    if (options?.rollback === true) {
      return Promise.reject(
        new ConfigurationError(
          'Nothing can be previewed without a transaction. Register a database adapter and pass dataTransactions().',
        ),
      )
    }

    return operation()
  },
})

// --- revisions ---------------------------------------------------------------

/** One reversible change, as stored by SPEC.md §64. */
export type RevisionEntry = {
  readonly entityType: string
  readonly entityId: string
  readonly command: string
  readonly before: unknown
  readonly after: unknown
  readonly actor?: AssemoraContext['actor']
  readonly requestId: string
  readonly metadata?: Readonly<Record<string, unknown>>
}

/** What a handler reports; the bus fills in command, actor and request id. */
export type RevisionDraft = {
  readonly entityType: string
  readonly entityId: string
  readonly before: unknown
  readonly after: unknown
  readonly metadata?: Readonly<Record<string, unknown>>
}

export type RevisionPort = {
  record(entries: readonly RevisionEntry[]): Promise<void>
}

export const discardRevisions = (): RevisionPort => ({
  record: () => Promise.resolve(),
})

/** Keeps revisions in memory. Useful in tests and before `@assemora/revisions` exists. */
export const collectRevisions = (): RevisionPort & { readonly entries: RevisionEntry[] } => {
  const entries: RevisionEntry[] = []

  return {
    entries,
    record: (recorded) => {
      entries.push(...recorded)
      return Promise.resolve()
    },
  }
}

/**
 * How an entity is put back (SPEC.md §65).
 *
 * `@assemora/revisions` knows what changed but not how to write it back, and
 * `@assemora/pages` cannot depend on it (SPEC.md §8). So the seam lives here, with
 * the other ports: whoever owns an entity registers how to restore it.
 */
/**
 * What a restore produced.
 *
 * `replaced` is the state the entity was actually in a moment ago, which is what the
 * revision of the restore has to record as its `before`. Nothing else can supply it:
 * the caller knows which revision it applied, not what the entity had drifted to.
 *
 * Anything else is handed back to whoever asked. A restorer with a new version number
 * should say so, because the caller's next mutation must carry it as
 * `expectedVersion` (SPEC.md §66).
 */
export type RestoreResult = Readonly<Record<string, unknown>> & {
  readonly replaced?: unknown
}

/**
 * How one entity goes back to an earlier state (SPEC.md §65, ADR-0008).
 *
 * `state` is a snapshot, or `null` for "this entity did not exist" — undoing a
 * creation and restoring a deletion are both ordinary restores, and a restorer is
 * expected to handle them.
 */
export type Restorer = (entityId: string, state: unknown) => Promise<RestoreResult | undefined>

const restorers = new Map<string, Restorer>()

export const registerRestorer = (entityType: string, restorer: Restorer): void => {
  restorers.set(entityType, restorer)
}

export const restorerFor = (entityType: string): Restorer | undefined => restorers.get(entityType)

export const clearRestorers = (): void => {
  restorers.clear()
}

// --- audit -------------------------------------------------------------------

/** Who did what, as stored by SPEC.md §67. */
export type AuditEntry = {
  readonly action: string
  readonly source: AssemoraContext['source']
  readonly requestId: string
  readonly actor?: AssemoraContext['actor']
  /**
   * `previewed` is a dry run: it ran, it was authorized, and it changed nothing
   * (SPEC.md §73). Recording it as `succeeded` would be a lie and as `failed` a
   * worse one, and §76 requires every agent action to be audited.
   */
  readonly outcome: 'succeeded' | 'failed' | 'previewed'
  readonly durationMs: number
  /**
   * What was acted on, when the command said so (SPEC.md §67).
   *
   * Taken from the revisions the command collected, so a handler does not have to
   * declare it twice. Absent when a command wrote no revision, and absent when the
   * command failed before reaching one — which is itself worth recording.
   */
  readonly entityType?: string
  readonly entityId?: string
  readonly metadata?: Readonly<Record<string, unknown>>
}

export type AuditPort = {
  record(entry: AuditEntry): Promise<void>
}

export const discardAudit = (): AuditPort => ({
  record: () => Promise.resolve(),
})

export const collectAudit = (): AuditPort & { readonly entries: AuditEntry[] } => {
  const entries: AuditEntry[] = []

  return {
    entries,
    record: (entry) => {
      entries.push(entry)
      return Promise.resolve()
    },
  }
}
