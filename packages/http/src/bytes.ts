/**
 * Answering with bytes (SPEC.md §41).
 *
 * Routes are schema-first and answer with JSON, which is right for an API and wrong
 * for a file. A handler that has bytes returns them wrapped in this marker, and the
 * adapter sends them untouched instead of running them through a response schema.
 *
 * ```ts
 * route.get('/media/*', {
 *   handler: async ({ params }) => bytes(await storage.get(params.path), 'image/png'),
 * })
 * ```
 *
 * It stays an explicit, narrow escape hatch: the marker names no server library, so
 * a handler still never sees Fastify.
 */

export type BytesResponse = {
  readonly node: 'bytes'
  readonly body: Uint8Array
  readonly contentType: string
  readonly headers: Readonly<Record<string, string>>
}

export const bytes = (
  body: Uint8Array,
  contentType: string,
  headers: Readonly<Record<string, string>> = {},
): BytesResponse => ({ node: 'bytes', body, contentType, headers })

export const isBytesResponse = (value: unknown): value is BytesResponse =>
  typeof value === 'object' &&
  value !== null &&
  (value as BytesResponse).node === 'bytes' &&
  (value as BytesResponse).body instanceof Uint8Array
