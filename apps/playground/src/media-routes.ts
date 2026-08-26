/**
 * Where the bytes are served from (SPEC.md §63).
 *
 * Reading the library is a query — `media.list` and `media.get` on the Query Bus,
 * reachable through `mountQueries()` like every other read. What is left here is the
 * one thing a query cannot express: handing over a file. `@assemora/media` owns the
 * library but not its URLs, because the content layer does not depend on the HTTP
 * layer (SPEC.md §8), so an application decides where its files live.
 */
import { NotFoundError } from '@assemora/core'
import { bytes, type Route, route } from '@assemora/http'
import { currentStorage, Media, safeContentType } from '@assemora/media'
import { string } from '@assemora/schema'

/** A stored file never changes under its URL: the path carries a UUID. */
const IMMUTABLE = { 'cache-control': 'public, max-age=31536000, immutable' }

/**
 * What a browser is told about a stored file.
 *
 * The type is narrowed to one a browser may safely render, and anything else is a
 * download — an upload must not become a page on this origin (SPEC.md §85).
 */
const headersFor = (mimeType: string, filename: string) => {
  const type = safeContentType(mimeType)

  return type === 'application/octet-stream'
    ? {
        ...IMMUTABLE,
        'content-disposition': `attachment; filename="${filename.replace(/[^\w.-]/g, '_')}"`,
      }
    : IMMUTABLE
}

export const mediaRoutes = (): Route[] => [
  route.get('/media/by-id/:id', {
    description: 'Serves a stored file by its library id',
    tags: ['media'],
    params: { id: string() },
    errors: [{ code: 'NOT_FOUND', status: 404, description: 'No such file' }],
    handler: async ({ params }) => {
      const item = await Media.find(params.id)

      if (item === null) throw new NotFoundError('media', params.id)

      return bytes(
        await currentStorage().get(item.path),
        safeContentType(item.mimeType),
        headersFor(item.mimeType, item.filename),
      )
    },
  }),

  route.get('/media/*', {
    description: 'Serves a stored file by its storage path',
    tags: ['media'],
    errors: [{ code: 'NOT_FOUND', status: 404, description: 'No such file' }],
    handler: async ({ request }) => {
      const path = (request as { params: Record<string, string | undefined> }).params['*'] ?? ''
      const item = await Media.where('path', path).first()

      if (item === null) throw new NotFoundError('media', path)

      return bytes(
        await currentStorage().get(item.path),
        safeContentType(item.mimeType),
        headersFor(item.mimeType, item.filename),
      )
    },
  }),
]
