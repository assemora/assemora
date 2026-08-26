import {
  AssemoraError,
  createLogger,
  type Logger,
  type LogRecord,
  silentWriter,
} from '@assemora/core'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { s3Storage } from './s3-storage.js'

const SECRET = 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY'

type Call = {
  url: string
  method: string
  headers: Record<string, string>
  body: Uint8Array | undefined
}

const stub = (reply: { status?: number; body?: string | Uint8Array } = {}) => {
  const calls: Call[] = []

  const fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({
      url: String(url),
      method: init?.method ?? 'GET',
      headers: { ...((init?.headers ?? {}) as Record<string, string>) },
      body: init?.body instanceof Uint8Array ? init.body : undefined,
    })

    const status = reply.status ?? 200

    // A 204 carries no body, and `Response` refuses to pretend otherwise.
    return new Response(status === 204 ? null : (reply.body ?? ''), { status })
  })

  return { calls, fetch: fetch as unknown as typeof globalThis.fetch }
}

/** A logger whose records are evidence rather than noise on the way past. */
const recording = (): { records: LogRecord[]; logger: Logger } => {
  const records: LogRecord[] = []

  return { records, logger: createLogger((record) => records.push(record)) }
}

const options = (fetch: typeof globalThis.fetch, logger: Logger = createLogger(silentWriter)) => ({
  bucket: 'assets',
  region: 'auto',
  endpoint: 'https://account.r2.cloudflarestorage.com',
  accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
  secretAccessKey: SECRET,
  fetch,
  logger,
})

beforeEach(() => {
  // A signature names the instant it was made, so the requests under test only have
  // one shape if the clock stands still.
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-08-26T12:00:00Z'))
})

afterEach(() => {
  vi.useRealTimers()
})

describe('the S3 driver (SPEC.md §63)', () => {
  it('calls itself s3, so an upload records which disk holds it', () => {
    const { fetch } = stub()

    expect(s3Storage(options(fetch)).name).toBe('s3')
  })

  it('puts an object, signed, and reports what it stored', async () => {
    const { calls, fetch } = stub()
    const bytes = new Uint8Array([1, 2, 3, 4])

    const stored = await s3Storage(options(fetch)).put('2026/08/file.png', bytes, 'image/png')

    expect(stored).toEqual({ path: '2026/08/file.png', size: 4 })

    const call = calls[0]
    expect(call?.method).toBe('PUT')
    expect(call?.url).toBe('https://account.r2.cloudflarestorage.com/assets/2026/08/file.png')
    expect(call?.body).toEqual(bytes)
    expect(call?.headers['content-type']).toBe('image/png')
    expect(call?.headers['x-amz-date']).toBe('20260826T120000Z')
    expect(call?.headers['x-amz-content-sha256']).toBe(
      // SHA-256 of the four bytes above; S3 refuses a PUT whose body disagrees.
      '9f64a747e1b97f131fabb6b447296c9b6f0201e79fb3c5356e6c77e89b6a806a',
    )
    // The signature itself is pinned against AWS's own vectors in
    // `s3-signature.test.ts`; what matters here is the scope it was made for and the
    // headers it covers, which is what this driver decides.
    expect(call?.headers.authorization).toMatch(
      /^AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE\/20260826\/auto\/s3\/aws4_request,SignedHeaders=content-type;host;x-amz-content-sha256;x-amz-date,Signature=[0-9a-f]{64}$/,
    )
  })

  it('signs the body, so a different upload is a different signature', async () => {
    const { calls, fetch } = stub()
    const storage = s3Storage(options(fetch))

    await storage.put('a.bin', new Uint8Array([1]), 'application/octet-stream')
    await storage.put('a.bin', new Uint8Array([2]), 'application/octet-stream')

    expect(calls[0]?.headers.authorization).not.toBe(calls[1]?.headers.authorization)
  })

  it('reads the bytes back', async () => {
    const { calls, fetch } = stub({ body: new Uint8Array([9, 8, 7]) })

    const bytes = await s3Storage(options(fetch)).get('2026/08/file.png')

    expect(bytes).toEqual(new Uint8Array([9, 8, 7]))
    expect(calls[0]?.method).toBe('GET')
    expect(calls[0]?.headers.authorization).toContain('AWS4-HMAC-SHA256 Credential=')
  })

  it('removes an object', async () => {
    const { calls, fetch } = stub({ status: 204 })

    await expect(s3Storage(options(fetch)).remove('2026/08/gone.png')).resolves.toBeUndefined()
    expect(calls[0]?.method).toBe('DELETE')
  })

  it('reports a delete the bucket actually refused, rather than reading every 4xx as absence', async () => {
    // The comment beside `remove` leans on S3 answering 204 for a key that was never
    // there. That is S3's promise, not a licence to swallow a 404: a wrong bucket
    // name answers `NoSuchBucket` and must not look like a successful removal.
    const { fetch } = stub({
      status: 404,
      body: '<Error><Code>NoSuchBucket</Code></Error>',
    })

    await expect(s3Storage(options(fetch)).remove('2026/08/gone.png')).rejects.toThrowError(
      AssemoraError,
    )
  })
})

