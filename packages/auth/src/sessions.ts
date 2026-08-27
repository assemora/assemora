/**
 * Studio sessions (SPEC.md §49).
 *
 * The session lives on the server; the browser holds only a secret, which the HTTP
 * layer keeps in an `httpOnly`, `Secure`, `SameSite` cookie. What is stored here is a
 * digest of that secret, so a leaked database does not hand anyone a live session.
 */
import type { Actor } from '@assemora/core'

import { hashToken, issueToken } from './credentials.js'
import { Session, User } from './models.js'

export const SESSION_PREFIX = 'ses'

/** Two weeks, the usual compromise between a nuisance and a risk. */
export const DEFAULT_SESSION_TTL_MS = 14 * 24 * 60 * 60 * 1000

export type StartedSession = {
  /** Goes into the cookie. Never stored, never logged. */
  readonly token: string
  readonly expiresAt: Date
  readonly sessionId: string
}

export type SessionDetails = {
  readonly userAgent?: string
  /**
   * Where the sign-in came from, when the host genuinely knows.
   *
   * `auth.login` does not fill it, and deliberately does not accept one either: the
   * process cannot know the client's address on its own. Behind any proxy the socket
   * peer is the proxy, and believing `X-Forwarded-For` without a configured chain of
   * trusted hops is a value the client chose. Closing that means a trusted-proxy
   * option on `createHttpServer` and an `ipAddress` on the context; until then an
   * empty column is the truthful answer, and this stays for a host that has already
   * resolved the address by other means (SPEC.md §85).
   */
  readonly ipAddress?: string
  readonly ttlMs?: number
}

export const startSession = async (
  userId: string,
  details: SessionDetails = {},
): Promise<StartedSession> => {
  const issued = issueToken(SESSION_PREFIX)
  const expiresAt = new Date(Date.now() + (details.ttlMs ?? DEFAULT_SESSION_TTL_MS))

  const session = await Session.create({
    tokenHash: issued.hash,
    userId,
    userAgent: details.userAgent ?? null,
    ipAddress: details.ipAddress ?? null,
    expiresAt,
  })

  return { token: issued.token, expiresAt, sessionId: session.id }
}

/** The actor behind a session secret, or nobody. */
export const sessionActor = async (token: string): Promise<Actor | undefined> => {
  const session = await Session.where('tokenHash', hashToken(token)).first()

  if (session === null || session.expiresAt.getTime() <= Date.now()) return undefined

  const user = await User.find(session.userId)

  if (user === null || !user.active) return undefined

  return { type: 'user', id: user.id }
}

export const endSession = async (token: string): Promise<void> => {
  const session = await Session.where('tokenHash', hashToken(token)).first()

  await session?.delete()
}

/** Removes what has expired. Called on a schedule, never on the request path. */
export const purgeExpiredSessions = async (): Promise<number> => {
  const expired = await Session.where('expiresAt', '<=', new Date()).get()

  for (const session of expired) await session.delete()

  return expired.length
}
