/**
 * Turning credentials into an actor (SPEC.md §12, §49).
 *
 * This is what `@assemora/http` accepts as `resolveActor`: the HTTP layer knows about
 * headers and cookies, this package knows what a credential means, and neither
 * depends on the other (SPEC.md §8).
 */
import type { Actor } from '@assemora/core'

import { SESSION_PREFIX, sessionActor } from './sessions.js'
import { tokenActor } from './tokens.js'

export const SESSION_COOKIE = 'assemora_session'

const cookieValue = (header: string | undefined, name: string): string | undefined => {
  if (header === undefined) return undefined

  for (const part of header.split(';')) {
    const [key, ...rest] = part.trim().split('=')

    if (key === name) return rest.join('=')
  }

  return undefined
}

const bearer = (header: string | undefined): string | undefined => {
  if (header === undefined) return undefined

  const [scheme, ...rest] = header.split(' ')

  return scheme?.toLowerCase() === 'bearer' && rest.length > 0 ? rest.join(' ') : undefined
}

/**
 * A bearer token first, then the Studio session cookie. An unrecognised credential
 * is nobody, never an error: what a route does about that is the route's decision.
 *
 * A session token is accepted as a bearer credential too, which is how the SDK and
 * the CLI act as a person rather than as an integration. The browser still gets the
 * cookie, because a token JavaScript can read is a token an injected script can take
 * (SPEC.md §85).
 */
export const resolveActor = async (
  headers: Readonly<Record<string, string>>,
): Promise<Actor | undefined> => {
  const token = bearer(headers.authorization)

  if (token !== undefined) {
    return token.startsWith(`${SESSION_PREFIX}_`) ? sessionActor(token) : tokenActor(token)
  }

  const session = cookieValue(headers.cookie, SESSION_COOKIE)

  return session === undefined ? undefined : sessionActor(session)
}
