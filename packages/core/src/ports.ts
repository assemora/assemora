/**
 * The seams where `core` meets layers that sit above it.
 *
 * SPEC.md §8 forbids `core` from depending on `auth`, `revisions` or a database
 * package, yet SPEC.md §14 puts authorization, transactions, revisions and audit
 * inside the command pipeline. Core therefore owns the interfaces and those packages
 * register implementations — the check stays in the mutation path and cannot be
 * bypassed (see docs/architecture/package-graph.md).
 */
import type { Actor, AssemoraContext, ContextSource } from './context.js'
import { ConfigurationError, ForbiddenError } from './errors.js'

// --- authorization -----------------------------------------------------------

export type AuthorizationRequest = {
  readonly command: string
  /**
   * What the command said it acts on, when it said anything.
   *
   * Absent, the subject is read from the command's own name, which is the rule
   * (ADR-0015) and holds for nearly every command.
   */
  readonly subject?: string
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
  /**
   * Holds `work` until the OUTERMOST transaction commits, and drops it if that
   * transaction rolls back (SPEC.md §82, ADR-0023).
   *
   * "After the commit" is a transaction concept, not a command concept, which is
   * why it lives here. A command that pushed to a queue at the end of its own
   * `run()` would be right only when nothing else had a transaction open around it:
   * a nested command's `run` is a savepoint, and two top-level commands inside one
   * `transaction()` are two savepoints — in both cases the caller can still undo
   * everything the command wrote, long after the command believed it had committed.
   * Work registered here waits for the commit that actually makes rows durable.
   *
   * With no transaction open, "after commit" is "now": the work runs before this
   * resolves. Inside one, this resolves as soon as the work is registered, so the
   * caller has already returned by the time it runs — which is why the work has to
   * report its own failures, and why nothing that could still be refused for good
   * should be left this late (see `job()`).
   */
  afterCommit(work: () => Promise<void>): Promise<void>
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

  // There is no commit to wait for, so waiting would defer the work forever.
  afterCommit: (work) => work(),
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

// --- jobs --------------------------------------------------------------------

/**
 * One job on its way to a queue, and everything a worker needs to run it
 * (SPEC.md §82, ADR-0023).
 *
 * It is a wire format: it is serialized into a queue and read back by a process that
 * shares nothing with the one that wrote it. Every field is here because a worker
 * cannot recover it otherwise — which is also why the whole context is not. A worker
 * saw no request, so it may not claim the user agent or the locale of one.
 */
export type QueuedJob = {
  readonly name: string
  /** Validated when the job was dispatched, and validated again when it is run. */
  readonly payload: unknown
  /**
   * How many times the queue may try again after a failure.
   *
   * Declared by the job and interpreted by the adapter: what backoff means, and
   * where a job goes once it has exhausted them, is the queue's business.
   */
  readonly retries: number
  /**
   * The request that scheduled the work, kept so the click, the command, the job and
   * the commands the job runs share one id in the logs (SPEC.md §87).
   */
  readonly requestId: string
  /**
   * Whose action scheduled it. The worker restores it, so the job's own writes are
   * authorized as that person and the audit log says who (SPEC.md §67).
   */
  readonly actor?: Actor
  /**
   * What kind of caller dispatched it. The job itself runs with source `'job'`,
   * because a row written by a worker was not written by the studio click that
   * scheduled it — this is what remains of where the work came from.
   */
  readonly dispatchedFrom: ContextSource
}

export type QueuePort = {
  push(jobs: readonly QueuedJob[]): Promise<void>
}

/**
 * Runs jobs in this process, awaited. The default, until a queue adapter is
 * registered.
 *
 * It does not discard them. The other defaults discard because a missing revision is
 * an absence, while a missing job is a lie: work an application was told would happen
 * and that never did. Awaited rather than fired and forgotten, so a test is
 * deterministic and a failure is read in development instead of lost.
 *
 * It does not retry either. `retries` is a declaration addressed to a queue, and this
 * is not one; an application that needs them registers an adapter.
 *
 * A job that throws is not a push that failed. A real queue accepts the work, the
 * worker fails, and whoever dispatched it is long gone — so this behaves the same
 * way rather than teaching an application a failure mode production does not have.
 * Every job gets its turn for the same reason: one bad job cancelling the ones
 * behind it would drop work no queue would have dropped.
 */
export const runJobsHere = (run: (job: QueuedJob) => Promise<void>): QueuePort => ({
  push: async (jobs) => {
    for (const job of jobs) {
      try {
        await run(job)
      } catch {
        // Deliberately swallowed here and nowhere else: `JobBus.run` logs the failure
        // against the job that had it, which is the only report that names which job
        // of the batch went wrong.
      }
    }
  },
})

// --- audit -------------------------------------------------------------------

/** Who did what, as stored by SPEC.md §67. */
export type AuditEntry = {
  readonly action: string
  /**
   * Whether it changed anything, or only asked (SPEC.md §67).
   *
   * Both are recorded: §76 requires every MCP tool call to be audited, and half the
   * tools of §69 are reads. "Which agent read the user list" is a question an audit
   * log has to be able to answer.
   */
  readonly kind: 'command' | 'query'
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
