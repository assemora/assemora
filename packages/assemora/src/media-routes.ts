/**
 * Where the bytes are served from (SPEC.md §63).
 *
 * Reading the library is a query — `media.list` and `media.get`, reachable through
 * `mountQueries()` like every other read. What is left is the one thing a query
 * cannot express: handing over a file. `@assemora/media` owns the library but not its
 * URLs, because the content layer does not depend on the HTTP layer (SPEC.md §8).
 *
 * Handing it over is still a read, so it asks the same question the query asks, on
 * the same bus: `media.get` consults the policy for `media` and leaves an audit
 * entry, and only then are the bytes fetched from storage. A route that went to the
 * model directly would answer 200 to anybody who had ever seen a URL, past a policy
 * written to stop exactly that (SPEC.md §51, §67).
 *
 * These are mounted under the API prefix, so the local driver is built with a
 * `baseUrl` of `<prefix>/media`. The two have to agree, or every image Studio renders
 * is a 404 — which is why the umbrella builds the driver rather than taking one path
 * here and another there.
 */
import { NotFoundError, type QueryBus } from '@assemora/core'
import { type BytesResponse, bytes, type Route, route } from '@assemora/http'
import { currentStorage, GetMedia, Media, safeContentType } from '@assemora/media'
import { string } from '@assemora/schema'

/** A stored file never changes under its URL: the path carries a UUID. */
const IMMUTABLE = { 'cache-control': 'public, max-age=31536000, immutable' }

type StoredMedia = NonNullable<Awaited<ReturnType<typeof Media.find>>>

/**
 * What a browser is told about a stored file.
 *
 * The type is narrowed to one a browser may safely render, and anything else is a
 * download — an upload must not become a page on this origin (SPEC.md §85). The
 * `nosniff` header every response carries is the other half of that pair.
 */
const headersFor = (mimeType: string, filename: string): Readonly<Record<string, string>> => {
  const type = safeContentType(mimeType)

  return type === 'application/octet-stream'
    ? {
        ...IMMUTABLE,
        'content-disposition': `attachment; filename="${filename.replace(/[^\w.-]/g, '_')}"`,
      }
    : IMMUTABLE
}

/** The file itself, once the library has agreed this caller may have it. */
const send = async (item: StoredMedia | null, requested: string): Promise<BytesResponse> => {
  if (item === null) throw new NotFoundError('media', requested)

  return bytes(
    await currentStorage().get(item.path),
    safeContentType(item.mimeType),
    headersFor(item.mimeType, item.filename),
  )
}

const ANSWERS = [
  { code: 'NOT_FOUND', status: 404, description: 'No such file' },
  { code: 'FORBIDDEN', status: 403, description: 'The actor may not read this file' },
]

export const mediaRoutes = (queries: QueryBus): Route[] => [
  route.get('/media/by-id/:id', {
    description: 'Serves a stored file by its library id',
    tags: ['media'],
    params: { id: string() },
    errors: ANSWERS,
    handler: async ({ params }) => {
      // Asked before anything is read, so this door answers a caller the library
      // refuses exactly as `/queries/media.get` does — 403 whether or not the id
      // names a file, rather than a 404 that says which ids exist.
      await queries.execute(GetMedia, { id: params.id })

      return send(await Media.find(params.id), params.id)
    },
  }),

  route.get('/media/*', {
    description: 'Serves a stored file by its storage path',
    tags: ['media'],
    // The whole of the wildcard, named the way a wildcard route names it. Declaring
    // it is what keeps this handler from reaching into the adapter's own request
    // object for a shape only Fastify knows (SPEC.md §40, §41).
    params: { '*': string() },
    errors: ANSWERS,
    handler: async ({ params }) => {
      const path = params['*']
      const item = await Media.where('path', path).first()

      // A path is not an id, so the row has to be found before the library can be
      // asked about it. Nothing of it has left this handler yet.
      if (item === null) throw new NotFoundError('media', path)

      await queries.execute(GetMedia, { id: item.id })

      return send(item, path)
    },
  }),
]
