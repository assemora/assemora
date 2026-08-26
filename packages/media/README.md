# `@assemora/media`

Media library and storage adapters.

**Implementation phase:** 7 — implemented.

```ts
useStorage(localStorage({ root: './storage/media' }))

await app.commands.execute('media.upload', { filename, mimeType, data })
```

The storage interface names no vendor, and both drivers SPEC.md §63 makes mandatory
implement it. Each refuses a path that would climb out of where it may write — a
filename arrives from an upload, and `../../etc/passwd` is a filename.

## The S3-compatible driver

```ts
useStorage(
  s3Storage({
    bucket: 'assets',
    region: 'auto',
    endpoint: 'https://<account>.r2.cloudflarestorage.com',
    accessKeyId: S3_KEY,
    secretAccessKey: S3_SECRET,
  }),
)
```

It talks to anything that speaks S3 — AWS, Cloudflare R2, MinIO, Backblaze B2,
DigitalOcean Spaces — over `fetch`, signing every request with AWS Signature Version 4
computed here from `node:crypto`. There is no vendor SDK behind it: this package
depends on `@assemora/schema`, `@assemora/core` and `@assemora/data`, and four HTTP
requests are not a reason to widen that.

| Option | Meaning |
| --- | --- |
| `bucket`, `region` | Both are signed, so both must match the bucket's own. R2 wants `region: 'auto'`. |
| `accessKeyId`, `secretAccessKey` | Required. An empty one fails at boot rather than with an unexplained 403 later. |
| `sessionToken` | For temporary credentials. |
| `endpoint` | The service. AWS S3 in `region` when it is left out. A path in the endpoint is kept, for a MinIO behind a reverse proxy. |
| `addressing` | `'path'` (default) or `'virtual-hosted'`. |
| `publicUrl` | A CDN or public bucket in front of the objects. |
| `signedUrlExpiresIn` | Seconds a signed URL lives. One hour by default, seven days at most. Must be a finite number: `Number(process.env.S3_URL_TTL)` on an unset variable is `NaN`, and that is refused at boot rather than reaching the wire as `X-Amz-Expires=NaN`. |
| `logger` | Where a refused request is explained. Pass the application's logger; the default writes to the console. |
| `fetch` | Injected in tests, and wherever `fetch` is not global. |

### Addressing

`addressing` is stated, never inferred from the endpoint's hostname. It defaults to
`'path'` — `https://host/bucket/key` — because that is the one style every
S3-compatible service understands, and the one that works for a bucket whose name is
not a legal DNS label or contains a dot that a wildcard certificate will not cover.
Set `addressing: 'virtual-hosted'` for AWS S3, which prefers `https://bucket.host/key`.

### What `url(path)` returns

A bucket is private until somebody puts something public in front of it, so the answer
depends on whether you did:

- With `publicUrl`, the object's URL under that base, and nothing else. Use it for a
  CDN or a bucket you have deliberately made public.
- Without it, a **presigned GET URL**, valid for `signedUrlExpiresIn`. The contract is
  `url(path): string` rather than a promise, and a presigned URL fits inside it:
  signing is a hash chain over values already in hand and waits for no I/O.

Two things follow from that, and neither is hidden:

- **A presigned URL expires.** `StorageDriver.url()` has no way to say when, so a
  caller that stores one — in a cached response, a static build, an exported document
  — will find it stale. Studio and the REST layer ask for the URL as they render, so
  they are fine; anything that persists one should either use `publicUrl` or take the
  path and ask again. Saying so in the type means giving `url()` a return type richer
  than `string`, which changes `StorageDriver` for the local driver too. That is an
  ADR, not a patch, and it has not been written.
- **A presigned URL names the access key id** in `X-Amz-Credential`. That is how SigV4
  works and it is not a secret: it says which key the receiver should check the
  signature against. The secret access key never leaves the process — not in a URL,
  not in a header, not in an error, not in a log.

### Errors

A refused request becomes an `AssemoraError` with code `STORAGE_REQUEST_FAILED`, status
**502** and `details: { operation }` — and nothing else. The status is deliberately not
the bucket's own: a 403 from S3 means this deployment's credentials or bucket policy
are wrong, and repeating it would tell a perfectly authorized caller they are
forbidden. That reasoning covers the whole payload rather than just the status, because
`AssemoraError.toPayload` puts `message` and `details` on the wire verbatim and
`media.upload` is reachable over REST: an upstream status or `<Code>` in either one is
the same disclosure by another route, with a private bucket name and object key
alongside it.

The diagnosis is not lost, it is moved. The bucket, the key, the HTTP status and the
`<Code>` S3 returned go to `logger.error('S3 request failed', …)`, where whoever owns
the deployment reads them. Nothing else from the response body is kept even there — a
`SignatureDoesNotMatch` body quotes the canonical request and the access key id back at
you, which belongs in a terminal and not in a log shipper.

A key that is empty or contains a `.` or `..` segment is refused with `INVALID_PATH`
before any request is signed. There is no filesystem here, but `..` is not inert
either: path-style addressing puts the bucket in the path, and a URL resolves
`/bucket/../secret` to `/secret`.

### Content types

`safeContentType` decides what a browser may be told a file is, and both drivers reach
the same answer — but at different moments. The local driver stores bytes and the
application narrows the type as it serves them. An object store answers for itself, so
this driver narrows the type on the way **in**: what a `PUT` writes is what the bucket
returns forever after, and by then the application is no longer in the request path.

So an upload claiming `image/svg+xml` or `text/html` is stored as
`application/octet-stream` with `Content-Disposition: attachment`, exactly as the local
driver serves it. That is not paranoia about the bucket's own host: `publicUrl` is
normally a CDN, a CDN is normally a subdomain of the application, and an SVG scripts
whatever origin renders it (SPEC.md §85). The record in the library keeps the type the
uploader claimed; only what the bucket is told changes.

## Workspace dependencies

- `@assemora/schema`
- `@assemora/core`
- `@assemora/data`
