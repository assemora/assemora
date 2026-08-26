import { describe, expectTypeOf, it } from 'vitest'

import { array, object } from './composites.js'
import { boolean, enumOf, json, number, string, timestamp, uuid } from './primitives.js'
import type { Infer } from './types.js'

type Settings = { theme: 'light' | 'dark' }

describe('primitive inference', () => {
  it('infers the value type of every primitive', () => {
    expectTypeOf<Infer<ReturnType<typeof string>>>().toEqualTypeOf<string>()
    expectTypeOf<Infer<ReturnType<typeof number>>>().toEqualTypeOf<number>()
    expectTypeOf<Infer<ReturnType<typeof boolean>>>().toEqualTypeOf<boolean>()
    expectTypeOf<Infer<ReturnType<typeof timestamp>>>().toEqualTypeOf<Date>()
    expectTypeOf<Infer<ReturnType<typeof uuid>>>().toEqualTypeOf<string>()
  })

  it('narrows an enum to its literal union, not to string', () => {
    const status = enumOf('draft', 'published', 'archived')

    expectTypeOf<Infer<typeof status>>().toEqualTypeOf<'draft' | 'published' | 'archived'>()
    expectTypeOf<Infer<typeof status>>().not.toEqualTypeOf<string>()
  })

  it('carries the declared shape of an opaque JSON field', () => {
    const settings = json<Settings>()

    expectTypeOf<Infer<typeof settings>>().toEqualTypeOf<Settings>()
  })

  it('keeps refinements from changing the inferred type', () => {
    const bounded = string().min(2).max(8).email()

    expectTypeOf<Infer<typeof bounded>>().toEqualTypeOf<string>()
  })
})

describe('optional and nullable inference', () => {
  it('adds undefined for optional and null for nullable', () => {
    const maybe = string().optional()
    const nullable = number().nullable()

    expectTypeOf<Infer<typeof maybe>>().toEqualTypeOf<string | undefined>()
    expectTypeOf<Infer<typeof nullable>>().toEqualTypeOf<number | null>()
  })

  it('keeps the two apart', () => {
    const maybe = string().optional()

    expectTypeOf<Infer<typeof maybe>>().not.toEqualTypeOf<string | null>()
  })
})

describe('object inference', () => {
  const User = object({
    id: uuid(),
    email: string().email(),
    age: number().optional(),
    deletedAt: timestamp().nullable(),
    status: enumOf('active', 'blocked'),
  })

  it('produces the exact record type, with optional keys optional', () => {
    expectTypeOf<Infer<typeof User>>().toEqualTypeOf<{
      id: string
      email: string
      age?: number
      deletedAt: Date | null
      status: 'active' | 'blocked'
    }>()
  })

  it('does not make an optional key merely undefined-able', () => {
    expectTypeOf<Infer<typeof User>>().not.toEqualTypeOf<{
      id: string
      email: string
      age: number | undefined
      deletedAt: Date | null
      status: 'active' | 'blocked'
    }>()
  })

  it('nests', () => {
    const Post = object({ author: object({ name: string() }), tags: array(string()) })

    expectTypeOf<Infer<typeof Post>>().toEqualTypeOf<{
      author: { name: string }
      tags: string[]
    }>()
  })
})

describe('array inference', () => {
  it('infers an array of the element type', () => {
    const tags = array(enumOf('news', 'guide'))

    expectTypeOf<Infer<typeof tags>>().toEqualTypeOf<('news' | 'guide')[]>()
  })
})

describe('parse results narrow', () => {
  it('exposes the value only on the successful branch', () => {
    const result = string().parse('x')

    if (result.ok) {
      expectTypeOf(result.value).toEqualTypeOf<string>()
    } else {
      expectTypeOf(result.issues).toEqualTypeOf<readonly import('./types.js').Issue[]>()
    }
  })
})

describe('invalid usage does not compile', () => {
  it('rejects an enum with no values', () => {
    // @ts-expect-error an enum needs at least one value
    enumOf()
  })

  it('rejects a shape entry that is not a schema', () => {
    // @ts-expect-error a shape holds schemas, not raw values
    object({ title: 'a string' })
  })

  it('rejects an array of a non-schema', () => {
    // @ts-expect-error the element must be a schema
    array('string')
  })

  it('rejects a refinement that the primitive does not have', () => {
    // @ts-expect-error `min` is not meaningful for a boolean
    boolean().min(1)
  })

  it('rejects reading a value from a failed parse', () => {
    const result = string().parse(1)

    if (!result.ok) {
      // @ts-expect-error a failed parse carries issues, never a value
      result.value
    }
  })
})
