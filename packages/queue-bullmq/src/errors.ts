/**
 * Redis failures turned into the Assemora error model (SPEC.md §83, §85).
 *
 * A queue is reached over a connection string, and a connection string is a secret:
 * it usually carries the password of the instance every job in the application
 * passes through. ioredis is not careful with it — a connection error can quote the
 * URL it was given — so nothing leaves this package before it has been through the
 * redactor built from the adapter's own configuration.
 *
 * The codes are deliberately few. A caller can do one of two things about a queue
 * that will not take a job: try again later, or fix the deployment. `QUEUE_UNAVAILABLE`
 * is the first and `QUEUE_DENIED` the second; everything else is `QUEUE_ERROR`.
 */
import { AssemoraError } from '@assemora/core'

/** `redis://user:secret@host:6379` — the credentials, wherever they are quoted. */
const CREDENTIALS_IN_URL = /(rediss?:\/\/)[^@\s/]*@/gi

export type Redactor = (text: string) => string

/**
 * Removes the adapter's own secrets from a message before anybody reads it.
 *
 * Knowing the exact strings is what makes this precise rather than hopeful: a
 * pattern can only guess at what a password looks like, while the adapter was handed
 * one and can delete every occurrence of it.
 */
export const createRedactor = (secrets: readonly (string | undefined)[]): Redactor => {
  const known = secrets.filter((secret): secret is string => secret !== undefined && secret !== '')

  return (text) => {
    let redacted = text

    for (const secret of known) redacted = redacted.split(secret).join('***')

    return redacted.replace(CREDENTIALS_IN_URL, '$1***@')
  }
}

/**
 * Node reports an unreachable host as a system error code, and it is the same
 * answer in every case: the queue is not there right now, and the caller may try
 * again.
 */
const UNREACHABLE = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'ENOTFOUND',
  'EPIPE',
  'ETIMEDOUT',
  'EAI_AGAIN',
])

/** What Redis answers when the credentials are wrong, missing or insufficient. */
const DENIED = /\b(NOAUTH|WRONGPASS|NOPERM|ERR AUTH|invalid password)/i

/** ioredis reports a socket that went away mid-command in prose rather than a code. */
const CLOSED = /(Connection is closed|Stream isn't writeable|Connection is already closed)/i

const systemCodeOf = (error: unknown): string | undefined => {
  for (let candidate: unknown = error; candidate !== undefined && candidate !== null; ) {
    const shape = candidate as { code?: unknown; cause?: unknown }

    if (typeof shape.code === 'string') return shape.code

    candidate = shape.cause
  }

  return undefined
}

/**
 * The cause chain is kept, because a stack from ioredis is the only thing that
 * explains a strange failure — but rebuilt around a redacted message, since a cause
 * is exactly what a logger prints.
 */
const redacted = (error: unknown, redact: Redactor): Error | undefined =>
  error instanceof Error ? new Error(redact(error.message)) : undefined

export const unavailable = (message: string, details?: unknown): AssemoraError =>
  new AssemoraError('QUEUE_UNAVAILABLE', message, {
    status: 503,
    ...(details === undefined ? {} : { details }),
  })

/** Maps a Redis or BullMQ failure into the shape every Assemora caller already handles. */
export const toQueueError = (error: unknown, redact: Redactor): AssemoraError => {
  // A job's own failure travels through the worker unchanged; relabelling it as a
  // queue fault would blame the transport for what the application decided.
  if (error instanceof AssemoraError) return error

  const message = error instanceof Error ? error.message : String(error)
  const code = systemCodeOf(error)

  if ((code !== undefined && UNREACHABLE.has(code)) || CLOSED.test(message)) {
    return new AssemoraError('QUEUE_UNAVAILABLE', 'The queue is unreachable', {
      status: 503,
      ...(code === undefined ? {} : { details: { code } }),
      cause: redacted(error, redact),
    })
  }

  if (DENIED.test(message)) {
    return new AssemoraError('QUEUE_DENIED', 'The queue refused these credentials', {
      status: 500,
      cause: redacted(error, redact),
    })
  }

  return new AssemoraError('QUEUE_ERROR', 'The queue rejected the operation', {
    status: 500,
    cause: redacted(error, redact),
  })
}
