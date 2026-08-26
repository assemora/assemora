import { describe, expect, it } from 'vitest'

import {
  EMPTY_PAYLOAD_SHA256,
  hashPayload,
  presignUrl,
  type SigningScope,
  signRequest,
} from './s3-signature.js'

/**
 * The credentials AWS publishes with its worked examples. They open nothing, and
 * pinning the signatures they produce is the only way to notice that a change to the
 * signing chain is wrong before a deployment answers 403 without saying why.
 */
const AWS_EXAMPLE: SigningScope = {
  credentials: {
    accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
    secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
  },
  region: 'us-east-1',
  service: 's3',
  signedAt: new Date('2013-05-24T00:00:00Z'),
}

describe("AWS's own signature examples", () => {
  it('signs the documented GET Object request', () => {
    const headers = signRequest(
      {
        method: 'GET',
        url: new URL('https://examplebucket.s3.amazonaws.com/test.txt'),
        headers: { range: 'bytes=0-9' },
        payloadHash: EMPTY_PAYLOAD_SHA256,
      },
      AWS_EXAMPLE,
    )

    expect(headers.authorization).toBe(
      'AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request,' +
        'SignedHeaders=host;range;x-amz-content-sha256;x-amz-date,' +
        'Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41',
    )
  })

  it('signs the documented PUT Object request, body and all', () => {
    const body = new TextEncoder().encode('Welcome to Amazon S3.')

    const headers = signRequest(
      {
        method: 'PUT',
        url: new URL('https://examplebucket.s3.amazonaws.com/test%24file.text'),
        headers: {
          date: 'Fri, 24 May 2013 00:00:00 GMT',
          'x-amz-storage-class': 'REDUCED_REDUNDANCY',
        },
        payloadHash: hashPayload(body),
      },
      AWS_EXAMPLE,
    )

    expect(headers['x-amz-content-sha256']).toBe(
      '44ce7dd67c959e0d3524ffac1771dfbba87d2b6b4b4e99e42034a8b803f8b072',
    )
    expect(headers.authorization).toBe(
      'AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request,' +
        'SignedHeaders=date;host;x-amz-content-sha256;x-amz-date;x-amz-storage-class,' +
        'Signature=98ad721746da40c64f1a55b78f14c238d841ea1380cd77a1b5971af0ece108bd',
    )
  })

  it('signs the documented listing, whose parameters arrive out of order', () => {
    const headers = signRequest(
      {
        method: 'GET',
        url: new URL('https://examplebucket.s3.amazonaws.com/?prefix=J&max-keys=2'),
        payloadHash: EMPTY_PAYLOAD_SHA256,
      },
      AWS_EXAMPLE,
    )

    expect(headers.authorization).toContain(
      'Signature=34b48302e7b5fa45bde8084f4b7868a86f0a534bc59db6670ed5711ef69dc6f7',
    )
  })

  it('presigns the documented GET Object URL', () => {
    const url = presignUrl(
      {
        method: 'GET',
        url: new URL('https://examplebucket.s3.amazonaws.com/test.txt'),
        expiresIn: 86_400,
      },
      AWS_EXAMPLE,
    )

    expect(new URL(url).searchParams.get('X-Amz-Signature')).toBe(
      'aeeed9bbccd4d02ee5c0109b86d86835f995330da4c265957d157751f604d404',
    )
  })
})

