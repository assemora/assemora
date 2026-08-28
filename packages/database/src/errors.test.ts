import { AssemoraError } from '@assemora/core'
import { describe, expect, it } from 'vitest'

import { isSchemaNotApplied, SCHEMA_NOT_APPLIED, schemaNotApplied } from './errors.js'

describe('a table that does not exist yet', () => {
  it('names the table and the command that creates it', () => {
    const error = schemaNotApplied('assemora_resource_definitions')

    expect(error.code).toBe(SCHEMA_NOT_APPLIED)
    expect(error.message).toContain('assemora_resource_definitions')
    // The whole point of a code of its own: "The database rejected the operation"
    // told a person nothing, and this is the sentence that replaces it.
    expect(error.message).toContain('assemora db:migrate')
    expect(error.details).toEqual({ table: 'assemora_resource_definitions' })
  })

  it('still says what to do when the adapter could not name the table', () => {
    const error = schemaNotApplied(undefined)

    expect(error.message).toContain('assemora db:migrate')
    expect(error.details).toBeUndefined()
  })

  it('is 503, because the deployment is unfinished rather than the request wrong', () => {
    // And 503 is at or above 500, so SPEC.md §88 still reports it as an incident.
    expect(schemaNotApplied('users').status).toBe(503)
  })

  it('keeps the cause it was given, so the driver failure is not lost', () => {
    const cause = new Error('relation "users" does not exist')

    expect(schemaNotApplied('users', cause).cause).toBe(cause)
  })
})

describe('telling it apart from everything else', () => {
  it('recognises what the constructor built', () => {
    expect(isSchemaNotApplied(schemaNotApplied('users'))).toBe(true)
  })

  it('refuses every other way a database can say no', () => {
    // The list this has to separate is the one a boot hook would otherwise swallow:
    // a refused connection, an absent database, a privilege never granted.
    for (const code of [
      'DATABASE_UNREACHABLE',
      'DATABASE_NOT_FOUND',
      'DATABASE_UNAUTHORIZED',
      'DATABASE_FORBIDDEN',
      'DATABASE_ERROR',
    ]) {
      expect(isSchemaNotApplied(new AssemoraError(code, 'no', { status: 503 }))).toBe(false)
    }
  })

  it('refuses an ordinary error that merely says the same words', () => {
    // A plain `Error` reaches this predicate whenever an adapter has not translated
    // its driver's failures. Matching on the message would make an application that
    // boots quietly out of one that should have refused to.
    expect(isSchemaNotApplied(new Error('relation "users" does not exist'))).toBe(false)
    expect(isSchemaNotApplied(undefined)).toBe(false)
    expect(isSchemaNotApplied({ code: SCHEMA_NOT_APPLIED })).toBe(false)
  })
})
