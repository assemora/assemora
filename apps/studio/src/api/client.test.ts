import { describe, expect, it } from 'vitest'

import { ApiError, worthRetrying } from './client.ts'

const refusal = (status: number): ApiError =>
  new ApiError(status, { code: 'FORBIDDEN', message: 'No permission and no policy allow read' })

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
