import type { Issue } from '@assemora/schema'
import { describe, expect, it } from 'vitest'

import {
  AssemoraError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
  UnknownCommandError,
  ValidationError,
} from './errors.js'

describe('AssemoraError', () => {
  it('carries a code, a status and optional details', () => {
    const error = new AssemoraError('TEAPOT', 'I am a teapot', { status: 418, details: { x: 1 } })

    expect(error).toBeInstanceOf(Error)
    expect(error.name).toBe('AssemoraError')
    expect(error.code).toBe('TEAPOT')
    expect(error.status).toBe(418)
    expect(error.details).toEqual({ x: 1 })
  })

  it('serializes to the shape of SPEC.md §83', () => {
    const error = new AssemoraError('ARTICLE_NOT_FOUND', 'Article was not found', { status: 404 })

    expect(error.toPayload('req-1')).toEqual({
      error: { code: 'ARTICLE_NOT_FOUND', message: 'Article was not found', requestId: 'req-1' },
    })
  })

  it('omits absent parts rather than writing undefined', () => {
    expect(new AssemoraError('X', 'x').toPayload()).toEqual({ error: { code: 'X', message: 'x' } })
  })
})

describe('ValidationError', () => {
  const issues: Issue[] = [
    { path: ['email'], code: 'email', message: 'Invalid email' },
    { path: ['email'], code: 'min', message: 'Too short' },
    { path: ['profile', 'age'], code: 'min', message: 'Must be at least 18' },
  ]

  it('groups issues by field, as SPEC.md §84 requires', () => {
    expect(new ValidationError(issues).fields).toEqual({
      email: ['Invalid email', 'Too short'],
      'profile.age': ['Must be at least 18'],
    })
  })

  it('serializes with fields instead of details', () => {
    expect(new ValidationError(issues.slice(0, 1)).toPayload('req-2')).toEqual({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Validation failed',
        fields: { email: ['Invalid email'] },
        issues: [{ path: ['email'], code: 'email', message: 'Invalid email' }],
        requestId: 'req-2',
      },
    })
  })

  it('carries the code and the parameters a translator needs', () => {
    const refused = new ValidationError([
      {
        path: ['phone'],
        code: 'min',
        message: 'Must be at least 9 characters',
        params: { length: 9 },
      },
    ])

    // `fields` is the English sentence SPEC.md §84 fixes, and it is unchanged.
    expect(refused.toPayload().error.fields).toEqual({ phone: ['Must be at least 9 characters'] })
    // Beside it, the same failure with the nine still separate from the sentence.
    expect(refused.toPayload().error.issues).toEqual([
      {
        path: ['phone'],
        code: 'min',
        message: 'Must be at least 9 characters',
        params: { length: 9 },
      },
    ])
  })

  it('keeps a whole-value issue addressable', () => {
    expect(
      new ValidationError([{ path: [], code: 'type', message: 'Expected an object' }]).fields,
    ).toEqual({ _: ['Expected an object'] })
  })

  it('answers with 422', () => {
    expect(new ValidationError([]).status).toBe(422)
  })
})

describe('the rest of the error model', () => {
  it('maps each error to its HTTP status', () => {
    expect(new NotFoundError('Article', 'a-1').status).toBe(404)
    expect(new ForbiddenError().status).toBe(403)
    expect(new ConflictError().status).toBe(409)
    expect(new UnknownCommandError('pages.publish').status).toBe(404)
  })

  it('builds a readable not-found code and message', () => {
    const error = new NotFoundError('article', 'a-1')

    expect(error.code).toBe('ARTICLE_NOT_FOUND')
    expect(error.message).toBe('article a-1 was not found')
    expect(new NotFoundError('article').message).toBe('article was not found')
  })

  it('makes one token of an entity named in two words', () => {
    // `change set` used to answer `CHANGE SET_NOT_FOUND`, a code with a space in it,
    // which no client comparing codes could ever match.
    expect(new NotFoundError('change set', 'c-1').code).toBe('CHANGE_SET_NOT_FOUND')
    expect(new NotFoundError('change set', 'c-1').message).toBe('change set c-1 was not found')
  })
})

describe('a field path that is also a name on Object.prototype (SPEC.md §84)', () => {
  it('groups two issues under it instead of throwing while reporting them', () => {
    // A field name is caller-chosen — a form input, a collection made in Studio, an
    // agent. Accumulated in an object literal, `fields['constructor']` reads back a
    // function rather than `undefined`, so the second issue called `.push` on it and
    // the 422 being built became an unhandled TypeError.
    const error = new ValidationError([
      { path: ['constructor'], code: 'required', message: 'This field is required' },
      { path: ['constructor'], code: 'type', message: 'Expected a string' },
    ])

    expect(error.fields).toMatchObject({
      constructor: ['This field is required', 'Expected a string'],
    })
    expect(error.status).toBe(422)
  })

  it('reports one under it too, rather than merging it with the prototype', () => {
    const error = new ValidationError([
      { path: ['toString'], code: 'required', message: 'This field is required' },
    ])

    expect(error.toPayload().error.fields).toMatchObject({
      toString: ['This field is required'],
    })
  })
})

/**
 * The one thing a status cannot say (SPEC.md §88).
 *
 * 500 and above means nobody has claimed the failure was the caller's, which is what
 * makes it an incident worth reporting. An endpoint whose whole job is to report a
 * state answers 5xx for a different reason — its reader has to act on it — and
 * `/ready` is the one that does. The bit that says so belongs to the error, because
 * that is where whose-failure-is-it is already decided.
 */
describe('a 5xx that is an answer rather than a failure', () => {
  const refusal = () =>
    new AssemoraError('NOT_READY', 'This application is still starting', {
      status: 503,
      expected: true,
    })

  it('is not expected unless the throw said so', () => {
    expect(new AssemoraError('DATABASE_ERROR', 'The database rejected it').expected).toBe(false)
    expect(new NotFoundError('Article', 'a-1').expected).toBe(false)
  })

  it('carries the bit beside the status, rather than instead of it', () => {
    // The status is still 503, because that is what a load balancer reads and what
    // `errors: [{ code: 'NOT_READY', status: 503 }]` documents (SPEC.md §46).
    expect(refusal().status).toBe(503)
    expect(refusal().expected).toBe(true)
  })

  it('keeps it out of the body, which is bookkeeping the caller was never owed', () => {
    expect(refusal().toPayload('req-1')).toEqual({
      error: {
        code: 'NOT_READY',
        message: 'This application is still starting',
        requestId: 'req-1',
      },
    })
  })
})
