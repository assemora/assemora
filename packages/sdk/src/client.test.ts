import { describe, expect, it, vi } from 'vitest'

import { createClient, SdkError } from './client.js'

type Call = { url: string; method: string; body: unknown; headers: Record<string, string> }

const stub = (
  reply: { status?: number; body?: unknown } = {},
): { calls: Call[]; fetch: typeof globalThis.fetch } => {
  const calls: Call[] = []

  const fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({
      url: String(url),
      method: init?.method ?? 'GET',
      body: init?.body === undefined ? undefined : JSON.parse(String(init.body)),
      headers: (init?.headers ?? {}) as Record<string, string>,
    })

    return new Response(reply.body === undefined ? '' : JSON.stringify(reply.body), {
      status: reply.status ?? 200,
      headers: { 'content-type': 'application/json' },
    })
  })

  return { calls, fetch: fetch as unknown as typeof globalThis.fetch }
}

describe('resource methods (SPEC.md §48)', () => {
  it('reads a page', async () => {
    const { calls, fetch } = stub({
      body: { data: [], total: 0, page: 1, perPage: 20, lastPage: 1 },
    })
    const api = createClient({ url: 'https://api.example/api', fetch })

    const page = await api.resource('articles').list({ search: 'ada', sort: '-createdAt', page: 2 })

    expect(page.total).toBe(0)
    expect(calls[0]?.method).toBe('GET')
    expect(calls[0]?.url).toBe('https://api.example/api/articles?search=ada&sort=-createdAt&page=2')
  })

  it('turns filters into query parameters', async () => {
    const { calls, fetch } = stub({
      body: { data: [], total: 0, page: 1, perPage: 20, lastPage: 1 },
    })
    const api = createClient({ url: 'https://api.example/api', fetch })

    await api.resource('articles').list({ filters: { status: 'published', featured: true } })

    expect(calls[0]?.url).toContain('status=published')
    expect(calls[0]?.url).toContain('featured=true')
  })

  it('reads, creates, updates and deletes one entry', async () => {
    const { calls, fetch } = stub({ body: { id: 'a1' } })
    const api = createClient({ url: 'https://api.example/api', fetch })

    await api.resource('articles').get('a 1')
    await api.resource('articles').create({ title: 'Hello' })
    await api.resource('articles').update('a1', { title: 'Hi' })
    await api.resource('articles').delete('a1')

    expect(calls.map((call) => `${call.method} ${new URL(call.url).pathname}`)).toEqual([
      'GET /api/articles/a%201',
      'POST /api/articles',
      'PATCH /api/articles/a1',
      'DELETE /api/articles/a1',
    ])
    expect(calls[1]?.body).toEqual({ title: 'Hello' })
  })

  it('reaches the same place through the explicit accessor', async () => {
    const { calls, fetch } = stub({ body: { id: 'a1' } })
    const api = createClient({ url: 'https://api.example/api', fetch })

    await api.resource('articles').get('a1')

    expect(calls[0]?.url).toBe('https://api.example/api/articles/a1')
  })
})

describe('authentication and headers', () => {
  it('sends the token as a bearer credential', async () => {
    const { calls, fetch } = stub({ body: {} })
    const api = createClient({ url: 'https://api.example/api', token: 'secret', fetch })

    await api.resource('articles').get('a1')

    expect(calls[0]?.headers.authorization).toBe('Bearer secret')
  })

  it('sends none when there is no token', async () => {
    const { calls, fetch } = stub({ body: {} })
    const api = createClient({ url: 'https://api.example/api', fetch })

    await api.resource('articles').get('a1')

    expect(calls[0]?.headers.authorization).toBeUndefined()
  })
})

describe('errors (SPEC.md §83, §84)', () => {
  it('raises the code, the status and the fields the server reported', async () => {
    const { fetch } = stub({
      status: 422,
      body: {
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Validation failed',
          fields: { title: ['This field is required'] },
          requestId: 'req-1',
        },
      },
    })

    const api = createClient({ url: 'https://api.example/api', fetch })
    const failure = await api
      .resource('articles')
      .create({})
      .catch((error: unknown) => error)

    expect(failure).toBeInstanceOf(SdkError)
    expect(failure).toMatchObject({
      code: 'VALIDATION_ERROR',
      status: 422,
      fields: { title: ['This field is required'] },
      requestId: 'req-1',
    })
  })

  it('still raises something usable when the body is not an Assemora error', async () => {
    const { fetch } = stub({ status: 502, body: { oops: true } })
    const api = createClient({ url: 'https://api.example/api', fetch })

    const failure = (await api
      .resource('articles')
      .list()
      .catch((error: unknown) => error)) as SdkError

    expect(failure.status).toBe(502)
    expect(failure.code).toBe('UNKNOWN')
  })
})

describe('reading and writing in a language (SPEC.md §131)', () => {
  it('puts the language in the base, because a language is a path segment', async () => {
    const calls: string[] = []
    const api = createClient({
      url: 'https://shop.example/api',
      locale: 'ru',
      fetch: async (input) => {
        calls.push(String(input))
        return new Response(
          JSON.stringify({ data: [], total: 0, page: 1, perPage: 20, lastPage: 1 }),
        )
      },
    })

    await api.resource('dishes').list()

    expect(calls[0]).toBe('https://shop.example/api/ru/dishes')
  })

  it('reaches the default language when no language is named', async () => {
    const calls: string[] = []
    const api = createClient({
      url: 'https://shop.example/api',
      fetch: async (input) => {
        calls.push(String(input))
        return new Response(JSON.stringify({ id: 'd1' }))
      },
    })

    await api.resource('dishes').get('d1')

    expect(calls[0]).toBe('https://shop.example/api/dishes/d1')
  })

  it('answers with a second client rather than changing this one', async () => {
    const calls: string[] = []
    const fetcher = async (input: unknown) => {
      calls.push(String(input))
      return new Response(JSON.stringify({ id: 'd1' }))
    }

    const api = createClient({ url: 'https://shop.example/api', fetch: fetcher as typeof fetch })

    await api.inLocale('en').resource('dishes').get('d1')
    // The client the caller holds is untouched: a language decides what every answer is,
    // and one that changed under a held reference would make earlier and later reads
    // disagree with nothing saying so.
    await api.resource('dishes').get('d1')

    expect(calls).toEqual([
      'https://shop.example/api/en/dishes/d1',
      'https://shop.example/api/dishes/d1',
    ])
  })
})
