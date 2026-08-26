/**
 * What a browser may be told a stored file is (SPEC.md §85).
 *
 * It sits on its own rather than beside the commands because both ends of the library
 * need it. The local driver stores bytes and the serving side narrows the type on the
 * way out; an object store answers by itself, so the S3 driver has to narrow the type
 * on the way *in* — once an object is written with a content type, that is the header
 * the bucket returns and the application is no longer in the request path.
 */

/**
 * Types a browser may be told to render.
 *
 * A content type is chosen by whoever uploads. `text/html` — and `image/svg+xml`,
 * which scripts just as well — would make the media library a way to run a script on
 * the application's own origin, and a CDN in front of a bucket is in practice a
 * subdomain of that origin. Anything not on this list is a download, not a page.
 */
const RENDERABLE = new Set([
  'image/apng',
  'image/avif',
  'image/gif',
  'image/jpeg',
  'image/png',
  'image/webp',
  'video/mp4',
  'video/webm',
  'audio/mpeg',
  'audio/ogg',
  'audio/wav',
  'application/pdf',
  'text/plain',
])

/** What a browser may be told this file is. */
export const safeContentType = (mimeType: string): string =>
  RENDERABLE.has(mimeType.toLowerCase()) ? mimeType.toLowerCase() : 'application/octet-stream'
