/**
 * The seams where `core` meets layers that sit above it.
 *
 * SPEC.md §8 forbids `core` from depending on `auth`, `revisions` or a database
 * package, yet SPEC.md §14 puts authorization, transactions, revisions and audit
 * inside the command pipeline. Core therefore owns the interfaces and those packages
 * register implementations — the check stays in the mutation path and cannot be
 * bypassed (see docs/architecture/package-graph.md).
 */
import {
  type Actor,
  type AssemoraContext,
  type ContextSource,
  contextOrInternal,
} from './context.js'
import { AssemoraError, ConfigurationError, ForbiddenError } from './errors.js'
import type { Logger } from './logger.js'
import { redactError } from './redaction.js'

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

// --- error tracking ----------------------------------------------------------

/**
 * What was running when the error was thrown (SPEC.md §88).
 *
 * The request id, the actor and the source are already ambient and travel on the
 * report; this is the part nothing else can recover. `name` is what the failure is
 * grouped by, so it is the *route's* path and never a URL — `GET /articles/:id`,
 * never `GET /articles/8f3a…`, or every occurrence is its own new issue.
 *
 * There is deliberately no `input`. A command's input is the likeliest place in the
 * whole pipeline for a secret to be sitting — `auth.login` takes a password — and a
 * report is on its way off the machine (SPEC.md §85).
 */
export type ErrorOperation = {
  /**
   * `'request'` belongs to `@assemora/http`, for a response it could not attribute
   * to the caller. A job and an event are absent because both already fail loudly on
   * their own — a job's failure reaches the queue adapter, which is what decides
   * whether to try again, and a listener's is logged where it happened.
   */
  readonly kind: 'command' | 'query' | 'request'
  readonly name: string
  /** What it was acting on, once it had got far enough to say (SPEC.md §87). */
  readonly entityType?: string
  readonly entityId?: string
  /** How long it ran before it threw (SPEC.md §87). */
  readonly durationMs?: number
}

/**
 * One incident, with everything a reporter may see and nothing else.
 *
 * `error` is rebuilt rather than forwarded: its message is the first line, scrubbed,
 * its stack is its frames, and its causes are the same again. That makes it an
 * ordinary `Error`, so `capture: ({ error }) => Sentry.captureException(error)` is
 * the whole of a real adapter, and it makes redaction a property of the port rather
 * than a promise each adapter has to keep.
 */
export type ErrorReport = {
  readonly error: Error
  /** An `AssemoraError`'s code and status; absent for anything else that was thrown. */
  readonly code?: string
  readonly status?: number
  readonly context: AssemoraContext
  readonly operation: ErrorOperation
}

/**
 * Where unexpected failures go (SPEC.md §88).
 *
 * ```ts
 * const sentry = (): ErrorTrackingPort => ({
 *   capture: async ({ error, context, operation }) => {
 *     Sentry.captureException(error, {
 *       tags: { source: context.source, [operation.kind]: operation.name },
 *       user: context.actor === undefined ? undefined : { id: context.actor.id },
 *     })
 *   },
 * })
 * ```
 *
 * Awaited like the other ports, so a reporter that batches has somewhere to put its
 * flush and a rejection cannot escape as an unhandled one — but only up to
 * `CAPTURE_CEILING_MS`, after which the failing operation goes on without it. It is
 * reached through `captureError`, never called directly: that is what decides whether
 * a failure is an incident at all, and what guarantees a reporter that is broken, or
 * merely slow, fails nothing and holds nothing up.
 */
export type ErrorTrackingPort = {
  capture(report: ErrorReport): Promise<void>
}

/**
 * The default: every incident is written to the application's own log.
 *
 * The other defaults discard, because a missing revision or a missing audit row is an
 * absence somebody chose. This one cannot: nearly every application registers no
 * reporter, and a port whose default made errors disappear would be worse than having
 * no port — the logs would be the same as before, minus the failures.
 *
 * So the floor is the structured log of SPEC.md §87, which every application already
 * has, and registering Sentry is an upgrade rather than the thing that turns error
 * reporting on.
 */
export const logErrors = (logger: Logger): ErrorTrackingPort => ({
  capture: (report) => {
    const { operation } = report

    logger.error('Unhandled failure', {
      // §87 names the field after what ran, and so do the buses' child loggers:
      // `command`, `query`, `request`.
      [operation.kind]: operation.name,
      reason: report.error.message,
      ...(report.code === undefined ? {} : { code: report.code }),
      ...(operation.entityType === undefined ? {} : { entityType: operation.entityType }),
      ...(operation.entityId === undefined ? {} : { entityId: operation.entityId }),
      ...(operation.durationMs === undefined ? {} : { durationMs: operation.durationMs }),
      ...(report.error.stack === undefined ? {} : { stack: report.error.stack }),
    })

    return Promise.resolve()
  },
})

/** Keeps reports in memory. Useful in tests, like `collectAudit`. */
export const collectErrors = (): ErrorTrackingPort & { readonly reports: ErrorReport[] } => {
  const reports: ErrorReport[] = []

  return {
    reports,
    capture: (report) => {
      reports.push(report)
      return Promise.resolve()
    },
  }
}

