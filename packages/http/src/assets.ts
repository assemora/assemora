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
import { realpath, stat } from 'node:fs/promises'
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

/** Whether a resolved path is the directory itself or something under it. */
const contains = (base: string, target: string): boolean =>
  target === base || target.startsWith(base + sep)

/**
 * Refuses a path that would leave the directory, and one naming a dotfile.
 *
 * The URL arrives from outside, and `../../etc/passwd` is a URL. Resolving first and
 * comparing after is what catches the encodings that normalising alone does not.
 *
 * This check is lexical, and lexical is not the whole of it: a symlink inside the
 * root leads out of it without any segment of the URL saying so, which `findAsset`
 * settles by resolving the real path. Both are needed — this one refuses the request
 * before anything touches a disk.
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

  const relative = normalize(decoded)

  // A build produces no dotfiles, and a directory a mount is pointed at grows them
  // around the build: `.env`, `.git/config`, `.npmrc`. Serving one is publishing a
  // secret because it happened to share a folder with a stylesheet (SPEC.md §85).
  // `.well-known` belongs to whatever terminates TLS in front of this, not to a
  // bundle, so there is no exception for it.
  if (relative.split(sep).some((segment) => segment.startsWith('.'))) {
    throw new AssemoraError('NOT_FOUND', 'No such file', { status: 404 })
  }

  const base = resolve(root)
  const target = resolve(join(base, relative))

  if (!contains(base, target)) {
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

  // The root as the filesystem knows it. A mounted directory is itself often reached
  // through links — `/tmp` and `/var` on macOS, a release symlink on a deploy — so
  // comparing a resolved file against an unresolved root would refuse everything.
  const base = await realpath(resolve(options.root)).catch(() => undefined)

  const candidate = async (relative: string): Promise<ServedAsset | undefined> => {
    const target = resolveAsset(options.root, relative)
    // `stat` and `createReadStream` follow symlinks, so the lexical check above is not
    // the last word: one `ln -s` inside a `public/` folder — or a `node_modules` under
    // pnpm, which is a farm of them — serves a file the mount was never pointed at.
    // The real path is what the request actually reaches (SPEC.md §85).
    const real = await realpath(target).catch(() => undefined)

    if (base === undefined || real === undefined || !contains(base, real)) return undefined

    const found = await stat(real).catch(() => undefined)

    if (found === undefined) return undefined
    if (found.isDirectory()) return candidate(join(relative, 'index.html'))

    return {
      path: target,
      size: found.size,
      // The type and the caching are the request's, not the link destination's: a
      // browser asked for `logo.png` and what it is told has to match the URL.
      contentType: assetContentType(target),
      cacheControl: assetCacheControl(target),
      // The bytes come from the path that was checked. Opening `target` again would
      // re-follow a link that could have been replaced since it was resolved.
      stream: () => createReadStream(real),
    }
  }

  let refused = false

  const direct = await candidate(requested === '' ? 'index.html' : requested).catch(() => {
    // Refused, not missing — and the difference decides what happens next. The
    // fallback exists because the router in the browser owns URLs this directory has
    // no file for; `../../etc/passwd` and `.env` are not URLs it owns, so answering
    // them with the entry document would be answering them (SPEC.md §85).
    refused = true

    return undefined
  })

  if (direct !== undefined) return direct
  if (refused || fallback === false) return undefined

  return candidate(fallback).catch(() => undefined)
}