describe('canonicalisation', () => {
  it('encodes a path segment once, and only what RFC 3986 reserves', () => {
    const raw = signRequest(
      {
        method: 'GET',
        url: new URL('https://examplebucket.s3.amazonaws.com/test$file.text'),
        headers: {
          date: 'Fri, 24 May 2013 00:00:00 GMT',
          'x-amz-storage-class': 'REDUCED_REDUNDANCY',
        },
        payloadHash: EMPTY_PAYLOAD_SHA256,
      },
      AWS_EXAMPLE,
    )

    const encoded = signRequest(
      {
        method: 'GET',
        url: new URL('https://examplebucket.s3.amazonaws.com/test%24file.text'),
        headers: {
          date: 'Fri, 24 May 2013 00:00:00 GMT',
          'x-amz-storage-class': 'REDUCED_REDUNDANCY',
        },
        payloadHash: EMPTY_PAYLOAD_SHA256,
      },
      AWS_EXAMPLE,
    )

    expect(raw.authorization).toBe(encoded.authorization)
  })

  it('collapses the whitespace inside a header value, as the receiver does', () => {
    const request = {
      method: 'GET' as const,
      url: new URL('https://examplebucket.s3.amazonaws.com/test.txt'),
      payloadHash: EMPTY_PAYLOAD_SHA256,
    }

    const spaced = signRequest({ ...request, headers: { range: '  bytes=0-9  ' } }, AWS_EXAMPLE)
    const tight = signRequest({ ...request, headers: { range: 'bytes=0-9' } }, AWS_EXAMPLE)

    expect(spaced.authorization).toBe(tight.authorization)
  })

  it('signs a header whatever case it was written in', () => {
    const request = {
      method: 'GET' as const,
      url: new URL('https://examplebucket.s3.amazonaws.com/test.txt'),
      payloadHash: EMPTY_PAYLOAD_SHA256,
    }

    expect(
      signRequest({ ...request, headers: { Range: 'bytes=0-9' } }, AWS_EXAMPLE).authorization,
    ).toBe(signRequest({ ...request, headers: { range: 'bytes=0-9' } }, AWS_EXAMPLE).authorization)
  })

  it('never returns host, because fetch sets it from the URL', () => {
    const headers = signRequest(
      {
        method: 'GET',
        url: new URL('https://examplebucket.s3.amazonaws.com/test.txt'),
        payloadHash: EMPTY_PAYLOAD_SHA256,
      },
      AWS_EXAMPLE,
    )

    expect(headers.host).toBeUndefined()
    expect(headers.authorization).toContain('SignedHeaders=host;')
  })

  it('binds the signature to the day, the region and the service', () => {
    const request = {
      method: 'GET' as const,
      url: new URL('https://examplebucket.s3.amazonaws.com/test.txt'),
      payloadHash: EMPTY_PAYLOAD_SHA256,
    }

    const base = signRequest(request, AWS_EXAMPLE).authorization
    const elsewhere = signRequest(request, { ...AWS_EXAMPLE, region: 'eu-west-1' }).authorization
    const later = signRequest(request, {
      ...AWS_EXAMPLE,
      signedAt: new Date('2013-05-25T00:00:00Z'),
    }).authorization

    expect(elsewhere).not.toBe(base)
    expect(later).not.toBe(base)
  })

  it('carries a session token, and signs it', () => {
    const headers = signRequest(
      {
        method: 'GET',
        url: new URL('https://examplebucket.s3.amazonaws.com/test.txt'),
        payloadHash: EMPTY_PAYLOAD_SHA256,
      },
      {
        ...AWS_EXAMPLE,
        credentials: { ...AWS_EXAMPLE.credentials, sessionToken: 'temporary/session+token' },
      },
    )

    expect(headers['x-amz-security-token']).toBe('temporary/session+token')
    expect(headers.authorization).toContain('x-amz-security-token')
  })
})

