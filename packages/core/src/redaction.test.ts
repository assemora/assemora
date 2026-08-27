import { describe, expect, it } from 'vitest'

import { redactError } from './redaction.js'

describe('what may cross into a third party (SPEC.md §85, §88)', () => {
  it('strips the credentials from a connection string and keeps the host', () => {
    const redacted = redactError(
      new Error('could not connect to postgres://ada:hunter2@db.internal:5432/assemora'),
    )

    expect(redacted.message).toBe('could not connect to postgres://***@db.internal:5432/assemora')
    expect(redacted.message).not.toContain('hunter2')
    expect(redacted.message).not.toContain('ada')
  })

  it('strips a password however it was written down', () => {
    const written = [
      'DATABASE_PASSWORD=hunter2 was rejected',
      'login failed for {"password":"hunter2"}',
      'config: password: hunter2, host: db',
    ]

    for (const message of written) {
      expect(redactError(new Error(message)).message).not.toContain('hunter2')
    }
  })

  it('strips a token, including the word after Bearer', () => {
    const redacted = redactError(
      new Error('POST /media rejected: Authorization: Bearer sk_live_9f3c2a17b4'),
    )

    expect(redacted.message).not.toContain('sk_live_9f3c2a17b4')

    expect(redactError(new Error('api_key=ak_2f81c0 is unknown')).message).not.toContain(
      'ak_2f81c0',
    )
    expect(redactError(new Error('bad session token: ses_7c1e9a')).message).not.toContain(
      'ses_7c1e9a',
    )
  })

  it('strips a credential that names its own scheme, with no key in front of it', () => {
    // The case the bearer pattern exists for, and the one nothing asserted: with a key
    // in front of it (`Authorization: Bearer …`) the keyed-secret rule already runs to
    // the end of the field, so deleting the bearer pattern changed nothing a test
    // could see. An agent's own log line has no key in front of the credential.
    expect(redactError(new Error('the agent presented Bearer sk_live_9f3c2a17b4')).message).toBe(
      'the agent presented Bearer ***',
    )
    expect(redactError(new Error('retry with Basic YWRhOmh1bnRlcjI=')).message).toBe(
      'retry with Basic ***',
    )
  })

  it("strips the framework's own session cookie, in every spelling it arrives in", () => {
    // `assemora_session` is minted by `@assemora/auth` on every login: it is not one
    // secret among many, it is the credential the whole application runs on, and it
    // reached an error reporter verbatim in all four of these shapes.
    const session = 'ses_H2hwOUkvDUzv2RcR7kjU4xxQ1Uw7o_xZmWo5ZUCQxpc'
    const written = [
      `could not parse cookie: assemora_session=${session}; assemora_csrf=a5a6faa1`,
      `could not parse {"cookie":"assemora_session=${session}"}`,
      `could not parse set-cookie: assemora_session=${session}; HttpOnly`,
      `could not parse sessionId=${session}`,
      `could not parse assemora_session=${session}`,
      `could not parse sid=${session}`,
      `could not parse connect.sid=${session}`,
    ]

    for (const message of written) {
      expect(redactError(new Error(message)).message).not.toContain(session)
    }

    expect(redactError(new Error('csrf mismatch: assemora_csrf=a5a6faa1')).message).not.toContain(
      'a5a6faa1',
    )
  })

  it('strips a credential this framework minted, with or without a key in front of it', () => {
    // The half a key alternation cannot reach: nobody writes `session=` in front of a
    // session id they are complaining about. `@assemora/auth` gives all three of its
    // credentials a prefix that says what they open, which makes them a shape.
    const minted = {
      session: 'ses_H2hwOUkvDUzv2RcR7kjU4xxQ1Uw7o_xZmWo5ZUCQxpc',
      apiToken: 'ast_9tXKq3ZfQmA1sVbNc7pLdE2rYuTgHjW4oI6nMxZ0aBk',
      agentToken: 'agt_4bNmQ7xLpR2aVsKdT9cYfHjW1oI6uZgE3nXtM0qBrPv',
    }

    for (const credential of Object.values(minted)) {
      expect(redactError(new Error(`no actor for ${credential}`)).message).not.toContain(credential)
    }
  })

  it('leaves a key that merely spells one of the words by accident', () => {
    // `sid` is three letters that live inside `inside`, `resident` and `subsidiary`,
    // so it counts as a key only when it is a whole segment of one. Over-redaction is
    // the safe direction, but a redactor that swallows ordinary prose is one nobody
    // trusts to have left the useful half of the message behind.
    expect(redactError(new Error('the block is inside=true and residual=0')).message).toBe(
      'the block is inside=true and residual=0',
    )
  })

  it('finds a secret further along a field that a harmless key opened', () => {
    // A value runs to the end of its field, so `user=ada password=hunter2` is one
    // key and one long value. The key names nothing secret; the password inside the
    // value still has to go.
    expect(redactError(new Error('rejected: user=ada password=hunter2')).message).not.toContain(
      'hunter2',
    )
  })

  it('strips a JWT wherever it turns up, keyed or not', () => {
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJhZGEifQ.7Hk3xQwPzq'

    expect(redactError(new Error(`the agent presented ${jwt}`)).message).not.toContain(jwt)
  })

  it('keeps the statement of a driver error and drops the values under it', () => {
    // The shape `@assemora/database-postgres` already guards against, guarded again
    // here for the errors that never pass through that translation.
    const redacted = redactError(
      new Error(
        'Failed query: insert into "users" ("email", "password") values ($1, $2)\nparams: ada@assemora.dev,$argon2id$v=19$m=65536',
      ),
    )

    expect(redacted.message).toContain('insert into "users"')
    expect(redacted.message).not.toContain('ada@assemora.dev')
    expect(redacted.message).not.toContain('argon2id')
  })

  it('rebuilds the stack from its frames, so a dump cannot ride along in it', () => {
    const thrown = new Error('rejected\nparams: hunter2')
    thrown.stack = [
      'Error: rejected',
      'params: hunter2',
      '    at publish (/app/pages.ts:12:9)',
      '    at async run (/app/bus.ts:40:5)',
    ].join('\n')

    const stack = redactError(thrown).stack ?? ''

    expect(stack).not.toContain('hunter2')
    expect(stack).toContain('at publish (/app/pages.ts:12:9)')
    expect(stack).toContain('at async run (/app/bus.ts:40:5)')
    expect(stack.split('\n')[0]).toBe('Error: rejected')
  })

  it('redacts a frame as well as the header', () => {
    const thrown = new Error('boom')
    thrown.stack = ['Error: boom', '    at connect (postgres://ada:hunter2@db/app:1:1)'].join('\n')

    expect(redactError(thrown).stack).not.toContain('hunter2')
  })

  it('follows the cause chain and redacts every link of it', () => {
    const driver = new Error('connect ECONNREFUSED postgres://ada:hunter2@db:5432/app')
    const thrown = new Error('The database rejected the operation', { cause: driver })

    const cause = redactError(thrown).cause

    expect(cause).toBeInstanceOf(Error)
    expect((cause as Error).message).not.toContain('hunter2')
    expect((cause as Error).message).toContain('ECONNREFUSED')
  })

  it('survives a cause that points back at itself', () => {
    const first = new Error('first')
    const second = new Error('second', { cause: first })
    first.cause = second

    expect(() => redactError(first)).not.toThrow()
  })

  it('keeps the name, so a tracker groups by the error it was', () => {
    class ConflictishError extends Error {}
    const thrown = new ConflictishError('someone else got there first')
    thrown.name = 'ConflictishError'

    expect(redactError(thrown).name).toBe('ConflictishError')
  })

  it('gives a thrown non-Error no stack of its own', () => {
    const redacted = redactError('password=hunter2')

    expect(redacted.message).toBe('password=***')
    // A stack collected inside the redactor would name redaction as the origin of
    // every error somebody threw as a string.
    expect(redacted.stack).toBeUndefined()
  })

  /**
   * The bound, rather than a stopwatch.
   *
   * `redactError` runs synchronously on the failure path of every request, so what it
   * costs is what the whole process pays: a handler that interpolated an upstream
   * response body into its message handed the redactor 80 000 characters, and the
   * keyed-secret rule — which searched backwards for its keyword from every position
   * — turned that into 13.6 seconds of blocked event loop, with unrelated healthy
   * requests queued behind it for 12.4 of them.
   *
   * Two things fix it and each has its own test here. The pattern is linear now, and
   * nothing measures that except a clock; what a machine can check is the other half,
   * which is that there is a ceiling on how much text reaches the pattern at all.
   */
  describe('what it will look at', () => {
    it('caps a message, so a long one cannot become the incident', () => {
      const redacted = redactError(new Error(`upstream refused: ${'a'.repeat(20_000)}`))

      expect(redacted.message.length).toBeLessThan(2_500)
      // The head of it is what says which upstream refused, and it survives.
      expect(redacted.message.startsWith('upstream refused: aaaa')).toBe(true)
      expect(redacted.message).toContain('more characters')
    })

    it('caps a stack frame, and the number of frames', () => {
      const thrown = new Error('boom')
      thrown.stack = [
        'Error: boom',
        `    at wide (/app/${'a'.repeat(20_000)}.ts:1:1)`,
        ...Array.from({ length: 400 }, (_, at) => `    at deep (/app/frame-${at}.ts:1:1)`),
      ].join('\n')

      const stack = redactError(thrown).stack ?? ''

      expect(stack.length).toBeLessThan(10_000)
      expect(stack).toContain('at wide')
      // Whichever frames are dropped, the report says that some were: a stack that
      // silently ends is one somebody reads as the bottom of the call.
      expect(stack).toContain('more frames')
    })

    it('caps every link of a cause chain, not only the one that was thrown', () => {
      const noise = 'a'.repeat(20_000)
      const deepest = new Error(`the driver said ${noise}`)
      const thrown = new Error(`sync failed ${noise}`, {
        cause: new Error(`upstream refused ${noise}`, { cause: deepest }),
      })

      const redacted = redactError(thrown)
      const cause = redacted.cause as Error
      const root = cause.cause as Error

      for (const message of [redacted.message, cause.message, root.message]) {
        expect(message.length).toBeLessThan(2_500)
      }
    })
  })

  it('describes a value that refuses to be described', () => {
    const hostile = {
      toString() {
        throw new Error('no')
      },
    }

    expect(() => redactError(hostile)).not.toThrow()
    expect(redactError(hostile).message).toBe('Something that cannot be described was thrown')
  })
})