/**
 * Whether a failure is an incident, or the pipeline working as designed.
 *
 * The line is the status the error model already carries (SPEC.md §83), so it is
 * drawn once and not re-argued at every layer. Below 500 the caller is being told
 * something about their own request — a malformed uuid, a denial, a stale version, a
 * name nothing is registered under — and none of that is a defect. At 500 and above,
 * and for anything that is not an `AssemoraError` at all, nobody has claimed the
 * failure was the caller's, which is exactly the definition of an incident.
 *
 * Getting this wrong is only harmful in one direction: a tracker fed a page of 422s
 * hides the one 500 that mattered, and then nobody looks at it again.
 */
export const isIncident = (error: unknown): boolean =>
  !(error instanceof AssemoraError) || error.status >= 500

/** A reporter, and the log that is used when the reporter is the thing that failed. */
export type ErrorReporting = {
  readonly errors: ErrorTrackingPort
  readonly logger: Logger
}

/**
 * How long a failing operation will wait for the reporter (SPEC.md §88).
 *
 * The port stays awaited, because the alternative is worse in three ways: a report
 * nothing waits for is a report a CLI process, a job worker or a serverless
 * invocation exits before sending; a rejection nothing awaits is an unhandled one;
 * and a reporter that batches would have nowhere to put its flush. What was wrong was
 * never the await, it was that the await had no end — with a `capture` that takes
 * three seconds, one failing command over HTTP took six, and the correlated case is
 * the ordinary one: the database goes down, every request 500s, and the tracker is
 * the thing being hammered or rate-limiting. Held connections, from the failure path.
 *
 * So the wait ends and the operation goes on; the reporter is not cancelled and may
 * still deliver. Two seconds is long enough for a transport that is working and short
 * enough that a burst of failures cannot pile up behind one that is not. It is a
 * constant rather than an option because it is a floor under every application, and
 * a reporter that genuinely needs longer should take it in the background rather than
 * ask a request to hold the line.
 *
 * It also bounds the damage the reporter does to §87's own numbers: a `durationMs`
 * measured by a layer above can now be wrong by the ceiling rather than by however
 * long a tracker felt like taking.
 */
export const CAPTURE_CEILING_MS = 2_000

/** Whether `capture` answered before the ceiling. It is never cancelled, only left. */
const answeredInTime = async (capture: Promise<void>): Promise<boolean> => {
  let ceiling: ReturnType<typeof setTimeout> | undefined

  try {
    // `Promise.race` attaches a handler to `capture`, so a rejection that arrives
    // after the ceiling is already handled and cannot escape as an unhandled one.
    return await Promise.race([
      capture.then(() => true),
      new Promise<boolean>((resolve) => {
        ceiling = setTimeout(() => resolve(false), CAPTURE_CEILING_MS)
      }),
    ])
  } finally {
    clearTimeout(ceiling)
  }
}

/**
 * What is written when the reporter is not the one doing the writing: why it is out
 * of the picture, and then the incident it did not take.
 *
 * A reporter that timed out may yet deliver, so this can duplicate an issue. That is
 * the deliberate direction: a duplicate costs a line, and the alternative is losing
 * the incident to the one component that was installed to catch it.
 */
const reportWithoutIt = async (
  reporting: ErrorReporting,
  report: ErrorReport,
  message: string,
  reason: string,
): Promise<void> => {
  try {
    reporting.logger.error(message, {
      [report.operation.kind]: report.operation.name,
      reason,
    })

    await logErrors(reporting.logger).capture(report)
  } catch {
    // There is nothing underneath the log. Losing the report is the only option left
    // that does not turn a broken reporter into a failed request.
  }
}

/**
 * Reports an incident, and never fails the operation it was reporting on.
 *
 * The one way to reach an `ErrorTrackingPort`, so that the two decisions nobody
 * should have to make twice — is this an incident, and what may it carry — are made
 * in one place for the command pipeline, the Query Bus and the HTTP layer alike.
 *
 * ```ts
 * await captureError(reporting, error, { kind: 'command', name: 'pages.publish' })
 * ```
 *
 * A caller's mistake resolves having done nothing, so a `catch` can hand it whatever
 * it caught without sorting the outcomes first. Neither does it hold the operation up
 * for longer than `CAPTURE_CEILING_MS`, however long the reporter takes.
 */
export const captureError = async (
  reporting: ErrorReporting,
  error: unknown,
  operation: ErrorOperation,
): Promise<void> => {
  if (!isIncident(error)) return

  const report: ErrorReport = {
    error: redactError(error),
    ...(error instanceof AssemoraError ? { code: error.code, status: error.status } : {}),
    // Read here rather than passed: the context is ambient (SPEC.md §12), and a
    // reporter that batches has left the async context by the time it flushes, so it
    // must not be the one to look.
    context: contextOrInternal(),
    operation,
  }

  try {
    if (await answeredInTime(reporting.errors.capture(report))) return
  } catch (failure) {
    await reportWithoutIt(
      reporting,
      report,
      'The error reporter failed',
      redactError(failure).message,
    )

    return
  }

  await reportWithoutIt(
    reporting,
    report,
    'The error reporter timed out',
    `It had not answered after ${CAPTURE_CEILING_MS}ms, so the operation stopped waiting for it.`,
  )
}
