/**
 * AWS Signature Version 4, as much of it as an object store needs (SPEC.md §63).
 *
 * It is written here rather than taken from a package: `@assemora/media` depends on
 * schema, core and data, and a storage driver is not a reason to widen that. SigV4 is
 * a self-contained algorithm — a keyed hash chain over a canonical form of the
 * request — and `node:crypto` already has every primitive it asks for.
 *
 * Its failure mode is unusually unhelpful. A signature that disagrees with the
 * server's by one byte comes back as a 403 that says nothing about which byte, so the
 * documented AWS test vectors in `s3-signature.test.ts` are what keeps this honest;
 * a regression there fails loudly instead of in somebody's deployment.
 */
import { createHash, createHmac } from 'node:crypto'

const ALGORITHM = 'AWS4-HMAC-SHA256'
const TERMINATOR = 'aws4_request'

/** A presigned URL declares no body: the browser that follows it sends none. */
const UNSIGNED_PAYLOAD = 'UNSIGNED-PAYLOAD'

export type SigningCredentials = {
  readonly accessKeyId: string
  readonly secretAccessKey: string
  /** Temporary credentials carry one; a long-lived key pair does not. */
  readonly sessionToken?: string
}

export type SigningScope = {
  readonly credentials: SigningCredentials
  readonly region: string
  readonly service: string
  /** The instant the signature claims. A receiver refuses one that has drifted. */
  readonly signedAt: Date
}

const sha256 = (data: string | Uint8Array): string =>
  createHash('sha256').update(data).digest('hex')

const hmac = (key: string | Uint8Array, data: string): Buffer =>
  createHmac('sha256', key).update(data).digest()

export const hashPayload = (data: Uint8Array): string => sha256(data)

export const EMPTY_PAYLOAD_SHA256 = sha256('')

/**
 * RFC 3986 spares only `A-Za-z0-9-_.~`, and `encodeURIComponent` also spares `!'()*`.
 */
