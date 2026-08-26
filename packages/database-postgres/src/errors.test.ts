import { AssemoraError } from '@assemora/core'
import { describe, expect, it } from 'vitest'

import { isDriverError, toAssemoraError } from './errors.js'

/** What the driver actually throws: a wrapper whose `cause` carries the SQLSTATE. */
const driverFailure = (code: string, extra: Record<string, string> = {}) =>
  Object.assign(
    new Error('Failed query: insert into "users" ("email") values ($1)\nparams: ada@x.io'),
    { cause: Object.assign(new Error('duplicate key value'), { code, ...extra }) },
  )

describe('driver errors', () => {
  it('maps every SQLSTATE it knows to a stable code and status', () => {
    const cases: [string, string, number][] = [
      ['23505', 'UNIQUE_VIOLATION', 409],
      ['23503', 'FOREIGN_KEY_VIOLATION', 409],
      ['23502', 'NOT_NULL_VIOLATION', 422],
      ['23514', 'CHECK_VIOLATION', 422],
      ['22P02', 'INVALID_VALUE', 422],
      ['40001', 'SERIALIZATION_FAILURE', 409],
    ]

    for (const [sqlState, code, status] of cases) {
      const mapped = toAssemoraError(driverFailure(sqlState))

      expect(mapped.code).toBe(code)
      expect(mapped.status).toBe(status)
    }
  })

  it('keeps the constraint, table and column, which are safe and useful', () => {
    const mapped = toAssemoraError(
      driverFailure('23505', { constraint: 'users_email_unique', table: 'users', column: 'email' }),
    )

    expect(mapped.details).toEqual({
      constraint: 'users_email_unique',
      table: 'users',
      column: 'email',
    })
  })

  it('never carries the statement or its parameters into the message', () => {
    const mapped = toAssemoraError(driverFailure('23505'))

    expect(mapped.message).toBe('A record with these values already exists')
    expect(mapped.message).not.toContain('insert into')
    expect(mapped.message).not.toContain('ada@x.io')
  })

  it('keeps the statement in the cause but never the parameter values', () => {
    const mapped = toAssemoraError(driverFailure('23505'))
    const cause = mapped.cause as Error

    expect(cause).toBeInstanceOf(Error)
    expect(cause.message).toContain('insert into "users"')
    expect(cause.message).not.toContain('params:')
    expect(cause.message).not.toContain('ada@x.io')
  })

  it('falls back to a generic database error, keeping the code for diagnosis', () => {
    const mapped = toAssemoraError(driverFailure('42883'))

    expect(mapped.code).toBe('DATABASE_ERROR')
    expect(mapped.status).toBe(500)
    expect(mapped.details).toMatchObject({ code: '42883' })
  })

  it('passes an Assemora error through untouched', () => {
    const original = new AssemoraError('UNKNOWN_FIELD', 'No column is mapped', { status: 500 })

    expect(toAssemoraError(original)).toBe(original)
  })

  it('tells a driver failure apart from an error the caller threw', () => {
    expect(isDriverError(driverFailure('23505'))).toBe(true)
    expect(isDriverError(new Error('no good'))).toBe(false)
    expect(isDriverError(new AssemoraError('X', 'x'))).toBe(false)
  })

  it('handles an error that carries no SQLSTATE at all', () => {
    const mapped = toAssemoraError(new Error('connection refused'))

    expect(mapped.code).toBe('DATABASE_ERROR')
    expect(mapped.message).toBe('The database rejected the operation')
  })
})
