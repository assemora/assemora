/**
 * Reading the library (SPEC.md §15, §63).
 *
 * Through the Query Bus, like every other read: a route that went to the model
 * directly would answer without consulting a policy, and a media library is exactly
 * the kind of thing an application may want to keep behind one (SPEC.md §51).
 */
import { NotFoundError, query } from '@assemora/core'
import { number, string, uuid } from '@assemora/schema'

import { Media } from './models.js'
import { currentStorage } from './storage.js'

type StoredMedia = Awaited<ReturnType<typeof Media.findOrFail>>

const describe = (item: StoredMedia) => ({
  id: item.id,
  filename: item.filename,
  mimeType: item.mimeType,
  size: item.size,
  width: item.width,
  height: item.height,
  alt: item.alt,
  /** Where a browser fetches it. The storage driver decides, not the caller. */
  url: currentStorage().url(item.path),
  createdBy: item.createdBy,
  createdAt: item.createdAt,
})

export const ListMedia = query('media.list', {
  description: 'A page of the media library, newest first',
  input: {
    search: string().optional(),
    type: string().optional(),
    page: number().integer().optional(),
    perPage: number().integer().optional(),
  },
  handle: async ({ search, type, page, perPage }) => {
    let found = Media.orderBy('createdAt', 'desc')

    if (search !== undefined && search !== '') found = found.whereLike('filename', `%${search}%`)
    if (type !== undefined && type !== '') found = found.whereLike('mimeType', `${type}%`)

    const listed = await found.paginate(page ?? 1, Math.min(perPage ?? 40, 100))

    return { ...listed, data: listed.data.map(describe) }
  },
})

export const GetMedia = query('media.get', {
  description: 'One file in the library',
  input: { id: uuid() },
  handle: async ({ id }) => {
    const item = await Media.find(id)

    if (item === null) throw new NotFoundError('media', id)

    return describe(item)
  },
})

export const mediaQueries = [ListMedia, GetMedia] as const
