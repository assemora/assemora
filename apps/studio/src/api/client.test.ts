import { describe, expect, it } from 'vitest'

import { ApiError, hasMoreToSay, unshownMessages, worthRetrying } from './client.ts'

const refusal = (status: number): ApiError =>
  new ApiError(status, { code: 'FORBIDDEN', message: 'No permission and no policy allow read' })

const invalid = (fields: Record<string, readonly string[]>): ApiError =>
  new ApiError(422, { code: 'VALIDATION_ERROR', message: 'Validation failed', fields })

describe('what a failed request is worth trying again (SPEC.md §84)', () => {
  it('never repeats a refusal', () => {
    // A screen a role may not open has to say so, and asking twice only makes it say
    // so a second later. This is the whole of the Design screen's answer for an
    // editor: `theme.get` is 403 and will be 403 again.
    expect(worthRetrying(0, refusal(403))).toBe(false)
    expect(worthRetrying(0, refusal(401))).toBe(false)
    expect(worthRetrying(0, refusal(404))).toBe(false)
    expect(worthRetrying(0, refusal(409))).toBe(false)
  })

  it('gives a failure one more go', () => {
    // A dropped connection or an API in the middle of restarting is not an answer.
    expect(worthRetrying(0, new TypeError('Failed to fetch'))).toBe(true)
    expect(worthRetrying(0, refusal(500))).toBe(true)
    expect(worthRetrying(0, refusal(502))).toBe(true)
  })

  it('stops after that one', () => {
    expect(worthRetrying(1, refusal(500))).toBe(false)
    expect(worthRetrying(1, new TypeError('Failed to fetch'))).toBe(false)
  })
})

/**
 * The bug this covers: a `VALIDATION_ERROR`'s whole meaning is in `fields`, and every
 * screen showed `error.message` alone — the headline "Validation failed", with the
 * sentence the application actually wrote dropped by the component it was handed to.
 */
describe('the part of a refusal that has nowhere else to be shown (SPEC.md §84)', () => {
  it('carries the field messages the headline leaves out', () => {
    expect(
      unshownMessages(invalid({ sort: ['Dynamic entries sort by createdAt, status only'] })),
    ).toEqual(['sort: Dynamic entries sort by createdAt, status only'])
  })

  it('leaves out what an input on the form is already showing', () => {
    const failure = invalid({ title: ['This field is required'], rating: ['Expected a number'] })

    expect(unshownMessages(failure, ['title', 'rating'])).toEqual([])
    expect(unshownMessages(failure, ['title'])).toEqual(['rating: Expected a number'])
  })

  it('keeps an issue about the record itself, which names no field at all', () => {
    // `_` is where `@assemora/core` buckets an issue with an empty path, and no form
    // has an input called that — so this is the message that used to vanish entirely.
    expect(unshownMessages(invalid({ _: ['Expected an object'] }), ['title'])).toEqual([
      'Expected an object',
    ])
  })

  it('says nothing for a failure that is not the application answering', () => {
    expect(unshownMessages(new TypeError('Failed to fetch'))).toEqual([])
    expect(unshownMessages(refusal(403))).toEqual([])
  })
})

describe('whether a form needs a box beside its marked inputs', () => {
  it('does not, when every message has an input of its own', () => {
    expect(hasMoreToSay(invalid({ title: ['This field is required'] }), ['title'])).toBe(false)
  })

  /**
   * The bug this covers: the entry form hid the box the moment `fields` held anything,
   * on the assumption that every key was one of its inputs. A read-only field, an
   * undeclared one and an issue about the record itself are not, and each of those
   * refusals was shown nowhere on the screen at all.
   */
  it('does, when a message names something this form does not render', () => {
    expect(hasMoreToSay(invalid({ createdAt: ['"createdAt" cannot be written'] }), ['title'])).toBe(
      true,
    )
    expect(hasMoreToSay(invalid({ _: ['Expected an object'] }), ['title'])).toBe(true)
  })

  it('does, for a refusal that names no field — a 403, a 409, a dropped connection', () => {
    expect(hasMoreToSay(refusal(403), ['title'])).toBe(true)
    expect(hasMoreToSay(new TypeError('Failed to fetch'), ['title'])).toBe(true)
  })
})
