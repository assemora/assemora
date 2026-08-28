import { AssemoraError } from '@assemora/core'
import { isSchemaNotApplied } from '@assemora/database'
import { describe, expect, it } from 'vitest'

import { isDriverError, toAssemoraError } from './errors.js'

/** What the driver actually throws: a wrapper whose `cause` carries the SQLSTATE. */
const driverFailure = (
  code: string,
  extra: Record<string, string> = {},
  // PostgreSQL names the table only in its own sentence, never in a field, so the
  // server's message is part of what the driver hands over.
  message = 'duplicate key value',
) =>
  Object.assign(
    new Error('Failed query: insert into "users" ("email") values ($1)\nparams: ada@x.io'),
    { cause: Object.assign(new Error(message), { code, ...extra }) },
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

/**
 * The five ways a database says no that all used to arrive as one 500.
 *
 * An application must be able to boot against a schema that is not applied yet, so
 * exactly one of them has to be survivable — and the rest must not be, or a boot hook
 * tolerating the first would swallow a database that is simply not there.
 */
describe('a missing table, apart from a database that refused you', () => {
  it('maps undefined_table to the code the adapter contract names', () => {
    const mapped = toAssemoraError(
      driverFailure('42P01', {}, 'relation "assemora_resource_definitions" does not exist'),
    )

    expect(mapped.code).toBe('SCHEMA_NOT_APPLIED')
    expect(mapped.status).toBe(503)
    expect(mapped.details).toEqual({ table: 'assemora_resource_definitions' })
    // The sentence a person hits on a fresh database. It used to be "The database
    // rejected the operation", which named neither the table nor the way out.
    expect(mapped.message).toContain('assemora_resource_definitions')
    expect(mapped.message).toContain('assemora db:migrate')
  })

  it('says which database is missing rather than which table', () => {
    const mapped = toAssemoraError(
      driverFailure('3D000', {}, 'database "my_project" does not exist'),
    )

    expect(mapped.code).toBe('DATABASE_NOT_FOUND')
    expect(mapped.status).toBe(503)
    expect(mapped.details).toMatchObject({ database: 'my_project' })
    // No migration creates a database, so this must never read as one waiting to run.
    expect(mapped.message).toContain('Create it')
  })

  it('separates credentials the server refused from a privilege never granted', () => {
    expect(toAssemoraError(driverFailure('28P01')).code).toBe('DATABASE_UNAUTHORIZED')
    expect(toAssemoraError(driverFailure('28000')).code).toBe('DATABASE_UNAUTHORIZED')
    expect(toAssemoraError(driverFailure('42501')).code).toBe('DATABASE_FORBIDDEN')
  })

  it('recognises a connection nothing answered, which carries no SQLSTATE', () => {
    // What `pg` throws when the port is closed: an AggregateError with an errno, and
    // no server ever replied to give it a SQLSTATE. It reached the generic branch
    // before, and "the database rejected the operation" is the one thing it did not do.
    const refused = Object.assign(new AggregateError([], ''), { code: 'ECONNREFUSED' })
    const mapped = toAssemoraError(refused)

    expect(mapped.code).toBe('DATABASE_UNREACHABLE')
    expect(mapped.status).toBe(503)
    expect(mapped.details).toEqual({ code: 'ECONNREFUSED' })
  })

  it('is the only one of them a caller may survive', () => {
    const others = ['3D000', '28P01', '28000', '42501', '23505', '42883']

    expect(isSchemaNotApplied(toAssemoraError(driverFailure('42P01')))).toBe(true)
    for (const code of others) {
      expect(isSchemaNotApplied(toAssemoraError(driverFailure(code)))).toBe(false)
    }
    expect(
      isSchemaNotApplied(toAssemoraError(Object.assign(new Error(''), { code: 'ECONNREFUSED' }))),
    ).toBe(false)
  })

  it('still carries no statement and no parameter values', () => {
    const mapped = toAssemoraError(
      driverFailure('42P01', {}, 'relation "assemora_users" does not exist'),
    )

    expect(mapped.message).not.toContain('insert into')
    expect(mapped.message).not.toContain('ada@x.io')
    expect((mapped.cause as Error).message).not.toContain('params:')
  })
})
