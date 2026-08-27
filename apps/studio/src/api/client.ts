/**
 * The only place Studio knows how the application is reached.
 *
 * Studio is a client of the application layer and holds no business logic of its own
 * (SPEC.md §58): every read is a documented endpoint and every write is a command.
 * What lives here is the transport — the session cookie, the CSRF header, and the
 * error shape the API answers with (SPEC.md §84, §85).
 */

const CSRF_COOKIE = 'assemora_csrf'

export type ApiFailure = {
  readonly code: string
  readonly message: string
  readonly fields?: Readonly<Record<string, readonly string[]>>
  readonly requestId?: string
}

/** What a failed request throws. Carries the field errors a form needs. */
export class ApiError extends Error {
  readonly status: number
  readonly code: string
  readonly fields: Readonly<Record<string, readonly string[]>>
  readonly requestId: string | undefined

  constructor(status: number, failure: ApiFailure) {
    super(failure.message)
    this.name = 'ApiError'
    this.status = status
    this.code = failure.code
    this.fields = failure.fields ?? {}
    this.requestId = failure.requestId
  }
}

/**
 * Whether a failed request is worth sending again (SPEC.md §84).
 *
 * A refusal is an *answer*. The application understood the request and said no — no
 * permission, no such record, a version that moved — and it will say the same thing a
 * second later, so repeating it does nothing but delay the sentence the screen has to
 * show. That is what a role which may not read the theme sees on the Design screen: a
 * spinner for as long as the retries take, and then the 403 that was there all along.
 *
 * Anything else — a connection that dropped, an API in the middle of a restart —
 * gets exactly one more attempt.
 *
 * Written to react-query's own signature so the query client can take it as it is.
 * `failures` is how many attempts have already failed, so 0 is the first answer.
 */
export const worthRetrying = (failures: number, error: unknown): boolean => {
  if (error instanceof ApiError && error.status >= 400 && error.status < 500) return false

  return failures < 1
}

const csrfToken = (): string | undefined => {
  for (const part of document.cookie.split(';')) {
    const [name, ...rest] = part.trim().split('=')

    if (name === CSRF_COOKIE) return decodeURIComponent(rest.join('='))
  }

  return undefined
}

const failureOf = async (response: Response): Promise<ApiFailure> => {
  try {
    const body = (await response.json()) as { error?: ApiFailure }

    if (body.error !== undefined) return body.error
  } catch {
    // A gateway or a crash can answer with something that is not our error shape.
  }

  return { code: 'HTTP_ERROR', message: `The request failed with ${response.status}` }
}

const request = async (
  method: string,
  path: string,
  body?: unknown,
  signal?: AbortSignal,
): Promise<Response> => {
  const token = csrfToken()

  const response = await fetch(`/api${path}`, {
    method,
    // The session is an httpOnly cookie, so it has to be sent explicitly.
    credentials: 'include',
    headers: {
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      ...(token === undefined ? {} : { 'x-csrf-token': token }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    ...(signal === undefined ? {} : { signal }),
  })

  if (!response.ok) throw new ApiError(response.status, await failureOf(response))

  return response
}

const send = async (
  method: string,
  path: string,
  body?: unknown,
  signal?: AbortSignal,
): Promise<unknown> => {
  const response = await request(method, path, body, signal)

  if (response.status === 204) return null

  return await response.json()
}

export const api = {
  get: <T>(path: string, signal?: AbortSignal): Promise<T> =>
    send('GET', path, undefined, signal) as Promise<T>,

  /**
   * An answer that is not JSON.
   *
   * One address needs it: the generated stylesheet (SPEC.md §62). Every other thing
   * this application serves Studio is a command's or a query's JSON body, which is
   * why this is a second method rather than a mode of the first.
   */
  text: (path: string, signal?: AbortSignal): Promise<string> =>
    request('GET', path, undefined, signal).then((response) => response.text()),

  post: <T>(path: string, body?: unknown): Promise<T> => send('POST', path, body) as Promise<T>,
  patch: <T>(path: string, body: unknown): Promise<T> => send('PATCH', path, body) as Promise<T>,
  delete: <T>(path: string): Promise<T> => send('DELETE', path) as Promise<T>,

  /**
   * Runs a query (SPEC.md §15).
   *
   * The read half of `command`. Every registered query is an endpoint, so a screen
   * asks the application for what it declared rather than for a URL somebody agreed
   * on by hand.
   */
  query: <T>(
    name: string,
    input: Record<string, unknown> = {},
    signal?: AbortSignal,
  ): Promise<T> => {
    const parameters = new URLSearchParams()

    for (const [key, value] of Object.entries(input)) {
      if (value === undefined || value === null || value === '') continue

      parameters.set(key, typeof value === 'object' ? JSON.stringify(value) : String(value))
    }

    const query = parameters.toString()

    return send(
      'GET',
      `/queries/${name}${query === '' ? '' : `?${query}`}`,
      undefined,
      signal,
    ) as Promise<T>
  },

  /**
   * Runs a command (SPEC.md §14).
   *
   * Studio never has a second way to change anything: the button a person presses
   * and the tool an agent calls arrive at the same handler, past the same policies.
   */
  command: <T>(name: string, input: Record<string, unknown> = {}): Promise<T> =>
    send('POST', `/commands/${name}`, input) as Promise<T>,
}

const toBase64 = (bytes: Uint8Array): string => {
  // `btoa` takes a string of code points, so the bytes go over in chunks small
  // enough not to exceed the argument limit on a large file.
  let characters = ''

  for (let index = 0; index < bytes.length; index += 0x8000) {
    characters += String.fromCharCode(...bytes.subarray(index, index + 0x8000))
  }

  return btoa(characters)
}

/** Uploads bytes, which JSON has no way to carry but base64. */
export const upload = async (file: File): Promise<{ id: string; url: string }> =>
  await api.command('media.upload', {
    filename: file.name,
    mimeType: file.type === '' ? 'application/octet-stream' : file.type,
    data: toBase64(new Uint8Array(await file.arrayBuffer())),
  })
