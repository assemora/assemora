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
  /**
   * The directory, inside the root, whose files carry a fingerprint in their name.
   *
   * A bundler writes its output under one directory and hashes every name in it, and
   * copies `public/` to the root untouched. So which files may be kept forever is a
   * fact about *where* they are, and the deployment knows it — `assets/` for Vite,
   * `_next/static/` for Next.js, `false` for a directory of plain files.
   *
   * It used to be guessed from the name, by a pattern looking for a hexadecimal hash.
   * Rollup fingerprints in base64url, so the guess matched none of the 27 files this
   * repository builds and every one of them was served `no-cache`. Widening the
   * alphabet does not fix it: base64url is also the alphabet English is written in,
   * so `hero-photograph.jpg` and `photo-20260903.jpg` are indistinguishable from a
   * hash by any rule short of reading the manifest — and a wrong guess in that
   * direction pins a file in every browser's cache for a year, with no way to reach
   * it. A directory is a fact rather than a guess, and it is the caller's to state.
   */
  readonly immutable?: string | false
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

/** A year — the longest `max-age` the specification gives any meaning to. */
export const IMMUTABLE = 'public, max-age=31536000, immutable'

/**
 * Where a bundler puts what it fingerprints, unless the caller says otherwise.
 *
 * Vite's `assetsDir`, and so the directory both of this repository's mounts serve
 * from. A project on a bundler that chooses differently passes its own.
 */
export const DEFAULT_IMMUTABLE = 'assets/'

/**
 * How long a browser may keep a file without asking again.
 *
 * A fingerprinted file may be kept forever, because its name changes when its
 * contents do. Everything else must be revalidated — above all the entry document,
 * which is the one file whose name never changes and which names all the others: a
 * cached one points at the assets of the deploy before this one.
 *
 * `no-cache` does not mean "do not store it". It means "store it, and ask before
 * using it", which with the `ETag` this mount now sends is a 304 and no body.
 */
export const assetCacheControl = (relative: string, immutable: string | false): string => {
  if (immutable === false) return 'no-cache'

  const directory = immutable.endsWith('/') ? immutable : `${immutable}/`

  // Compared on the path *within* the mount, using the separator a URL uses: this is
  // the name the request asked for, before it became a place on a disk.
  return relative.replaceAll(sep, '/').startsWith(directory) ? IMMUTABLE : 'no-cache'
}

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

/**
 * The types worth compressing.
 *
 * Everything a bundler emits as text, and nothing that arrives compressed already.
 * Running gzip over a `woff2` or a `png` spends processor time to make the file
 * slightly larger, and this list is what says so — by type rather than by extension,
 * so a `.map` and a `.json` are one entry rather than two.
 */
const COMPRESSIBLE = /^(?:text\/|application\/(?:json|manifest\+json)|image\/svg\+xml)/

export const isCompressible = (contentType: string): boolean => COMPRESSIBLE.test(contentType)

/**
 * A validator for the file as it is now.
 *
 * Size and modification time, which is what nginx uses and what a file server can
 * answer without reading the bytes. Hashing the contents would be exact and would
 * cost a full read of every file on every request — a strong validator for a
 * property that only matters when the file has *not* changed.
 *
 * Strong rather than weak: these are bytes served verbatim, so two responses with
 * this validator really are identical, which is what lets a range request use it.
 */
export const assetETag = (size: number, modifiedAt: number): string =>
  `"${size.toString(16)}-${Math.floor(modifiedAt).toString(16)}"`

export type ServedAsset = {
  readonly path: string
  readonly size: number
  readonly contentType: string
  readonly cacheControl: string
  /** What a conditional request is answered against. */
  readonly etag: string
  /** The same fact in the older spelling, for a client that sends the older header. */
  readonly modifiedAt: Date
  /** Whether compressing it would make it smaller. */
  readonly compressible: boolean
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

    const contentType = assetContentType(target)

    return {
      path: target,
      size: found.size,
      // The type and the caching are the request's, not the link destination's: a
      // browser asked for `logo.png` and what it is told has to match the URL.
      contentType,
      // On the path within the mount rather than the absolute one: a root that
      // happens to live under a directory called `assets` would otherwise make every
      // file in the deployment immutable.
      cacheControl: assetCacheControl(relative, options.immutable ?? DEFAULT_IMMUTABLE),
      // From the file that is actually read, so a changed link changes the validator.
      etag: assetETag(found.size, found.mtimeMs),
      modifiedAt: found.mtime,
      compressible: isCompressible(contentType),
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
