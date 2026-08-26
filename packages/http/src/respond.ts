/**
 * Status, headers and cookies around a response (SPEC.md §41, §85).
 *
 * A handler usually returns the answer and nothing else, which is the point of the
 * route DSL. Some answers carry more than a body: a session has to arrive as a
 * cookie the browser will not hand to JavaScript. Wrapping the value keeps that an
 * explicit act, and keeps the server library out of the handler's type.
 *
 * ```ts
 * handler: async ({ body }) =>
 *   respond({ userId }, { cookies: [session(token, expiresAt)] })
 * ```
 */

export type Cookie = {
  readonly name: string
  readonly value: string
  readonly path?: string
  readonly expires?: Date
  readonly maxAge?: number
  readonly httpOnly?: boolean
  readonly secure?: boolean
  readonly sameSite?: 'strict' | 'lax' | 'none'
}

export type Responded<T> = {
  readonly node: 'response'
  readonly body: T
  readonly status: number | undefined
  readonly headers: Readonly<Record<string, string>>
  readonly cookies: readonly Cookie[]
}

export const respond = <T>(
  body: T,
  options: {
    readonly status?: number
    readonly headers?: Readonly<Record<string, string>>
    readonly cookies?: readonly Cookie[]
  } = {},
): Responded<T> => ({
  node: 'response',
  body,
  status: options.status,
  headers: options.headers ?? {},
  cookies: options.cookies ?? [],
})

export const isResponded = (value: unknown): value is Responded<unknown> =>
  typeof value === 'object' && value !== null && (value as Responded<unknown>).node === 'response'

/** A cookie value may contain anything a header may not. */
const encode = (value: string): string => encodeURIComponent(value)

export const serializeCookie = (cookie: Cookie): string => {
  const parts = [`${cookie.name}=${encode(cookie.value)}`, `Path=${cookie.path ?? '/'}`]

  if (cookie.expires !== undefined) parts.push(`Expires=${cookie.expires.toUTCString()}`)
  if (cookie.maxAge !== undefined) parts.push(`Max-Age=${Math.trunc(cookie.maxAge)}`)
  if (cookie.httpOnly === true) parts.push('HttpOnly')
  if (cookie.secure === true) parts.push('Secure')
  parts.push(`SameSite=${cookie.sameSite === undefined ? 'Lax' : capitalize(cookie.sameSite)}`)

  return parts.join('; ')
}

const capitalize = (value: string): string => value.charAt(0).toUpperCase() + value.slice(1)
