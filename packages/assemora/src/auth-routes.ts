/**
 * The session endpoints Studio signs in through (SPEC.md §41, §49, §85).
 *
 * `@assemora/auth` already owns what a login *means* — it is the `auth.login`
 * command, with its decoy hash, its policy and its audit trail. What is left is how a
 * browser holds the result, and that is an HTTP question. `@assemora/auth` may not
 * depend on `@assemora/http` (SPEC.md §8), so this is the first of the four files
 * where the umbrella joins two packages that are forbidden to know about each other.
 */

import { permissionsOf, SESSION_COOKIE, SignIn, SignOut, User } from '@assemora/auth'
import { AssemoraError, type CommandBus } from '@assemora/core'
import { type Cookie, type Route, respond, route } from '@assemora/http'
import { array, boolean, email, string, timestamp } from '@assemora/schema'

import type { ResolvedSession } from './options.js'

export const CSRF_COOKIE = 'assemora_csrf'

/**
 * These are the routes `SignIn` and `SignOut` mean by `reachableFrom: 'its own
 * route'` (SPEC.md §85).
 *
 * `mountCommands()` is safe by construction for every other command, because the bus
 * authorizes first and authorization denies by default. Those two are publicly
 * authorized, so a generic `POST /commands/<name>` alias — or an MCP tool — would be
 * a second, unhardened door on to a session: one that hands the token back as JSON a
 * script can read rather than as an httpOnly cookie, mints no CSRF token and clears
 * no cookies. Any hardening added here later would be bypassed by such an alias.
 *
 * The commands say so themselves, and every generator reads it off the registry, so
 * nothing in this package keeps a list of their names to fall out of date.
 */

const EXPIRED = new Date(0)

/** Whatever the browser sent under this name, or nothing. */
const cookieValue = (header: string | undefined, name: string): string | undefined => {
  if (header === undefined) return undefined

  for (const part of header.split(';')) {
    const [key, ...rest] = part.trim().split('=')

    if (key === name) return decodeURIComponent(rest.join('='))
  }

  return undefined
}

export const authRoutes = (commands: CommandBus, session: ResolvedSession): Route[] => {
  const sessionCookie = (value: string, expires: Date): Cookie => ({
    name: SESSION_COOKIE,
    value,
    expires,
    httpOnly: true,
    secure: session.secure,
    sameSite: session.sameSite,
  })

  /** Readable on purpose: the page has to be able to echo it back in a header. */
  const csrfCookie = (value: string, expires: Date): Cookie => ({
    name: CSRF_COOKIE,
    value,
    expires,
    httpOnly: false,
    secure: session.secure,
    sameSite: session.sameSite,
  })

  return [
    route.post('/auth/login', {
      description: 'Exchanges an email and a password for a Studio session',
      tags: ['auth'],
      body: { email: email(), password: string() },
      response: { userId: string(), expiresAt: timestamp(), csrfToken: string() },
      status: 200,
      errors: [
        { code: 'INVALID_CREDENTIALS', status: 401, description: 'Wrong email or password' },
      ],
      handler: async ({ body }) => {
        // The user agent is not passed: the command reads it off the context the HTTP
        // server built from the request, so nothing a caller writes in a body can
        // become the forensic record of its own sign-in (SPEC.md §85).
        const started = await commands.execute(SignIn, {
          email: body.email,
          password: body.password,
        })

        // Double-submit: the value is compared against the cookie it is sent beside,
        // and a cross-site caller can send the cookie but cannot read it.
        const csrfToken = crypto.randomUUID()

        return respond(
          { userId: started.userId, expiresAt: started.expiresAt, csrfToken },
          {
            cookies: [
              sessionCookie(started.token, started.expiresAt),
              csrfCookie(csrfToken, started.expiresAt),
            ],
          },
        )
      },
    }),

    route.post('/auth/logout', {
      description: 'Ends the current session',
      tags: ['auth'],
      response: { ended: boolean() },
      status: 200,
      handler: async ({ headers }) => {
        const token = cookieValue(headers.cookie, SESSION_COOKIE)

        if (token !== undefined) await commands.execute(SignOut, { token })

        // Answered the same way whether or not there was a session: a logout that
        // reports what it found is a way to ask whether a token is still good.
        return respond(
          { ended: true },
          { cookies: [sessionCookie('', EXPIRED), csrfCookie('', EXPIRED)] },
        )
      },
    }),

    route.get('/auth/me', {
      description: 'Who is asking, and what they may do',
      tags: ['auth'],
      auth: true,
      response: {
        id: string(),
        email: string(),
        name: string(),
        permissions: array(string()),
      },
      handler: async ({ actor }) => {
        const user = await User.find(actor?.id)

        // The credential resolved but its user is gone. That is an expired session
        // rather than a server fault, and Studio should be told to sign in again.
        if (user === null) {
          throw new AssemoraError('UNAUTHORIZED', 'The session outlived its user', { status: 401 })
        }

        return {
          id: user.id,
          email: user.email,
          name: user.name,
          permissions: [...(await permissionsOf(actor))],
        }
      },
    }),
  ]
}
