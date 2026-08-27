/**
 * Every framework and application error shares one shape, so Studio, the SDK and
 * REST receive the same semantics (SPEC.md §83, §84).
 */
import type { Issue } from '@assemora/schema'

export type ErrorPayload = {
  readonly error: {
    readonly code: string
    readonly message: string
    readonly details?: unknown
    readonly fields?: Readonly<Record<string, readonly string[]>>
    readonly requestId?: string
  }
}

export class AssemoraError extends Error {
  readonly code: string
  readonly status: number
  readonly details: unknown

  constructor(
    code: string,
    message: string,
    options: { status?: number; details?: unknown; cause?: unknown } = {},
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause })
    this.name = new.target.name
    this.code = code
    this.status = options.status ?? 500
    this.details = options.details
  }

  toPayload(requestId?: string): ErrorPayload {
    return {
      error: {
        code: this.code,
        message: this.message,
        ...(this.details === undefined ? {} : { details: this.details }),
        ...(requestId === undefined ? {} : { requestId }),
      },
    }
  }
}

/**
 * Groups issues by the field they belong to, as SPEC.md §84 requires.
 *
 * Accumulated in a `Map` rather than an object literal, because the key is a *field
 * path* and field names are chosen by whoever sends the data — a form input, a
 * collection made in Studio, an agent. `fields['constructor']` on a plain object is a
 * function rather than `undefined`, so the "have I seen this key" test read yes, and
 * grouping two issues under `constructor`, `toString` or `valueOf` threw a `TypeError`
 * out of the constructor of the error being built. A 422 turned into an unhandled 500,
 * on the path whose entire job is to report a caller's mistake.
 */
const toFields = (issues: readonly Issue[]): Record<string, string[]> => {
  const fields = new Map<string, string[]>()

  for (const issue of issues) {
    const key = issue.path.length > 0 ? issue.path.join('.') : '_'
    const bucket = fields.get(key)

    if (bucket === undefined) fields.set(key, [issue.message])
    else bucket.push(issue.message)
  }

  return Object.fromEntries(fields)
}

export class ValidationError extends AssemoraError {
  readonly issues: readonly Issue[]
  readonly fields: Readonly<Record<string, readonly string[]>>

  constructor(issues: readonly Issue[], message = 'Validation failed') {
    super('VALIDATION_ERROR', message, { status: 422 })
    this.issues = issues
    this.fields = toFields(issues)
  }

  override toPayload(requestId?: string): ErrorPayload {
    return {
      error: {
        code: this.code,
        message: this.message,
        fields: this.fields,
        ...(requestId === undefined ? {} : { requestId }),
      },
    }
  }
}

export class NotFoundError extends AssemoraError {
  constructor(entity: string, id?: string) {
    super(
      `${entity.toUpperCase()}_NOT_FOUND`,
      id === undefined ? `${entity} was not found` : `${entity} ${id} was not found`,
      { status: 404 },
    )
  }
}

export class ForbiddenError extends AssemoraError {
  constructor(message = 'This action is not allowed', details?: unknown) {
    super('FORBIDDEN', message, { status: 403, details })
  }
}

/** Raised when a mutation targets a version that is no longer current (SPEC.md §66). */
export class ConflictError extends AssemoraError {
  constructor(message = 'The entity was modified by someone else', details?: unknown) {
    super('CONFLICT', message, { status: 409, details })
  }
}

export class UnknownCommandError extends AssemoraError {
  constructor(name: string) {
    super('UNKNOWN_COMMAND', `Command "${name}" is not registered`, { status: 404 })
  }
}

export class UnknownQueryError extends AssemoraError {
  constructor(name: string) {
    super('UNKNOWN_QUERY', `Query "${name}" is not registered`, { status: 404 })
  }
}

/**
 * Raised when a queue hands back work nothing declares (SPEC.md §82).
 *
 * Usually a job that was renamed or removed while older ones were still in the
 * queue, which is why the worker refuses loudly rather than dropping the payload.
 */
export class UnknownJobError extends AssemoraError {
  constructor(name: string) {
    super('UNKNOWN_JOB', `Job "${name}" is not registered`, { status: 404 })
  }
}

export class ConfigurationError extends AssemoraError {
  constructor(message: string) {
    super('CONFIGURATION_ERROR', message, { status: 500 })
  }
}
