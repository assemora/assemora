/**
 * The runtime client (SPEC.md §48).
 *
 * It speaks the REST CRUD of SPEC.md §43 and the error model of §83, and it knows
 * nothing about the server's internals — this package depends on `@assemora/schema`
 * and on nothing else, so it is safe in a browser bundle.
 */

export type ClientOptions = {
  readonly url: string
  /**
   * The language to read and write in (SPEC.md §131).
   *
   * A language is a path segment, so this is a base rather than a header: `url` plus
   * `ru` is `https://…/api/ru`, which is the same API answering in Russian. Left out,
   * the deployment's default language answers — and in an application that serves one
   * language there is nothing else it could be.
   *
   * The OpenAPI document says the same thing as a server variable, so a client generated
   * from it and this one reach the same addresses.
   */
  readonly locale?: string
  readonly token?: string
  /** Injected in tests, and wherever `fetch` is not global. */
  readonly fetch?: typeof globalThis.fetch
  readonly headers?: Readonly<Record<string, string>>
}

export type ListQuery = {
  readonly search?: string
  readonly sort?: string
  readonly page?: number
  readonly perPage?: number
  readonly filters?: Readonly<Record<string, string | number | boolean>>
}

export type Page<T> = {
  readonly data: readonly T[]
  readonly total: number
  readonly page: number
  readonly perPage: number
  readonly lastPage: number
}

export type Created<T> = { readonly id: string; readonly entry: T }

export type ResourceClient<T = unknown> = {
  list(query?: ListQuery): Promise<Page<T>>
  get(id: string): Promise<T>
  create(data: Partial<T>): Promise<Created<T>>
  update(id: string, data: Partial<T>): Promise<Created<T>>
  delete(id: string): Promise<{ readonly id: string }>
}

/** The error model of SPEC.md §83, as a client sees it. */
export class SdkError extends Error {
  readonly code: string
  readonly status: number
  readonly details: unknown
  readonly fields: Readonly<Record<string, readonly string[]>> | undefined
  readonly requestId: string | undefined

  constructor(
    status: number,
    payload: {
      code?: string
      message?: string
      details?: unknown
      fields?: Readonly<Record<string, readonly string[]>>
      requestId?: string
    },
  ) {
    super(payload.message ?? 'The request failed')
    this.name = 'SdkError'
    this.status = status
    this.code = payload.code ?? 'UNKNOWN'
    this.details = payload.details
    this.fields = payload.fields
    this.requestId = payload.requestId
  }
}

/**
 * The untyped runtime client.
 *
 * It deliberately carries no index signature: under `noUncheckedIndexedAccess` one
 * would make `api.articles` possibly `undefined`, and the `api.articles.list()` of
 * SPEC.md §48 would not compile. That shorthand is real at runtime and typed by the
 * generated client, which declares each resource by name.
 */
export type Client = {
  readonly resource: <T = unknown>(name: string) => ResourceClient<T>
  request<T = unknown>(
    method: string,
    path: string,
    options?: { body?: unknown; query?: Readonly<Record<string, unknown>> },
  ): Promise<T>
  /**
   * The same client, reading and writing in another language.
   *
   * A second client rather than a mode on this one: a language decides what every answer
   * *is*, and a client that could change it under a caller holding a reference would be
   * one whose earlier reads and later reads disagree with nothing saying so.
   */
  inLocale(locale: string): Client
}

const queryString = (query: Readonly<Record<string, unknown>> | undefined): string => {
  if (query === undefined) return ''

  const search = new URLSearchParams()

  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null) continue
    search.set(key, String(value))
  }

  const rendered = search.toString()

  return rendered === '' ? '' : `?${rendered}`
}

const flatten = (query: ListQuery | undefined): Record<string, unknown> => ({
  ...(query?.filters ?? {}),
  ...(query?.search === undefined ? {} : { search: query.search }),
  ...(query?.sort === undefined ? {} : { sort: query.sort }),
  ...(query?.page === undefined ? {} : { page: query.page }),
  ...(query?.perPage === undefined ? {} : { perPage: query.perPage }),
})

export const createClient = (options: ClientOptions): Client => {
  const send = options.fetch ?? globalThis.fetch
  const root = options.url.replace(/\/+$/, '')
  const base = options.locale === undefined ? root : `${root}/${options.locale}`

  const request = async <T>(
    method: string,
    path: string,
    extra: { body?: unknown; query?: Readonly<Record<string, unknown>> } = {},
  ): Promise<T> => {
    const response = await send(`${base}${path}${queryString(extra.query)}`, {
      method: method.toUpperCase(),
      headers: {
        'content-type': 'application/json',
        ...(options.token === undefined ? {} : { authorization: `Bearer ${options.token}` }),
        ...options.headers,
      },
      ...(extra.body === undefined ? {} : { body: JSON.stringify(extra.body) }),
    })

    const text = await response.text()
    const parsed: unknown = text === '' ? null : JSON.parse(text)

    if (!response.ok) {
      const payload = (parsed as { error?: Record<string, unknown> } | null)?.error ?? {}

      throw new SdkError(response.status, payload)
    }

    return parsed as T
  }

  const resource = <T>(name: string): ResourceClient<T> => ({
    list: (query) => request<Page<T>>('get', `/${name}`, { query: flatten(query) }),
    get: (id) => request<T>('get', `/${name}/${encodeURIComponent(id)}`),
    create: (data) => request<Created<T>>('post', `/${name}`, { body: data }),
    update: (id, data) =>
      request<Created<T>>('patch', `/${name}/${encodeURIComponent(id)}`, { body: data }),
    delete: (id) => request<{ id: string }>('delete', `/${name}/${encodeURIComponent(id)}`),
  })

  const client = {
    resource,
    request,
    inLocale: (locale: string) => createClient({ ...options, locale }),
  }

  // `api.articles.list()` reads better than `api.resource('articles').list()`, and
  // both reach the same place (SPEC.md §48).
  return new Proxy(client, {
    get: (target, property) => {
      if (typeof property !== 'string' || property in target) {
        return Reflect.get(target, property) as unknown
      }

      return resource(property)
    },
  }) as Client
}
