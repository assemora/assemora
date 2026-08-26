/**
 * Serving this application's own frontend (SPEC.md §59).
 *
 * Studio's builder canvas is an iframe, and what it loads is *this* — the real
 * renderer, with this application's block views and this application's theme. That
 * is the whole reason the canvas is an iframe: what an editor sees is not a second
 * implementation of the page.
 *
 * A deployment puts the bundle behind a CDN and never reaches this file. In
 * development it is the shortest honest way to have the frame and the API on one
 * origin, which the session cookie needs.
 */
import { readFile } from 'node:fs/promises'
import { extname, join, normalize, resolve, sep } from 'node:path'

import { AssemoraError } from '@assemora/core'
import { bytes, type Route, route } from '@assemora/http'

const ROOT = resolve(new URL('../web/dist', import.meta.url).pathname)

const TYPES: Readonly<Record<string, string>> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.map': 'application/json',
}

const NOT_BUILT =
  'The preview bundle has not been built. Run `pnpm --filter @assemora/playground build`.'

/** Refuses a path that would climb out of the bundle. */
const inside = (path: string): string => {
  const target = resolve(join(ROOT, normalize(path)))

  if (target !== ROOT && !target.startsWith(ROOT + sep)) {
    throw new AssemoraError('INVALID_PATH', 'That path leaves the bundle', { status: 422 })
  }

  return target
}

const send = async (path: string) => {
  try {
    return bytes(
      new Uint8Array(await readFile(inside(path))),
      TYPES[extname(path)] ?? 'application/octet-stream',
    )
  } catch (error) {
    if (error instanceof AssemoraError) throw error

    throw new AssemoraError('PREVIEW_NOT_BUILT', NOT_BUILT, { status: 503 })
  }
}

export const previewRoutes = (): Route[] => [
  route.get('/preview', {
    description: 'The application frontend, which the builder canvas renders inside',
    tags: ['preview'],
    handler: () => send('index.html'),
  }),

  route.get('/preview/*', {
    description: 'An asset of the application frontend',
    tags: ['preview'],
    handler: ({ request }) => {
      const path = (request as { params: Record<string, string | undefined> }).params['*'] ?? ''

      // Vite writes hashed filenames, so anything with an extension is an asset and
      // everything else is the single-page entry.
      return extname(path) === '' ? send('index.html') : send(path)
    },
  }),
]
