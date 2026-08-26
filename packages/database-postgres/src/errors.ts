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

type DriverError = {
  readonly code?: string
  readonly constraint?: string
  readonly table?: string
  readonly column?: string
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
    return new AssemoraError('DATABASE_ERROR', 'The database rejected the operation', {
      status: 500,
      cause: redact(error),
    })
  }

  const details = detailsOf(driver)

  switch (driver.code) {
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