describe('addressing', () => {
  it('puts the bucket in the path by default, which every service understands', async () => {
    const { calls, fetch } = stub()

    await s3Storage(options(fetch)).put('a.png', new Uint8Array([1]), 'image/png')

    expect(calls[0]?.url).toBe('https://account.r2.cloudflarestorage.com/assets/a.png')
  })

  it('puts it in the hostname when asked to', async () => {
    const { calls, fetch } = stub()

    await s3Storage({ ...options(fetch), addressing: 'virtual-hosted' }).put(
      'a.png',
      new Uint8Array([1]),
      'image/png',
    )

    expect(calls[0]?.url).toBe('https://assets.account.r2.cloudflarestorage.com/a.png')
  })

  it('talks to AWS in the configured region when no endpoint is given', async () => {
    const { calls, fetch } = stub()

    await s3Storage({
      bucket: 'assets',
      region: 'eu-west-1',
      accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
      secretAccessKey: SECRET,
      fetch,
    }).put('a.png', new Uint8Array([1]), 'image/png')

    expect(calls[0]?.url).toBe('https://s3.eu-west-1.amazonaws.com/assets/a.png')
  })

  it('keeps a prefix the endpoint already has', async () => {
    const { calls, fetch } = stub()

    await s3Storage({ ...options(fetch), endpoint: 'http://localhost:9000/storage/' }).put(
      'a.png',
      new Uint8Array([1]),
      'image/png',
    )

    expect(calls[0]?.url).toBe('http://localhost:9000/storage/assets/a.png')
  })

  it('encodes a key without letting it change the shape of the URL', async () => {
    const { calls, fetch } = stub()

    await s3Storage(options(fetch)).put('2026/08/a b?c#d.png', new Uint8Array([1]), 'image/png')

    expect(calls[0]?.url).toBe(
      'https://account.r2.cloudflarestorage.com/assets/2026/08/a%20b%3Fc%23d.png',
    )
  })
})

describe('keys that are not keys (SPEC.md §85)', () => {
  it('refuses a path that climbs out of the bucket', async () => {
    const { calls, fetch } = stub()
    const storage = s3Storage(options(fetch))

    for (const path of ['../escaped.png', '../../secret', 'a/../../outside.png', '/', '']) {
      await expect(storage.put(path, new Uint8Array([1]), 'image/png')).rejects.toThrowError(
        AssemoraError,
      )
      await expect(storage.get(path)).rejects.toThrowError(AssemoraError)
      await expect(storage.remove(path)).rejects.toThrowError(AssemoraError)
      expect(() => storage.url(path)).toThrowError(AssemoraError)
    }

    expect(calls).toEqual([])
  })

  it('says why, with a status a caller can act on', async () => {
    const { fetch } = stub()

    await s3Storage(options(fetch))
      .get('../escaped.png')
      .catch((error: unknown) => {
        expect(error).toBeInstanceOf(AssemoraError)
        expect((error as AssemoraError).code).toBe('INVALID_PATH')
        expect((error as AssemoraError).status).toBe(422)
      })

    expect.assertions(3)
  })

  it('accepts a leading slash, as the local driver does', async () => {
    const { calls, fetch } = stub()

    await s3Storage(options(fetch)).put('/a.png', new Uint8Array([1]), 'image/png')

    expect(calls[0]?.url).toBe('https://account.r2.cloudflarestorage.com/assets/a.png')
  })
})

