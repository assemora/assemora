import { describe, expect, it } from 'vitest'

import { ApiError } from '../api/client.ts'
import { translator } from '../i18n/messages.ts'
import { signInFailure } from './login.tsx'

/**
 * English, because these assertions are about *which* sentence is chosen rather than
 * what it says in any language. The catalogue's own suite proves the other two readings
 * exist.
 */
const t = translator('en')

describe('what a login screen says when signing in did not work', () => {
  it('says the same thing for an unknown address and a wrong password (SPEC.md §86)', () => {
    // Studio's own sentence, on purpose: a login that can tell the two apart is an
    // account enumerator, whatever the application answered with.
    expect(
      signInFailure(new ApiError(401, { code: 'INVALID_CREDENTIALS', message: 'No such user' }), t),
    ).toBe('That email and password do not match.')
  })

  /**
   * The bug this covers: every answer that was not a 401 became "Could not sign in.
   * Please try again." — which is the wrong advice for the rate limit of SPEC.md §85,
   * and hides the reason for a validation failure entirely.
   */
  it('passes on what the application said for anything else', () => {
    expect(
      signInFailure(
        new ApiError(429, { code: 'RATE_LIMITED', message: 'Too many attempts. Try in a minute.' }),
        t,
      ),
    ).toBe('Too many attempts. Try in a minute.')

    expect(
      signInFailure(
        new ApiError(422, {
          code: 'VALIDATION_ERROR',
          message: 'Validation failed',
          fields: { email: ['Expected an email address'] },
        }),
        t,
      ),
    ).toBe('Validation failed email: Expected an email address')
  })

  it('falls back to its own sentence when nothing answered at all', () => {
    expect(signInFailure(new TypeError('Failed to fetch'), t)).toBe(
      'Could not sign in. Please try again.',
    )
  })
})
