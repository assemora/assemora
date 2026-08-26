/**
 * Serving a directory of files (SPEC.md §85).
 *
 * Everything an application declares is an API endpoint, mounted below the prefix and
 * described in the Schema Registry. A single-page application is neither: it lives at
 * the origin's root rather than under `/api`, and a stylesheet is not something to
 * document in OpenAPI. So it is mounted separately, and this is the only part of the
 * HTTP layer that reads from a disk.
 *
 * The rules here are the ones static serving gets wrong:
 * a path may not climb out of the root, a type is chosen from the extension rather
 * than guessed from the bytes, and a hashed asset is immutable while the entry
 * document is never cached — otherwise a deploy leaves browsers on the old one.
 */
import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { extname, join, normalize, resolve, sep } from 'node:path'

import { AssemoraError } from '@assemora/core'

export type AssetsOptions = {
  /** Where they are served from. `/studio` puts the entry document at `/studio`. */
  readonly path: string
  /** The directory on disk. Absolute. */
  readonly root: string
  /**
   * What a request for an unknown path answers with.
   *
   * A single-page application routes in the browser, so `/studio/pages/42` has to
   * return the entry document rather than a 404 — the router decides what that URL
   * means, and only it can. `false` turns it off for a directory of plain files.
   */
  readonly fallback?: string | false
}

/**
 * Types a browser is given for a static file.
 *
 * The list is deliberately short: anything not on it is served as a download rather
 * than rendered, so a file that ended up in the directory by accident cannot become
 * a page on this origin (SPEC.md §85).
 */
const TYPES: Readonly<Record<string, string>> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.map': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
}

export const assetContentType = (path: string): string =>
  TYPES[extname(path).toLowerCase()] ?? 'application/octet-stream'

/**
 * A bundler fingerprints what it builds, so `main-8f3a1c.js` is immutable and the
 * document that references it must never be — a cached entry document points at the
 * assets of the deploy before this one.
 */
export const assetCacheControl = (path: string): string =>
  /-[0-9a-f]{8,}\.[a-z0-9]+$/i.test(path) ? 'public, max-age=31536000, immutable' : 'no-cache'

/**
 * Refuses a path that would leave the directory.
 *
 * The URL arrives from outside, and `../../etc/passwd` is a URL. Resolving first and
 * comparing after is what catches the encodings that normalising alone does not.
 */
export const resolveAsset = (root: string, requested: string): string => {
  const decoded = (() => {
    try {
      return decodeURIComponent(requested)
    } catch {
      // A malformed escape is not a path anybody meant; treat it as one that misses.
      throw new AssemoraError('NOT_FOUND', 'No such file', { status: 404 })
    }
  })()

  // A null byte truncates a path in some system calls, so it never reaches one.
  if (decoded.includes('\0')) {
    throw new AssemoraError('NOT_FOUND', 'No such file', { status: 404 })
  }

  const base = resolve(root)
  const target = resolve(join(base, normalize(decoded)))

  if (target !== base && !target.startsWith(base + sep)) {
    throw new AssemoraError('NOT_FOUND', 'No such file', { status: 404 })
  }

  return target
}

export type ServedAsset = {
  readonly path: string
  readonly size: number
  readonly contentType: string
  readonly cacheControl: string
  readonly stream: () => NodeJS.ReadableStream
}

/**
 * The file a request resolves to, or `undefined` when nothing does.
 *
 * A directory resolves to its `index.html`, and an unknown path to the fallback —
 * that is what makes browser-side routing work behind this.
 */
export const findAsset = async (
  options: AssetsOptions,
  requested: string,
): Promise<ServedAsset | undefined> => {
  const fallback = options.fallback ?? 'index.html'

  const candidate = async (relative: string): Promise<ServedAsset | undefined> => {
    const target = resolveAsset(options.root, relative)
    const found = await stat(target).catch(() => undefined)

    if (found === undefined) return undefined
    if (found.isDirectory()) return candidate(join(relative, 'index.html'))

    return {
      path: target,
      size: found.size,
      contentType: assetContentType(target),
      cacheControl: assetCacheControl(target),
      stream: () => createReadStream(target),
    }
  }

  const direct = await candidate(requested === '' ? 'index.html' : requested)

  if (direct !== undefined) return direct
  if (fallback === false) return undefined

  return candidate(fallback)
}
