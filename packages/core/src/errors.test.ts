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
        requestId: 'req-2',
      },
    })
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
