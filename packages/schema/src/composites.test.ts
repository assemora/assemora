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

  /**
   * A shape's keys are caller-chosen. A dynamic collection names its fields in stored
   * JSON (SPEC.md §37, §86), `constructor`, `toString`, `valueOf` and `hasOwnProperty`
   * are all legal field names, and every one of them is answered by `Object.prototype`
   * on a plain object that has never been given the key.
   *
   * So a group field called `constructor` used to parse `Object` — a function — for a
   * key nobody sent, and the whole entry was refused with "Expected a string" about it.
   * `dynamic.ts` and `validation.ts` had already learned this at the top level; a shape
   * is the layer below, and it is the one a stored definition now reaches.
   */
  it('reads a key the value has, never one it inherits', () => {
    const Group = object({
      title: string(),
      constructor: string().optional(),
      toString: string().optional(),
      valueOf: string().optional(),
      hasOwnProperty: string().optional(),
    })

    const parsed = value(Group.parse({ title: 'A heading' }))

    // `toEqual` ignores a key whose value is `undefined`, and an inherited key that
    // parsed to `undefined` and was then *written* is the second half of the same bug:
    // `exactOptionalPropertyTypes` treats a present `undefined` and an absent key as
    // two different things, and only the key list can tell them apart.
    expect(Object.keys(parsed)).toEqual(['title'])
  })

  it('still reads such a key when the value actually carries it', () => {
    const Group = object({ constructor: string() })

    expect(value(Group.parse({ constructor: 'a name like any other' }))).toEqual({
      constructor: 'a name like any other',
    })
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