export const encodeRfc3986 = (value: string): string =>
  encodeURIComponent(value).replace(
    /[!'()*]/g,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  )

/** `2013-05-24T00:00:00.000Z` → `20130524T000000Z`. */
const amzDate = (at: Date): string => at.toISOString().replace(/[-:]|\.\d{3}/g, '')

const dateStamp = (at: Date): string => amzDate(at).slice(0, 8)

/**
 * The path, signed the way S3 reads it.
 *
 * S3 is the exception among AWS services: it does not normalise the path first, and
 * it encodes each segment once rather than twice. Decoding before encoding makes the
 * result the same whether the caller wrote `$` or `%24`, which matters because a URL
 * escapes some characters on its own and leaves others alone.
 */
const canonicalUri = (pathname: string): string =>
  pathname === ''
    ? '/'
    : pathname
        .split('/')
        .map((segment) => encodeRfc3986(decodeURIComponent(segment)))
        .join('/')

/**
 * Byte order, which is what SigV4 means by sorted.
 *
 * `localeCompare` would put `a` before `B`; the receiver compares code units, and a
 * signature over a differently ordered canonical form is simply a wrong signature.
 */
const byCodeUnit = (left: string, right: string): number => {
  if (left === right) return 0

  return left < right ? -1 : 1
}

type QueryPair = readonly [string, string]

/** Parameters encoded RFC 3986, sorted by encoded name and then by encoded value. */
const canonicalPairs = (pairs: Iterable<QueryPair>): readonly QueryPair[] => {
  const encoded: QueryPair[] = []

  for (const [name, value] of pairs) {
    encoded.push([encodeRfc3986(name), encodeRfc3986(value)])
  }

  encoded.sort(([leftName, leftValue], [rightName, rightValue]) =>
    leftName === rightName ? byCodeUnit(leftValue, rightValue) : byCodeUnit(leftName, rightName),
  )

  return encoded
}

const serializeQuery = (pairs: readonly QueryPair[]): string =>
  pairs.map(([name, value]) => `${name}=${value}`).join('&')

const canonicalQuery = (url: URL): string => serializeQuery(canonicalPairs(url.searchParams))

type HeaderForm = {
  /** `name:value\n` for every signed header, in order. */
  readonly canonical: string
  /** The same names, `;`-separated, as the `Authorization` header repeats them. */
  readonly signed: string
}

const canonicalHeaders = (headers: Readonly<Record<string, string>>): HeaderForm => {
  const entries = Object.entries(headers)
    .map(([name, value]) => [name.toLowerCase(), value.trim().replace(/\s+/g, ' ')] as const)
    .sort(([left], [right]) => byCodeUnit(left, right))

  return {
    canonical: entries.map(([name, value]) => `${name}:${value}\n`).join(''),
    signed: entries.map(([name]) => name).join(';'),
  }
}

/**
 * The key is derived rather than used: HMAC down a chain of day, region and service,
 * so a leaked signature opens exactly one day of one service in one region and the
 * secret itself never travels.
 */
const signingKey = (scope: SigningScope): Buffer => {
  const day = hmac(`AWS4${scope.credentials.secretAccessKey}`, dateStamp(scope.signedAt))
  const region = hmac(day, scope.region)
  const service = hmac(region, scope.service)

  return hmac(service, TERMINATOR)
}

const credentialScope = (scope: SigningScope): string =>
  `${dateStamp(scope.signedAt)}/${scope.region}/${scope.service}/${TERMINATOR}`

/**
 * The string to sign names the algorithm, the instant and the scope, and then stands
 * in for the whole request through one hash of its canonical form.
 */
const sign = (scope: SigningScope, canonicalRequest: string): string => {
  const stringToSign = [
    ALGORITHM,
    amzDate(scope.signedAt),
    credentialScope(scope),
    sha256(canonicalRequest),
  ].join('\n')

  return hmac(signingKey(scope), stringToSign).toString('hex')
}

export type SignableRequest = {
  readonly method: string
  readonly url: URL
  /** Anything beyond `host`, `x-amz-date` and `x-amz-content-sha256`, which are ours. */
  readonly headers?: Readonly<Record<string, string>>
  /** Hex SHA-256 of the body S3 will receive. */
  readonly payloadHash: string
}

/**
 * The headers a request needs, `authorization` among them.
 *
 * `host` is signed but not returned: `fetch` derives it from the URL, and the value
 * the server sees is the one the signature has to cover.
 */
export const signRequest = (
  request: SignableRequest,
  scope: SigningScope,
): Record<string, string> => {
  const sendable: Record<string, string> = {
    ...request.headers,
    'x-amz-date': amzDate(scope.signedAt),
    'x-amz-content-sha256': request.payloadHash,
    ...(scope.credentials.sessionToken === undefined
      ? {}
      : { 'x-amz-security-token': scope.credentials.sessionToken }),
  }

  const { canonical, signed } = canonicalHeaders({ ...sendable, host: request.url.host })

  const canonicalRequest = [
    request.method.toUpperCase(),
    canonicalUri(request.url.pathname),
    canonicalQuery(request.url),
    canonical,
    signed,
    request.payloadHash,
  ].join('\n')

  const credential = `${scope.credentials.accessKeyId}/${credentialScope(scope)}`

  return {
    ...sendable,
    authorization: `${ALGORITHM} Credential=${credential},SignedHeaders=${signed},Signature=${sign(scope, canonicalRequest)}`,
  }
}

export type PresignableRequest = {
  readonly method: string
  readonly url: URL
  /** Seconds the URL stays valid, from `signedAt`. */
  readonly expiresIn: number
}

/**
 * A URL that carries its own signature.
 *
 * Everything the header form puts in `Authorization` moves into the query string, so
 * a browser can fetch a private object without sending a header of its own. Only
 * `host` is signed, because that is the only header a browser can be relied on to
 * send unchanged. The secret key stays here: what the URL carries is the access key
 * id and a signature derived from the secret, never the secret.
 */
export const presignUrl = (request: PresignableRequest, scope: SigningScope): string => {
  const url = new URL(request.url)

  const parameters: QueryPair[] = [
    ...url.searchParams,
    ['X-Amz-Algorithm', ALGORITHM],
    ['X-Amz-Credential', `${scope.credentials.accessKeyId}/${credentialScope(scope)}`],
    ['X-Amz-Date', amzDate(scope.signedAt)],
    ['X-Amz-Expires', String(Math.floor(request.expiresIn))],
    ['X-Amz-SignedHeaders', 'host'],
    ...(scope.credentials.sessionToken === undefined
      ? []
      : [['X-Amz-Security-Token', scope.credentials.sessionToken] as QueryPair]),
  ]

  const query = serializeQuery(canonicalPairs(parameters))

  const canonicalRequest = [
    request.method.toUpperCase(),
    canonicalUri(url.pathname),
    query,
    `host:${url.host}\n`,
    'host',
    UNSIGNED_PAYLOAD,
  ].join('\n')

  // The URL is serialized from the very pairs the signature was taken over, rather
  // than from `url.searchParams`. That serializer is form-urlencoded — `+` for a
  // space, `%7E` for a tilde — while the canonical form is RFC 3986, and the two only
  // agree by accident on the values used so far. Signing one encoding and serving the
  // other is a 403 with nothing in it to say why.
  url.search = ''
  url.hash = ''

  return `${url.toString()}?${query}&X-Amz-Signature=${sign(scope, canonicalRequest)}`
}