describe('what the bucket is told an object is (SPEC.md §85)', () => {
  it('stores a renderable type as itself', async () => {
    const { calls, fetch } = stub()

    await s3Storage(options(fetch)).put('a.png', new Uint8Array([1]), 'image/png')

    expect(calls[0]?.headers['content-type']).toBe('image/png')
    expect(calls[0]?.headers['content-disposition']).toBeUndefined()
  })

  it('stores an SVG as the inert download the local driver serves it as', async () => {
    // S3 fixes the response headers when the object is written: after the PUT the
    // application is no longer in the request path and cannot narrow the type on the
    // way out. An `image/svg+xml` served inline from a CDN on the application's own
    // domain is stored cross-site scripting, so the narrowing happens here.
    const { calls, fetch } = stub()

    await s3Storage(options(fetch)).put(
      'a.svg',
      new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><script/></svg>'),
      'image/svg+xml',
    )

    expect(calls[0]?.headers['content-type']).toBe('application/octet-stream')
    expect(calls[0]?.headers['content-disposition']).toBe('attachment')
  })

  it('does the same for HTML, an unknown type and a declared octet-stream', async () => {
    // The last one is not narrowed, and still has to be an attachment: that is the
    // condition the serving side uses, and the two drivers have to agree for every
    // input rather than only for the interesting ones.
    const { calls, fetch } = stub()
    const storage = s3Storage(options(fetch))

    await storage.put('a.html', new Uint8Array([1]), 'text/html')
    await storage.put('a.bin', new Uint8Array([1]), 'application/x-invented')
    await storage.put('a.bin', new Uint8Array([1]), 'application/octet-stream')

    expect(calls).toHaveLength(3)

    for (const call of calls) {
      expect(call.headers['content-type']).toBe('application/octet-stream')
      expect(call.headers['content-disposition']).toBe('attachment')
    }
  })

  it('lower-cases the type it stores, as the serving side does', async () => {
    const { calls, fetch } = stub()

    await s3Storage(options(fetch)).put('a.png', new Uint8Array([1]), 'IMAGE/PNG')

    expect(calls[0]?.headers['content-type']).toBe('image/png')
  })

  it('signs the disposition it sends, or the bucket refuses the PUT', async () => {
    const { calls, fetch } = stub()

    await s3Storage(options(fetch)).put('a.svg', new Uint8Array([1]), 'image/svg+xml')

    expect(calls[0]?.headers.authorization).toContain(
      'SignedHeaders=content-disposition;content-type;host;x-amz-content-sha256;x-amz-date',
    )
  })
})

describe('temporary credentials', () => {
  it('carries the session token on every signed request', async () => {
    const { calls, fetch } = stub()

    await s3Storage({ ...options(fetch), sessionToken: 'IQoJb3JpZ2luX2VjEXAMPLE' }).put(
      'a.png',
      new Uint8Array([1]),
      'image/png',
    )

    expect(calls[0]?.headers['x-amz-security-token']).toBe('IQoJb3JpZ2luX2VjEXAMPLE')
    expect(calls[0]?.headers.authorization).toContain('x-amz-security-token')
  })

  it('carries it in a presigned URL too, which is the only way one works under IRSA', () => {
    const storage = s3Storage({ ...options(stub().fetch), sessionToken: 'IQoJb3JpZ2luX2VjEXAMPLE' })

    expect(new URL(storage.url('a.png')).searchParams.get('X-Amz-Security-Token')).toBe(
      'IQoJb3JpZ2luX2VjEXAMPLE',
    )
  })
})

