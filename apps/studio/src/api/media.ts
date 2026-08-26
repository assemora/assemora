/** The media library, as Studio reads it (SPEC.md §63). */
import { type UseQueryResult, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

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

export const readableSize = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`

  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export const isImage = (item: MediaItem): boolean => item.mimeType.startsWith('image/')
