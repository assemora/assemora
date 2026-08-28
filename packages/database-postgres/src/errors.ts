/**
 * Driver errors turned into the Assemora error model (SPEC.md §83, §85).
 *
 * A raw driver error carries the failing statement and its parameter values in its
 * message. Those values are user data — an email, a token, a password hash — and
 * they must not travel into logs or responses, so nothing of the statement survives
 * this translation. The constraint name does: it is safe and it is the one detail
 * that makes the failure actionable.
 */
import { AssemoraError } from '@assemora/core'
import { schemaNotApplied } from '@assemora/database'

type DriverError = {
  readonly code?: string
  readonly constraint?: string
  readonly table?: string
  readonly column?: string
  /**
   * The server's own sentence, which for the two failures below is the only place the
   * identifier appears — PostgreSQL sets `table` on a constraint violation and on
   * nothing else. It is never the statement and never a parameter: the wrapper that
   * carries those is a level up, and `redact` is what deals with it.
   */
  readonly message?: string
}

/**
 * A SQLSTATE is exactly five characters. Matching on the shape rather than on the
 * mere presence of a `code` keeps errors that carry an unrelated code — an
 * `AssemoraError`, a Node system error — from being mistaken for driver failures.
 */
const SQLSTATE = /^[0-9A-Z]{5}$/

const driverErrorOf = (error: unknown): DriverError | undefined => {
  if (error instanceof AssemoraError) return undefined

  for (let candidate: unknown = error; candidate !== undefined && candidate !== null; ) {
    const shape = candidate as DriverError & { cause?: unknown }

    if (typeof shape.code === 'string' && SQLSTATE.test(shape.code)) return shape

    candidate = shape.cause
  }

  return undefined
}

/**
 * The driver's message reads `Failed query: <sql>\nparams: <values>`.
 *
 * The statement is useful when something breaks; the values are user data — an
 * email, a token, a password hash — and they must not travel in a cause chain that
 * a logger will happily print (SPEC.md §85).
 */
const redact = (error: unknown): Error | undefined => {
  if (!(error instanceof Error)) return undefined

  const [statement] = error.message.split('\nparams:')

  return new Error(statement ?? error.message)
}

/**
 * The identifier out of `relation "x" does not exist` and `database "x" does not exist`.
 *
 * PostgreSQL puts it nowhere else on those two errors, and it is the whole difference
 * between a message somebody can act on and "The database rejected the operation". It
 * is safe to repeat: a table name is a schema identifier, the same class as the
 * constraint and column names `detailsOf` already carries, and never user data.
 */
const quotedIdentifier = (message: string | undefined): string | undefined =>
  /"([^"]+)"/.exec(message ?? '')?.[1]

/**
 * Node's own errno codes for a database that never answered at all.
 *
 * No server replied, so there is no SQLSTATE and `driverErrorOf` cannot see them —
 * which left a refused connection arriving as "The database rejected the operation",
 * the one thing it did not do. A five-character SQLSTATE and an errno are told apart
 * by shape, so the two lookups cannot collide.
 */
const UNREACHABLE: ReadonlySet<string> = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'ENOTFOUND',
  'ETIMEDOUT',
  'EAI_AGAIN',
])

const unreachableCode = (error: unknown): string | undefined => {
  for (let candidate: unknown = error; candidate !== undefined && candidate !== null; ) {
    const shape = candidate as { code?: unknown; cause?: unknown }

    if (typeof shape.code === 'string' && UNREACHABLE.has(shape.code)) return shape.code

    candidate = shape.cause
  }

  return undefined
}

const detailsOf = (driver: DriverError): Record<string, string> => ({
  ...(driver.constraint === undefined ? {} : { constraint: driver.constraint }),
  ...(driver.table === undefined ? {} : { table: driver.table }),
  ...(driver.column === undefined ? {} : { column: driver.column }),
})

/**
 * Whether the failure came from the driver at all.
 *
 * A transaction runs the caller's own code, and an error thrown there must reach
 * them unchanged rather than being relabelled as a database failure.
 */
export const isDriverError = (error: unknown): boolean => driverErrorOf(error) !== undefined

/** Maps a PostgreSQL error into the shape every Assemora caller already handles. */
export const toAssemoraError = (error: unknown): AssemoraError => {
  if (error instanceof AssemoraError) return error

  const driver = driverErrorOf(error)

  if (driver === undefined) {
    const unreachable = unreachableCode(error)

    if (unreachable !== undefined) {
      return new AssemoraError(
        'DATABASE_UNREACHABLE',
        'The database did not answer. Check that it is running and that DATABASE_URL points at it.',
        { status: 503, details: { code: unreachable }, cause: redact(error) },
      )
    }

    return new AssemoraError('DATABASE_ERROR', 'The database rejected the operation', {
      status: 500,
      cause: redact(error),
    })
  }

  const details = detailsOf(driver)
  const named = quotedIdentifier(driver.message)

  switch (driver.code) {
    // `undefined_table`. The one refusal a caller above may survive, so it carries a
    // code of its own and the adapter contract names it (`@assemora/database`).
    case '42P01':
      return schemaNotApplied(named ?? driver.table, redact(error))
    // `invalid_catalog_name`: the server is there, the database in the URL is not.
    // Not a schema that is merely unapplied — no migration creates a database — so it
    // must never be mistaken for one.
    case '3D000':
      return new AssemoraError(
        'DATABASE_NOT_FOUND',
        `The database ${named === undefined ? 'named in DATABASE_URL' : `"${named}"`} does not exist on that server. Create it, then run "assemora db:migrate".`,
        {
          status: 503,
          details: { ...details, ...(named === undefined ? {} : { database: named }) },
          cause: redact(error),
        },
      )
    // `invalid_authorization_specification` and `invalid_password`.
    case '28000':
    case '28P01':
      return new AssemoraError(
        'DATABASE_UNAUTHORIZED',
        'The database refused these credentials. Check the user and password in DATABASE_URL.',
        { status: 503, details, cause: redact(error) },
      )
    // `insufficient_privilege`: connected, authenticated, and not allowed to do this.
    case '42501':
      return new AssemoraError(
        'DATABASE_FORBIDDEN',
        'The database user is not allowed to do that. Grant it the missing privilege.',
        { status: 503, details, cause: redact(error) },
      )
    case '23505':
      return new AssemoraError('UNIQUE_VIOLATION', 'A record with these values already exists', {
        status: 409,
        details,
        cause: redact(error),
      })
    case '23503':
      return new AssemoraError('FOREIGN_KEY_VIOLATION', 'A referenced record does not exist', {
        status: 409,
        details,
        cause: redact(error),
      })
    case '23502':
      return new AssemoraError('NOT_NULL_VIOLATION', 'A required value is missing', {
        status: 422,
        details,
        cause: redact(error),
      })
    case '23514':
      return new AssemoraError('CHECK_VIOLATION', 'A value is outside the allowed set', {
        status: 422,
        details,
        cause: redact(error),
      })
    case '22P02':
    case '22003':
      return new AssemoraError('INVALID_VALUE', 'A value has the wrong format for its column', {
        status: 422,
        details,
        cause: redact(error),
      })
    case '40001':
    case '40P01':
      return new AssemoraError('SERIALIZATION_FAILURE', 'The transaction conflicted, retry it', {
        status: 409,
        details,
        cause: redact(error),
      })
    default:
      return new AssemoraError('DATABASE_ERROR', 'The database rejected the operation', {
        status: 500,
        details: { ...details, code: driver.code ?? 'unknown' },
        cause: redact(error),
      })
  }
}