describe('a request the bucket refuses', () => {
  const refusal =
    '<?xml version="1.0" encoding="UTF-8"?><Error><Code>SignatureDoesNotMatch</Code>' +
    `<Message>The request signature we calculated does not match</Message>` +
    `<AWSAccessKeyId>AKIAIOSFODNN7EXAMPLE</AWSAccessKeyId>` +
    `<StringToSign>AWS4-HMAC-SHA256 20260826T120000Z</StringToSign></Error>`

  it('becomes an AssemoraError naming the operation', async () => {
    const { fetch } = stub({ status: 403, body: refusal })

    await expect(
      s3Storage(options(fetch)).put('a.png', new Uint8Array([1]), 'image/png'),
    ).rejects.toThrowError('S3 put failed')
  })

  it('reports 502, because the deployment is at fault rather than the caller', async () => {
    const { fetch } = stub({ status: 403, body: refusal })

    await s3Storage(options(fetch))
      .get('a.png')
      .catch((error: unknown) => {
        expect((error as AssemoraError).code).toBe('STORAGE_REQUEST_FAILED')
        expect((error as AssemoraError).status).toBe(502)
      })

    expect.assertions(2)
  })

  it('tells the caller the operation and nothing else at all', async () => {
    // `details` and `message` are both serialized verbatim to whoever called
    // `POST /api/commands/media.upload`. Repeating the bucket's 403 there says
    // "you are forbidden" to a perfectly authorized caller — the exact thing the
    // 502 above exists to avoid — and names a private bucket and object key while
    // doing it. `operation` is the only part a caller can act on.
    const { fetch } = stub({ status: 403, body: refusal })

    await s3Storage(options(fetch))
      .get('2026/08/private.png')
      .catch((error: unknown) => {
        const thrown = error as AssemoraError
        const answer = JSON.stringify(thrown.toPayload('request-1'))

        expect(thrown.details).toEqual({ operation: 'get' })
        expect(answer).not.toContain('assets')
        expect(answer).not.toContain('2026/08/private.png')
        expect(answer).not.toContain('403')
        expect(answer).not.toContain('SignatureDoesNotMatch')
      })

    expect.assertions(5)
  })

  it('writes the bucket, the key and what S3 said to the log, where they belong', async () => {
    const { records, logger } = recording()
    const { fetch } = stub({ status: 403, body: refusal })

    await s3Storage(options(fetch, logger))
      .get('2026/08/private.png')
      .catch(() => undefined)

    expect(records).toHaveLength(1)
    expect(records[0]?.level).toBe('error')
    expect(records[0]).toMatchObject({
      operation: 'get',
      bucket: 'assets',
      key: '2026/08/private.png',
      status: 403,
      code: 'SignatureDoesNotMatch',
    })
  })

  it('survives a body that is not the XML it expected', async () => {
    const { records, logger } = recording()
    const { fetch } = stub({ status: 500, body: 'upstream is having a day' })

    await expect(s3Storage(options(fetch, logger)).get('a.png')).rejects.toThrowError(
      'S3 get failed',
    )
    expect(records[0]).toMatchObject({ status: 500 })
    expect(records[0]?.code).toBeUndefined()
  })

  it('repeats nothing of the response body but the code, even in the log', async () => {
    const { records, logger } = recording()
    const { fetch } = stub({ status: 403, body: refusal })

    await s3Storage(options(fetch, logger))
      .get('a.png')
      .catch((error: unknown) => {
        expect(JSON.stringify(error instanceof AssemoraError ? error.details : {})).not.toContain(
          'StringToSign',
        )
      })

    expect(JSON.stringify(records)).not.toContain('StringToSign')
    expect.assertions(2)
  })

  it('keeps the secret out of the log as well as out of the error', async () => {
    const { records, logger } = recording()
    const { fetch } = stub({ status: 403, body: refusal })

    await s3Storage(options(fetch, logger))
      .get('a.png')
      .catch(() => undefined)

    expect(JSON.stringify(records)).not.toContain(SECRET)
    expect(JSON.stringify(records)).not.toContain('wJalrXUtnFEMI')
  })
})

describe('the secret', () => {
  it('never reaches a thrown error', async () => {
    const { fetch } = stub({ status: 403, body: '<Error><Code>AccessDenied</Code></Error>' })

    await s3Storage(options(fetch))
      .get('a.png')
      .catch((error: unknown) => {
        const thrown = error as AssemoraError

        expect(`${thrown.message} ${thrown.stack} ${JSON.stringify(thrown.details)}`).not.toContain(
          SECRET,
        )
      })

    expect.assertions(1)
  })

  it('never reaches a request, only a signature derived from it', async () => {
    const { calls, fetch } = stub()
    const storage = s3Storage(options(fetch))

    await storage.put('a.png', new Uint8Array([1]), 'image/png')

    expect(JSON.stringify(calls)).not.toContain(SECRET)
    expect(JSON.stringify(calls)).not.toContain('wJalrXUtnFEMI')
  })

  it('never reaches a URL a browser is handed', () => {
    const storage = s3Storage(options(stub().fetch))

    expect(storage.url('a.png')).not.toContain(SECRET)
    expect(storage.url('a.png')).not.toContain('wJalrXUtnFEMI')
  })
})

