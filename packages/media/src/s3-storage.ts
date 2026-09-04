/**
 * The S3-compatible storage driver (SPEC.md §63).
 *
 * It speaks the four object requests a media library needs — PUT, GET, DELETE and a
 * signed link — over `fetch`, with every request signed here by `s3-signature.ts`.
 * That is deliberate: an object store is a deployment concern, and pulling a vendor
 * SDK into `@assemora/media` would put a transitive dependency tree behind the
 * content layer for four HTTP calls.
 *
 * Nothing in this file returns, logs or embeds the secret key. What leaves the
 * process is a signature derived from it, and the access key id that names which key
 * the receiver should check against.
 */
import { AssemoraError, ConfigurationError, createLogger, type Logger } from '@assemora/core'

import { safeContentType } from './content-type.js'
import {
  EMPTY_PAYLOAD_SHA256,
  encodeRfc3986,
  hashPayload,
  presignUrl,
  type SigningScope,
  signRequest,
} from './s3-signature.js'
import type { StorageDriver, StoredObject } from './storage.js'

/** SigV4 refuses to presign for longer, so there is no point accepting more. */
const MAX_SIGNED_URL_SECONDS = 604_800

const DEFAULT_SIGNED_URL_SECONDS = 3_600

/**
 * Where the bucket name goes.
 *
 * `path` puts it in the path (`https://host/bucket/key`) and `virtual-hosted` puts it
 * in the hostname (`https://bucket.host/key`).
 */
export type S3Addressing = 'path' | 'virtual-hosted'

export type S3StorageOptions = {
  readonly bucket: string
  /** Part of the signature, so it has to match the bucket's own. R2 uses `auto`. */
  readonly region: string
  readonly accessKeyId: string
  readonly secretAccessKey: string
  /** Temporary credentials carry one; a long-lived key pair does not. */
  readonly sessionToken?: string
  /** An S3-compatible service. AWS S3 in `region` when it is left out. */
  readonly endpoint?: string
  /** `path` by default. */
  readonly addressing?: S3Addressing
  /**
   * A CDN or a public bucket in front of the objects. Without one, `url()` signs.
   */
  readonly publicUrl?: string
  /** Seconds a signed URL stays valid. One hour by default, seven days at most. */
  readonly signedUrlExpiresIn?: number
  /**
   * Where the diagnosis of a refused request goes.
   *
   * A refusal is a deployment fault, and what explains it — the bucket, the key, the
   * status S3 answered with — is exactly what a REST response must not repeat. The
   * application's own logger belongs here; the default writes to the console, because
   * a driver that quietly discards the only explanation of a 502 is worse than noisy.
   */
  readonly logger?: Logger
  /** Injected in tests, and wherever `fetch` is not global. */
  readonly fetch?: typeof globalThis.fetch
}

/**
 * The message names the option and never its value: one of the four is the secret
 * key, and a configuration error is the most widely read line in a boot log.
 */
const required = (value: string | undefined, option: string): string => {
  if (value === undefined || value.trim() === '') {
    throw new ConfigurationError(`s3Storage needs a ${option}`)
  }

  return value
}

/**
 * Refuses a key that would address something other than the object it names.
 *
 * There is no filesystem here, but `..` is not inert either. Path-style addressing
 * puts the bucket in the path, and a URL resolves `/bucket/../secret` to `/secret`
 * before the request is ever signed — the same climb out of the root the local driver
 * refuses, one layer up (SPEC.md §85).
 */
const objectKey = (path: string): string => {
  const key = path.replace(/^\/+/, '')
  const segments = key.split('/')

  if (key === '' || segments.some((segment) => segment === '.' || segment === '..')) {
    throw new AssemoraError('INVALID_PATH', 'That path does not name an object in the bucket', {
      status: 422,
    })
  }

  return key
}

/** Each segment encoded separately, so `/` keeps meaning `/` and nothing else does. */
const encodeKey = (key: string): string => key.split('/').map(encodeRfc3986).join('/')

/**
 * The error code S3 buries in its XML, and nothing else from that body.
 *
 * A `SignatureDoesNotMatch` response quotes the canonical request and the access key
 * id back at the caller, which is useful in a terminal and wrong in an error that
 * ends up in a log or a REST response.
 */
const errorCode = (body: string): string | undefined => /<Code>([^<]+)<\/Code>/.exec(body)?.[1]

/**
 * A body nobody reads still holds its connection open until it is released, and an
 * upload-heavy hour is exactly when that matters.
 */
const discard = async (response: Response): Promise<void> => {
  await response.body?.cancel()
}

