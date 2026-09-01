/** The media library, as Studio reads it (SPEC.md §63). */
import { type UseQueryResult, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import type { Translate } from '../i18n/messages.ts'
import { api, upload } from './client.ts'

export type MediaItem = {
  readonly id: string
  readonly filename: string
  readonly mimeType: string
  readonly size: number
  readonly width: number | null
  readonly height: number | null
  readonly alt: string | null
  readonly url: string
  readonly createdAt: string
}

export type MediaPage = {
  readonly data: readonly MediaItem[]
  readonly total: number
  readonly page: number
  readonly perPage: number
  readonly lastPage: number
}

export const useMedia = (page = 1): UseQueryResult<MediaPage> =>
  useQuery({
    queryKey: ['media', page],
    queryFn: ({ signal }) => api.query<MediaPage>('media.list', { page }, signal),
  })

export const useUpload = () => {
  const client = useQueryClient()

  return useMutation({
    mutationFn: (file: File) => upload(file),
    onSuccess: () => client.invalidateQueries({ queryKey: ['media'] }),
  })
}

export const useDeleteMedia = () => {
  const client = useQueryClient()

  return useMutation({
    mutationFn: (id: string) => api.command('media.delete', { id }),
    onSuccess: () => client.invalidateQueries({ queryKey: ['media'] }),
  })
}

/**
 * A file size in the unit a person would say it in.
 *
 * It takes `t` because the unit is a word: `КБ` and `МБ` in Ukrainian and Russian, and a
 * decimal comma rather than a point. The number goes over as a *number* so that the
 * language formats it — rounded to one place here, because rounding is a decision about
 * the size and not about the language.
 */
export const readableSize = (bytes: number, t: Translate): string => {
  if (bytes < 1024) return t('media.size.bytes', { size: bytes })
  if (bytes < 1024 * 1024) return t('media.size.kilobytes', { size: Math.round(bytes / 1024) })

  return t('media.size.megabytes', { size: Math.round((bytes / (1024 * 1024)) * 10) / 10 })
}

export const isImage = (item: MediaItem): boolean => item.mimeType.startsWith('image/')
