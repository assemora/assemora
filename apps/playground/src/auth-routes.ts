/**
 * The session endpoints Studio logs in through (SPEC.md §41, §49, §85).
 *
 * `@assemora/auth` already owns what a login *means* — it is the `auth.login`
 * command, with its rate of failure, its decoy hash and its audit trail. What is
 * left is how a browser holds the result, and that is an HTTP question: an httpOnly
 * cookie the page cannot read, plus a CSRF token it can.
 */
import { permissionsOf, SESSION_COOKIE, SignIn, SignOut, User } from '@assemora/auth'
import type { CommandBus } from '@assemora/core'
import { type Cookie, type Route, respond, route } from '@assemora/http'
import { array, boolean, email, string, timestamp } from '@assemora/schema'

export const CSRF_COOKIE = 'assemora_csrf'

const secure = process.env.NODE_ENV === 'production'

const sessionCookie = (value: string, expires: Date): Cookie => ({
  name: SESSION_COOKIE,
  value,
  expires,
  httpOnly: true,
  secure,
  sameSite: 'strict',
})

/** Readable on purpose: the page has to be able to echo it back in a header. */
const csrfCookie = (value: string, expires: Date): Cookie => ({
  name: CSRF_COOKIE,
  value,
  expires,
  httpOnly: false,
  secure,
  sameSite: 'strict',
})

const EXPIRED = new Date(0)

export const authRoutes = (commands: CommandBus): Route[] => [
  route.post('/auth/login', {
    description: 'Exchanges an email and a password for a Studio session',
    tags: ['auth'],
    body: { email: email(), password: string() },
    response: { userId: string(), expiresAt: timestamp(), csrfToken: string() },
    status: 200,
    errors: [{ code: 'INVALID_CREDENTIALS', status: 401, description: 'Wrong email or password' }],
    handler: async ({ body, headers }) => {
      const session = await commands.execute(SignIn, {
        email: body.email,
        password: body.password,
        ...(headers['user-agent'] === undefined ? {} : { userAgent: headers['user-agent'] }),
      })

      const csrfToken = crypto.randomUUID()

      return respond(
        { userId: session.userId, expiresAt: session.expiresAt, csrfToken },
        {
          cookies: [
            sessionCookie(session.token, session.expiresAt),
            csrfCookie(csrfToken, session.expiresAt),
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
      const token = (headers.cookie ?? '')
        .split(';')
        .map((part) => part.trim().split('='))
        .find(([name]) => name === SESSION_COOKIE)?.[1]

      if (token !== undefined) await commands.execute(SignOut, { token: decodeURIComponent(token) })

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

      if (user === null) throw new Error('The session outlived its user')

      return {
        id: user.id,
        email: user.email,
        name: user.name,
        permissions: [...(await permissionsOf(actor))],
      }
    },
  }),
]
