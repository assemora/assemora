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
 * The key `@assemora/core` groups an issue about the record itself under.
 *
 * A `ValidationError` buckets its issues by the path they name, and an issue with no
 * path — "Expected an object", a rule about the whole input — has to go somewhere.
 */
const WHOLE_RECORD = '_'

/**
 * The messages the application sent that nothing else on the screen is showing.
 *
 * A `VALIDATION_ERROR` carries its meaning in `fields`, keyed by the path each issue is
 * about; its `message` is the headline "Validation failed" and nothing more (SPEC.md
 * §84). So a box that renders `error.message` alone shows a person a red rectangle
 * with no information in it, and throws away the sentence the application wrote — which
 * is exactly what the sort dropdown produced: a bare "Validation failed", with "Dynamic
 * entries sort by createdAt, updatedAt, publishedAt, status only" dropped one line
 * earlier.
 *
 * `shown` names the fields some other control is already displaying against its own
 * input, so a form does not say the same thing twice. Everything else is here —
 * including a key no form has an input for, which is the case that used to disappear
 * completely: a read-only field, a field name the resource does not declare, a query
 * parameter, or an issue about the record as a whole.
 */
export const unshownMessages = (
  error: unknown,
  shown: readonly string[] = [],
): readonly string[] =>
  error instanceof ApiError
    ? Object.entries(error.fields)
        .filter(([field]) => !shown.includes(field))
        .flatMap(([field, messages]) =>
          messages.map((message) => (field === WHOLE_RECORD ? message : `${field}: ${message}`)),
        )
    : []

/**
 * Whether a failure still needs a box of its own beside a form's marked inputs.
 *
 * A form that shows each named field's message against its own input has said the whole
 * answer only when every key had an input to land on. Anything else — a refusal that
 * named no field at all, a key the form does not render — is still unsaid, and hiding
 * the box on the strength of `fields` being non-empty is how it came to be said nowhere.
 */
export const hasMoreToSay = (error: unknown, shown: readonly string[] = []): boolean =>
  !(error instanceof ApiError) ||
  Object.keys(error.fields).length === 0 ||
  unshownMessages(error, shown).length > 0

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

/**
 * The language segment every request carries (SPEC.md §131).
 *
 * `/api/ru/queries/entries.list` and `/api/queries/entries.list` are the same endpoint —
 * the segment is stripped before routing and decides which rows the answer holds. The
 * default language is left off, exactly as it is on the site.
 *
 * A module-level value rather than a parameter on every call, for the reason the CSRF
 * token is read the same way: this is the transport, and it is the same for every
 * request Studio makes.
 */
let spoken = ''

export const speak = (locale: string | undefined, defaultLocale: string | undefined): void => {
  spoken = locale === undefined || locale === defaultLocale ? '' : `/${locale}`
}

const request = async (
  method: string,
  path: string,
  body?: unknown,
  signal?: AbortSignal,
): Promise<Response> => {
  const token = csrfToken()

  const response = await fetch(`/api${spoken}${path}`, {
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
/**
 * How wide and how tall, read from the file rather than asked of anybody.
 *
 * The columns exist and were null for every file ever uploaded, because nothing on
 * either side measured. The browser can, and it is the only participant that holds
 * the decoded image — so it answers here rather than offering a person two boxes to
 * type numbers into, which is a person entering numbers that are wrong.
 *
 * It answers with nothing rather than throwing: a file the browser cannot decode is
 * an ordinary thing to store, and a PDF has no dimensions to record.
 */
const measure = async (file: File): Promise<{ width: number; height: number } | undefined> => {
  if (!file.type.startsWith('image/')) return undefined

  const source = URL.createObjectURL(file)

  try {
    const image = new Image()

    await new Promise((resolve, reject) => {
      image.addEventListener('load', resolve, { once: true })
      image.addEventListener('error', reject, { once: true })
      image.src = source
    })

    return image.naturalWidth > 0
      ? { width: image.naturalWidth, height: image.naturalHeight }
      : undefined
  } catch {
    // An SVG with no intrinsic size, a format this browser does not decode, a file
    // that is not the image its type claims. None of those stop it being stored.
    return undefined
  } finally {
    URL.revokeObjectURL(source)
  }
}

export const upload = async (file: File): Promise<{ id: string; url: string }> => {
  const measured = await measure(file)

  return await api.command('media.upload', {
    filename: file.name,
    mimeType: file.type === '' ? 'application/octet-stream' : file.type,
    data: toBase64(new Uint8Array(await file.arrayBuffer())),
    ...(measured ?? {}),
  })
}