describe('where a browser fetches it from', () => {
  it('signs the URL when nothing public sits in front of the bucket', () => {
    const url = new URL(s3Storage(options(stub().fetch)).url('2026/08/file.png'))

    expect(url.origin + url.pathname).toBe(
      'https://account.r2.cloudflarestorage.com/assets/2026/08/file.png',
    )
    expect(url.searchParams.get('X-Amz-Expires')).toBe('3600')
    expect(url.searchParams.get('X-Amz-Signature')).toMatch(/^[0-9a-f]{64}$/)
  })

  it('honours a shorter life for a signed URL', () => {
    const storage = s3Storage({ ...options(stub().fetch), signedUrlExpiresIn: 300 })

    expect(new URL(storage.url('a.png')).searchParams.get('X-Amz-Expires')).toBe('300')
  })

  it('hands out the CDN URL, unsigned, when one is configured', () => {
    const storage = s3Storage({
      ...options(stub().fetch),
      publicUrl: 'https://cdn.example/files/',
    })

    expect(storage.url('2026/08/file.png')).toBe('https://cdn.example/files/2026/08/file.png')
  })
})

describe('configuration', () => {
  it('refuses to start without the four things a signature needs', () => {
    const { fetch } = stub()
    const complete = options(fetch)

    expect(() => s3Storage({ ...complete, bucket: '' })).toThrowError('s3Storage needs a bucket')
    expect(() => s3Storage({ ...complete, region: ' ' })).toThrowError('s3Storage needs a region')
    expect(() => s3Storage({ ...complete, accessKeyId: '' })).toThrowError(
      's3Storage needs a accessKeyId',
    )
    expect(() => s3Storage({ ...complete, secretAccessKey: '' })).toThrowError(
      's3Storage needs a secretAccessKey',
    )
  })

  it('names the option and never the value it was given', () => {
    const { fetch } = stub()

    try {
      s3Storage({ ...options(fetch), bucket: '' })
    } catch (error) {
      expect((error as Error).message).not.toContain(SECRET)
    }

    expect.assertions(1)
  })

  it('refuses an endpoint that is not a URL', () => {
    expect(() => s3Storage({ ...options(stub().fetch), endpoint: 'account.r2.example' })).toThrow(
      'is not a URL',
    )
  })

  it('does not repeat the endpoint it was given, which may carry credentials', () => {
    // A mistyped scheme is the way an endpoint fails to parse, and the rest of the
    // value survives the typo intact — userinfo included. A configuration error is
    // the most widely read line in a boot log.
    try {
      s3Storage({
        ...options(stub().fetch),
        endpoint: 'ht!tps://key:s3cr3t-in-the-endpoint@minio.internal:9000',
      })
    } catch (error) {
      expect((error as Error).message).not.toContain('s3cr3t-in-the-endpoint')
      expect((error as Error).message).not.toContain('minio.internal')
    }

    expect.assertions(2)
  })

  it('refuses a signed URL life the protocol would not honour', () => {
    const { fetch } = stub()

    expect(() => s3Storage({ ...options(fetch), signedUrlExpiresIn: 0 })).toThrowError(
      'between 1 and 604800',
    )
    expect(() => s3Storage({ ...options(fetch), signedUrlExpiresIn: 604_801 })).toThrowError(
      'between 1 and 604800',
    )
  })

  it('refuses a signed URL life that is not a number at all', () => {
    // `Number(process.env.S3_URL_TTL)` on an unset variable is `NaN`, and every
    // comparison against `NaN` is false — so it survives a range check written as
    // two comparisons and reaches the wire as `X-Amz-Expires=NaN`, which the bucket
    // rejects for every media URL in the application.
    const { fetch } = stub()

    for (const life of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      expect(() => s3Storage({ ...options(fetch), signedUrlExpiresIn: life })).toThrowError(
        'between 1 and 604800',
      )
    }
  })
})
