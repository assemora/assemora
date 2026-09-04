/**
 * Reading the library (SPEC.md §15, §63).
 *
 * Through the Query Bus, like every other read: a route that went to the model
 * directly would answer without consulting a policy, and a media library is exactly
 * the kind of thing an application may want to keep behind one (SPEC.md §51).
 */
import { NotFoundError, query } from '@assemora/core'
import { array, number, object, string, timestamp, uuid } from '@assemora/schema'

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

/** What `describe` answers with, as the document and the SDK read it. */
const described = {
  id: uuid(),
  filename: string(),
  mimeType: string(),
  size: number().integer(),
  width: number().integer().nullable(),
  height: number().integer().nullable(),
  alt: string().nullable(),
  url: string(),
  createdBy: uuid().nullable(),
  createdAt: timestamp(),
} as const

export const ListMedia = query('media.list', {
  description: 'A page of the media library, newest first',
  input: {
    search: string().optional(),
    type: string().optional(),
    page: number().integer().optional(),
    perPage: number().integer().optional(),
  },
  output: {
    data: array(object(described)),
    total: number().integer(),
    page: number().integer(),
    perPage: number().integer(),
    lastPage: number().integer(),
  },
  handle: async ({ search, type, page, perPage }) => {
    // `id` underneath, so the ordering is total: two files uploaded in the same
    // millisecond tie on `createdAt`, and two rows that tie are two rows the database
    // may return in either order — differently on each of the two queries a page is
    // made of. Page two would then repeat one and skip another.
    let found = Media.orderBy('createdAt', 'desc').orderBy('id', 'asc')

    if (search !== undefined && search !== '') found = found.whereLike('filename', `%${search}%`)
    if (type !== undefined && type !== '') found = found.whereLike('mimeType', `${type}%`)

    const listed = await found.paginate(page ?? 1, Math.min(perPage ?? 40, 100))

    return { ...listed, data: listed.data.map(describe) }
  },
})

export const GetMedia = query('media.get', {
  description: 'One file in the library',
  input: { id: uuid() },
  output: described,
  handle: async ({ id }) => {
    const item = await Media.find(id)

    if (item === null) throw new NotFoundError('media', id)

    return describe(item)
  },
})

export const mediaQueries = [ListMedia, GetMedia] as const
