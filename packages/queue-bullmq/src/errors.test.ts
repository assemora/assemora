import { AssemoraError } from '@assemora/core'
import { describe, expect, it } from 'vitest'

import { createRedactor, toQueueError } from './errors.js'

const CONNECTION_URL = 'redis://assemora:s3cret@queue.internal:6379/2'
const redact = createRedactor([CONNECTION_URL, 's3cret'])

const causeOf = (error: AssemoraError): string =>
  error.cause instanceof Error ? error.cause.message : ''

describe('createRedactor', () => {
  it('removes the connection string it was configured with', () => {
    expect(redact(`connect ECONNREFUSED for ${CONNECTION_URL}`)).toBe(
      'connect ECONNREFUSED for ***',
    )
  })

  it('removes the password on its own, wherever it is quoted', () => {
    expect(redact('AUTH failed for password "s3cret"')).toBe('AUTH failed for password "***"')
  })

  it('removes credentials from a url it has never seen', () => {
    const other = createRedactor([])

    expect(other('cannot reach rediss://someone:hunter2@other.host:6380')).toBe(
      'cannot reach rediss://***@other.host:6380',
    )
  })

  it('leaves a message with no secret in it alone', () => {
    expect(redact('Connection is closed')).toBe('Connection is closed')
  })
})

describe('toQueueError', () => {
  it('reports an unreachable host as something the caller may retry', () => {
    const error = toQueueError(
      Object.assign(new Error(`connect ECONNREFUSED ${CONNECTION_URL}`), { code: 'ECONNREFUSED' }),
      redact,
    )

    expect(error.code).toBe('QUEUE_UNAVAILABLE')
    expect(error.status).toBe(503)
    expect(error.details).toEqual({ code: 'ECONNREFUSED' })
  })

  it('finds the system code through a cause chain', () => {
    const error = toQueueError(
      new Error('write failed', { cause: Object.assign(new Error('gone'), { code: 'EPIPE' }) }),
      redact,
    )

    expect(error.code).toBe('QUEUE_UNAVAILABLE')
  })

  it('reads a socket that went away, which ioredis reports in prose', () => {
    expect(toQueueError(new Error("Stream isn't writeable"), redact).code).toBe('QUEUE_UNAVAILABLE')
  })

  it('separates wrong credentials, which retrying will not fix', () => {
    const error = toQueueError(new Error('NOAUTH Authentication required.'), redact)

    expect(error.code).toBe('QUEUE_DENIED')
    expect(error.status).toBe(500)
  })

  it('falls back to one code for everything else', () => {
    expect(toQueueError(new Error('MISCONF Redis is not saving'), redact).code).toBe('QUEUE_ERROR')
  })

  it('never lets the connection string reach the message or the cause', () => {
    const error = toQueueError(
      new Error(`WRONGPASS for ${CONNECTION_URL} (password s3cret)`),
      redact,
    )

    expect(error.message).not.toContain('s3cret')
    expect(causeOf(error)).toBe('WRONGPASS for *** (password ***)')
  })

  it('lets a failure the job itself raised through unchanged', () => {
    const refusal = new AssemoraError('FORBIDDEN', 'This action is not allowed', { status: 403 })

    expect(toQueueError(refusal, redact)).toBe(refusal)
  })

  it('handles something thrown that is not an Error at all', () => {
    const error = toQueueError('redis said no', redact)

    expect(error.code).toBe('QUEUE_ERROR')
    expect(error.cause).toBeUndefined()
  })
})
