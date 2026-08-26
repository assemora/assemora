import { describe, expect, it } from 'vitest'

import {
  bigint,
  binary,
  boolean,
  email,
  enumOf,
  integer,
  json,
  number,
  string,
  timestamp,
  unknown,
  uuid,
} from './primitives.js'

import type { Issue, ParseResult } from './types.js'

const value = <T>(result: ParseResult<T>): T => {
  if (!result.ok) throw new Error('expected a successful parse')
  return result.value
}

const issues = <T>(result: ParseResult<T>): readonly Issue[] => {
  if (result.ok) throw new Error('expected a failed parse')
  return result.issues
}

describe('string', () => {
  it('accepts a string and rejects everything else', () => {
    expect(value(string().parse('hello'))).toBe('hello')
    expect(issues(string().parse(42))[0]?.code).toBe('type')
    expect(issues(string().parse(null))[0]?.code).toBe('type')
  })

  it('enforces length bounds', () => {
    expect(issues(string().min(8).parse('short'))[0]?.message).toBe('Must be at least 8 characters')
    expect(value(string().min(3).max(5).parse('four'))).toBe('four')
  })

  it('reports every broken refinement at once', () => {
    const result = string().min(10).pattern(/^\d+$/, 'Digits only').parse('abc')
    expect(issues(result).map((issue) => issue.code)).toEqual(['min', 'pattern'])
  })

  it('validates email and uuid formats', () => {
    expect(value(email().parse('a@b.co'))).toBe('a@b.co')
    expect(issues(email().parse('not-an-email'))[0]?.message).toBe('Invalid email')
    expect(value(uuid().parse('3f2504e0-4f89-41d3-9a0c-0305e82c3301'))).toBeTypeOf('string')
    expect(issues(uuid().parse('3f2504e0'))[0]?.code).toBe('uuid')
  })

  it('stays immutable when refined', () => {
    const base = string()
    const refined = base.min(5)

    expect(base.parse('abc').ok).toBe(true)
    expect(refined.parse('abc').ok).toBe(false)
    expect(refined).not.toBe(base)
  })

  it('describes itself as JSON Schema', () => {
    expect(string().min(2).max(8).describe('A name').toJsonSchema()).toEqual({
      type: 'string',
      minLength: 2,
      maxLength: 8,
      description: 'A name',
    })
  })
})

describe('optional and nullable', () => {
  it('treats absent and null as distinct', () => {
    expect(value(string().optional().parse(undefined))).toBeUndefined()
    expect(issues(string().optional().parse(null))[0]?.code).toBe('type')
    expect(value(string().nullable().parse(null))).toBeNull()
    expect(issues(string().nullable().parse(undefined))[0]?.code).toBe('type')
  })

  it('still applies the wrapped refinements to a present value', () => {
    expect(issues(string().min(4).optional().parse('ab'))[0]?.code).toBe('min')
  })

  it('marks the schema so an object can keep the key optional', () => {
    expect(string().optional().isOptional).toBe(true)
    expect(string().isOptional).toBe(false)
  })
})

describe('number', () => {
  it('rejects NaN, which is technically a number', () => {
    expect(issues(number().parse(Number.NaN))[0]?.code).toBe('type')
  })

  it('enforces bounds and integrality', () => {
    expect(value(number().min(1).max(10).parse(5))).toBe(5)
    expect(issues(number().min(1).parse(0))[0]?.code).toBe('min')
    expect(issues(integer().parse(1.5))[0]?.code).toBe('integer')
    expect(value(integer().parse(7))).toBe(7)
  })
})

describe('boolean', () => {
  it('does not coerce', () => {
    expect(value(boolean().parse(false))).toBe(false)
    expect(issues(boolean().parse('true'))[0]?.code).toBe('type')
    expect(issues(boolean().parse(1))[0]?.code).toBe('type')
  })
})

describe('enumOf', () => {
  it('accepts declared values only', () => {
    const status = enumOf('draft', 'published')

    expect(value(status.parse('draft'))).toBe('draft')
    expect(issues(status.parse('INVALID'))[0]?.message).toBe('Expected one of: draft, published')
  })

  it('exposes its values and JSON Schema', () => {
    const status = enumOf('draft', 'published')

    expect(status.values).toEqual(['draft', 'published'])
    expect(status.toJsonSchema()).toEqual({ type: 'string', enum: ['draft', 'published'] })
  })
})

describe('timestamp', () => {
  it('accepts a Date or an ISO string and always yields a Date', () => {
    const parsed = value(timestamp().parse('2026-08-26T10:00:00.000Z'))

    expect(parsed).toBeInstanceOf(Date)
    expect(parsed.toISOString()).toBe('2026-08-26T10:00:00.000Z')
    expect(value(timestamp().parse(new Date(0))).getTime()).toBe(0)
  })

  it('rejects an unparseable date', () => {
    expect(issues(timestamp().parse('not a date'))[0]?.code).toBe('type')
    expect(issues(timestamp().parse(new Date('nonsense')))[0]?.message).toBe('Invalid date')
  })
})

describe('json and unknown', () => {
  it('passes any JSON value through', () => {
    expect(value(json<{ a: number }>().parse({ a: 1 }))).toEqual({ a: 1 })
    expect(value(unknown().parse(null))).toBeNull()
  })

  it('rejects values JSON cannot carry', () => {
    expect(issues(json().parse(undefined))[0]?.code).toBe('type')
    expect(issues(json().parse(() => 1))[0]?.code).toBe('type')
  })
})

describe('bigint', () => {
  it('accepts a bigint, an integer and a numeric string', () => {
    expect(value(bigint().parse(9007199254740993n))).toBe(9007199254740993n)
    expect(value(bigint().parse(42))).toBe(42n)
    expect(value(bigint().parse('-17'))).toBe(-17n)
  })

  it('rejects anything else', () => {
    expect(issues(bigint().parse(1.5))[0]?.code).toBe('type')
    expect(issues(bigint().parse('12.5'))[0]?.code).toBe('type')
    expect(issues(bigint().parse(null))[0]?.code).toBe('type')
  })
})

describe('binary', () => {
  it('takes bytes as they are', () => {
    const bytes = new Uint8Array([1, 2, 3])

    expect(value(binary().parse(bytes))).toBe(bytes)
  })

  it('decodes the base64 its own JSON Schema promises', () => {
    expect([...(value(binary().parse('AQID')) ?? [])]).toEqual([1, 2, 3])
    expect(binary().toJsonSchema()).toMatchObject({ contentEncoding: 'base64' })
  })

  it('refuses a string that is not base64', () => {
    expect(issues(binary().parse('not base64!'))[0]?.code).toBe('encoding')
  })

  it('refuses anything that is neither', () => {
    expect(issues(binary().parse(42))[0]?.code).toBe('type')
    expect(issues(binary().parse(null))[0]?.code).toBe('type')
  })
})