export const s3Storage = (options: S3StorageOptions): StorageDriver => {
  const bucket = required(options.bucket, 'bucket')
  const region = required(options.region, 'region')
  const credentials = {
    accessKeyId: required(options.accessKeyId, 'accessKeyId'),
    secretAccessKey: required(options.secretAccessKey, 'secretAccessKey'),
    ...(options.sessionToken === undefined ? {} : { sessionToken: options.sessionToken }),
  }

  const addressing = options.addressing ?? 'path'
  const send = options.fetch ?? globalThis.fetch
  const logger = options.logger ?? createLogger()
  const publicUrl = options.publicUrl?.replace(/\/+$/, '')
  const signedUrlExpiresIn = options.signedUrlExpiresIn ?? DEFAULT_SIGNED_URL_SECONDS

  // `Number.isFinite` first: every comparison against `NaN` is false, so a range
  // written as two comparisons lets `NaN` through, and the realistic way one arrives
  // is `Number(process.env.S3_URL_TTL)` on a variable nobody set. It would then reach
  // the wire as `X-Amz-Expires=NaN` and the bucket would refuse every media URL in
  // the application — a boot-time fault surfacing as a broken deployment.
  if (
    !Number.isFinite(signedUrlExpiresIn) ||
    signedUrlExpiresIn < 1 ||
    signedUrlExpiresIn > MAX_SIGNED_URL_SECONDS
  ) {
    throw new ConfigurationError(
      `s3Storage signedUrlExpiresIn must be between 1 and ${MAX_SIGNED_URL_SECONDS} seconds`,
    )
  }

  const endpoint = ((): URL => {
    const configured = options.endpoint ?? `https://s3.${region}.amazonaws.com`

    try {
      return new URL(configured)
    } catch {
      // The value stays out of it, as it does for the four above: the way an endpoint
      // fails to parse is a mistyped scheme, and the rest of it — userinfo included —
      // survives the typo intact.
      throw new ConfigurationError('s3Storage endpoint is not a URL')
    }
  })()

  /** An endpoint may sit under a prefix, as a MinIO behind a reverse proxy does. */
  const prefix = endpoint.pathname.replace(/\/+$/, '')

  const objectUrl = (key: string): URL =>
    addressing === 'path'
      ? new URL(`${endpoint.origin}${prefix}/${bucket}/${encodeKey(key)}`)
      : new URL(`${endpoint.protocol}//${bucket}.${endpoint.host}${prefix}/${encodeKey(key)}`)

  const scope = (): SigningScope => ({ credentials, region, service: 's3', signedAt: new Date() })

  /**
   * The status is 502 rather than the bucket's own, and the error says nothing more.
   *
   * A 403 from S3 means this deployment's credentials or bucket policy are wrong, and
   * repeating it would tell a perfectly authorized caller that they are forbidden —
   * a configuration fault wearing an authorization fault's clothes. That reasoning
   * covers the whole payload, not just the status: `AssemoraError.toPayload` puts both
   * `message` and `details` on the wire verbatim, and `media.upload` is reachable at
   * `POST /commands/media.upload`, so an upstream status or `<Code>` in either one is
   * the same disclosure by another route — with a private bucket name and object key
   * alongside it. `operation` is the only part a caller can act on; the diagnosis goes
   * to the log, where whoever owns the deployment reads it (SPEC.md §85, §87).
   */
  const failure = async (
    operation: string,
    key: string,
    response: Response,
  ): Promise<AssemoraError> => {
    const code = errorCode(await response.text().catch(() => ''))

    logger.error('S3 request failed', {
      operation,
      bucket,
      key,
      status: response.status,
      ...(code === undefined ? {} : { code }),
    })

    return new AssemoraError('STORAGE_REQUEST_FAILED', `S3 ${operation} failed`, {
      status: 502,
      details: { operation },
    })
  }

  const request = async (
    operation: string,
    method: string,
    key: string,
    init: { body?: Uint8Array; headers?: Readonly<Record<string, string>> } = {},
  ): Promise<Response> => {
    const url = objectUrl(key)

    const headers = signRequest(
      {
        method,
        url,
        ...(init.headers === undefined ? {} : { headers: init.headers }),
        payloadHash: init.body === undefined ? EMPTY_PAYLOAD_SHA256 : hashPayload(init.body),
      },
      scope(),
    )

    const response = await send(url, {
      method,
      headers,
      ...(init.body === undefined ? {} : { body: init.body }),
    })

    if (!response.ok) throw await failure(operation, key, response)

    return response
  }

  return {
    name: 's3',
    // The bucket and where it is, never the key pair that opens it.
    where:
      options.endpoint === undefined
        ? `${options.bucket} (${options.region})`
        : `${options.bucket} at ${options.endpoint}`,

    async put(path, data, contentType): Promise<StoredObject> {
      const key = objectKey(path)
      // The type is narrowed here rather than on the way out, because there is no way
      // out through this application: S3 fixes an object's response headers when it is
      // written, and `url()` hands a browser a link straight to the bucket. An
      // `image/svg+xml` stored as itself scripts whatever origin serves it, and a CDN
      // in front of a bucket is in practice a subdomain of the application — so the
      // local driver's inert download and this one have to reach the same answer
      // (SPEC.md §85).
      const type = safeContentType(contentType)

      const response = await request('put', 'PUT', key, {
        body: data,
        headers: {
          'content-type': type,
          // The same condition the serving side uses, so the two drivers agree for
          // every input rather than for the interesting ones: `octet-stream` alone
          // still leaves a sniffing browser room to guess, and the disposition is
          // what closes it. No filename — the key is the only name this layer has,
          // and it is a UUID.
          ...(type === 'application/octet-stream' ? { 'content-disposition': 'attachment' } : {}),
        },
      })

      await discard(response)

      return { path, size: data.byteLength }
    },

    async get(path) {
      const response = await request('get', 'GET', objectKey(path))

      return new Uint8Array(await response.arrayBuffer())
    },

    async remove(path) {
      // S3 answers 204 whether or not the object was there, which is the same
      // "removing what is not there is not an error" the local driver has.
      await discard(await request('remove', 'DELETE', objectKey(path)))
    },

    /**
     * Where a browser fetches it from.
     *
     * A bucket is private until somebody puts something public in front of it, so
     * without `publicUrl` the only honest answer is a URL that carries its own
     * signature. The contract asks for a string rather than a promise, and it can:
     * signing is a hash chain over what is already in hand, with no request to wait
     * for. What the contract cannot say is that this URL expires — see the README.
     */
    url(path) {
      const key = objectKey(path)

      if (publicUrl !== undefined) return `${publicUrl}/${encodeKey(key)}`

      return presignUrl(
        { method: 'GET', url: objectUrl(key), expiresIn: signedUrlExpiresIn },
        scope(),
      )
    },
  }
}
