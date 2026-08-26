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
