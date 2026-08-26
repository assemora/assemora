import { describe, expect, it } from 'vitest'

import { array, object } from './composites.js'
import { boolean, enumOf, number, string } from './primitives.js'

import type { Issue, ParseResult } from './types.js'

const value = <T>(result: ParseResult<T>): T => {
  if (!result.ok) throw new Error('expected a successful parse')
  return result.value
}

const issues = <T>(result: ParseResult<T>): readonly Issue[] => {
  if (result.ok) throw new Error('expected a failed parse')
  return result.issues
}

describe('object', () => {
  const Login = object({
    email: string().email(),
    password: string().min(8),
    remember: boolean().optional(),
  })

  it('parses a valid payload', () => {
    expect(value(Login.parse({ email: 'a@b.co', password: 'longenough' }))).toEqual({
      email: 'a@b.co',
      password: 'longenough',
    })
  })

  it('addresses every issue by its path', () => {
    const result = Login.parse({ email: 'nope', password: 'short' })

    expect(issues(result)).toEqual([
      { path: ['email'], code: 'email', message: 'Invalid email' },
      { path: ['password'], code: 'min', message: 'Must be at least 8 characters' },
    ])
  })

  it('drops keys that are not part of the shape', () => {
    const parsed = value(Login.parse({ email: 'a@b.co', password: 'longenough', isAdmin: true }))

    expect(parsed).not.toHaveProperty('isAdmin')
  })

  it('leaves an absent optional key absent rather than undefined', () => {
    const parsed = value(Login.parse({ email: 'a@b.co', password: 'longenough' }))

    expect('remember' in parsed).toBe(false)
    expect(value(Login.parse({ email: 'a@b.co', password: 'longenough', remember: true }))).toEqual(
      { email: 'a@b.co', password: 'longenough', remember: true },
    )
  })

  it('rejects non-objects, arrays included', () => {
    expect(issues(Login.parse([]))[0]?.code).toBe('type')
    expect(issues(Login.parse(null))[0]?.code).toBe('type')
    expect(issues(Login.parse('{}'))[0]?.code).toBe('type')
  })

  it('nests paths through nested objects', () => {
    const Profile = object({ owner: object({ name: string().min(2) }) })
    const result = Profile.parse({ owner: { name: 'x' } })

    expect(issues(result)[0]?.path).toEqual(['owner', 'name'])
  })

  it('describes itself as JSON Schema, marking only required keys', () => {
    expect(Login.toJsonSchema()).toEqual({
      type: 'object',
      properties: {
        email: { type: 'string', format: 'email' },
        password: { type: 'string', minLength: 8 },
        remember: { type: 'boolean' },
      },
      required: ['email', 'password'],
      additionalProperties: false,
    })
  })
})

describe('array', () => {
  const Tags = array(string().min(2))

  it('parses every element', () => {
    expect(value(Tags.parse(['aa', 'bb']))).toEqual(['aa', 'bb'])
  })

  it('addresses a bad element by index', () => {
    expect(issues(Tags.parse(['aa', 'b']))[0]?.path).toEqual([1])
  })

  it('enforces length bounds', () => {
    expect(issues(Tags.min(2).parse(['aa']))[0]?.code).toBe('min')
    expect(issues(Tags.max(1).parse(['aa', 'bb']))[0]?.code).toBe('max')
  })

  it('rejects a non-array', () => {
    expect(issues(Tags.parse('aa'))[0]?.code).toBe('type')
  })

  it('composes with object', () => {
    const Post = object({ tags: array(enumOf('news', 'guide')), views: number() })

    expect(value(Post.parse({ tags: ['news'], views: 3 }))).toEqual({ tags: ['news'], views: 3 })
    expect(issues(Post.parse({ tags: ['nope'], views: 3 }))[0]?.path).toEqual(['tags', 0])
  })

  it('describes itself as JSON Schema', () => {
    expect(array(string()).min(1).toJsonSchema()).toEqual({
      type: 'array',
      items: { type: 'string' },
      minItems: 1,
    })
  })
})