describe('presigned URLs', () => {
  const url = () =>
    new URL(
      presignUrl(
        {
          method: 'GET',
          url: new URL('https://examplebucket.s3.amazonaws.com/2026/08/photo.png'),
          expiresIn: 900,
        },
        AWS_EXAMPLE,
      ),
    )

  it('carries everything the receiver needs and nothing it does not', () => {
    const parameters = url().searchParams

    expect(parameters.get('X-Amz-Algorithm')).toBe('AWS4-HMAC-SHA256')
    expect(parameters.get('X-Amz-Credential')).toBe(
      'AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request',
    )
    expect(parameters.get('X-Amz-Date')).toBe('20130524T000000Z')
    expect(parameters.get('X-Amz-Expires')).toBe('900')
    expect(parameters.get('X-Amz-SignedHeaders')).toBe('host')
    expect(parameters.get('X-Amz-Signature')).toMatch(/^[0-9a-f]{64}$/)
  })

  it('never carries the secret key', () => {
    expect(url().toString()).not.toContain(AWS_EXAMPLE.credentials.secretAccessKey)
    expect(url().toString()).not.toContain('wJalrXUtnFEMI')
  })

  it('carries the session token, so a URL signed under a role is usable at all', () => {
    // Under IRSA or an instance role every credential is temporary, and a presigned
    // URL without `X-Amz-Security-Token` is a 403 the receiver never explains.
    const withToken = new URL(
      presignUrl(
        {
          method: 'GET',
          url: new URL('https://examplebucket.s3.amazonaws.com/2026/08/photo.png'),
          expiresIn: 900,
        },
        {
          ...AWS_EXAMPLE,
          credentials: { ...AWS_EXAMPLE.credentials, sessionToken: 'IQoJb3JpZ2luX2VjEXAMPLE' },
        },
      ),
    )

    expect(withToken.searchParams.get('X-Amz-Security-Token')).toBe('IQoJb3JpZ2luX2VjEXAMPLE')
    // Present is not the same as signed: the receiver takes the token into its own
    // canonical query, so a signature that skipped it is simply the wrong signature.
    expect(withToken.searchParams.get('X-Amz-Signature')).not.toBe(
      url().searchParams.get('X-Amz-Signature'),
    )
  })

  it('serializes the query with the encoder it signed with', () => {
    // `url.searchParams` writes form-urlencoded — `+` for a space, `%7E` for a tilde
    // — while the canonical query is RFC 3986. Signing over one and serving the other
    // is a 403 with nothing in it to say why.
    const signed = presignUrl(
      {
        method: 'GET',
        url: new URL('https://examplebucket.s3.amazonaws.com/2026/08/photo.png'),
        expiresIn: 900,
      },
      {
        ...AWS_EXAMPLE,
        credentials: { ...AWS_EXAMPLE.credentials, sessionToken: 'a b~c' },
      },
    )
    const query = signed.slice(signed.indexOf('?') + 1)

    expect(query).toContain('X-Amz-Security-Token=a%20b~c')
    expect(query).not.toContain('+')
    expect(query).not.toContain('%7E')
    expect(new URL(signed).searchParams.get('X-Amz-Security-Token')).toBe('a b~c')
  })

  it('keeps a parameter the caller had already put on the URL, and signs it', () => {
    const base = new URL('https://examplebucket.s3.amazonaws.com/2026/08/photo.png')
    base.searchParams.set('response-content-disposition', 'attachment; filename="a b.png"')

    const signed = presignUrl({ method: 'GET', url: base, expiresIn: 900 }, AWS_EXAMPLE)
    const query = signed.slice(signed.indexOf('?') + 1)

    expect(query).toContain(
      'response-content-disposition=attachment%3B%20filename%3D%22a%20b.png%22',
    )
    expect(new URL(signed).searchParams.get('X-Amz-Signature')).not.toBe(
      url().searchParams.get('X-Amz-Signature'),
    )
  })

  it('signs the object it names, so one URL does not open another', () => {
    const photo = url().searchParams.get('X-Amz-Signature')
    const other = new URL(
      presignUrl(
        {
          method: 'GET',
          url: new URL('https://examplebucket.s3.amazonaws.com/2026/08/private.png'),
          expiresIn: 900,
        },
        AWS_EXAMPLE,
      ),
    ).searchParams.get('X-Amz-Signature')

    expect(other).not.toBe(photo)
  })
})
