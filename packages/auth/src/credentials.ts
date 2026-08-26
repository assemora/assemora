/**
 * Password and token secrets (SPEC.md §49, §85).
 *
 * The two are hashed differently on purpose. A password is chosen by a person, so it
 * is low in entropy and needs a slow, memory-hard hash — Argon2id. A token is 256
 * bits from a CSPRNG, so guessing it is already impossible; hashing it slowly would
 * cost every request and buy nothing, and SHA-256 is the right tool. Both are stored
 * as digests and never as written.
 */
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'

import { hash as argon2Hash, verify as argon2Verify } from '@node-rs/argon2'

/** OWASP's recommended Argon2id parameters, kept in one place to be raised together. */
const ARGON2 = {
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
} as const

export const hashPassword = (password: string): Promise<string> => argon2Hash(password, ARGON2)

export const verifyPassword = async (stored: string, password: string): Promise<boolean> => {
  try {
    return await argon2Verify(stored, password)
  } catch {
    // A malformed or truncated hash is a failed verification, never an exception
    // that a caller might treat as a success.
    return false
  }
}

export type IssuedToken = {
  /** Shown once, at creation. Nothing stores it. */
  readonly token: string
  /** What the database keeps. */
  readonly hash: string
}

/** 256 bits of randomness, url-safe, with a prefix that says what it opens. */
export const issueToken = (prefix: string): IssuedToken => {
  const token = `${prefix}_${randomBytes(32).toString('base64url')}`

  return { token, hash: hashToken(token) }
}

export const hashToken = (token: string): string => createHash('sha256').update(token).digest('hex')

/**
 * Compares two digests without leaking, through timing, how much of one matched.
 */
export const tokensMatch = (left: string, right: string): boolean => {
  const a = Buffer.from(left, 'utf8')
  const b = Buffer.from(right, 'utf8')

  return a.length === b.length && timingSafeEqual(a, b)
}
