/**
 * Pages, as Studio reads and writes them (SPEC.md §53, §60).
 *
 * Every write here is a command, and every command carries the version the editor
 * read — so a second editor's newer work comes back as a 409 rather than being
 * quietly overwritten (SPEC.md §66).
 */

import type { BlockTree } from '@assemora/schema'
import { type UseQueryResult, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { api } from './client.ts'

export type PageStatus = 'draft' | 'published' | 'archived'

export type PageSummary = {
  readonly id: string
  readonly slug: string
  readonly title: string
  readonly status: PageStatus
  /** Which language it is written in. Absent in an application that serves one. */
  readonly locale?: string
  /** The page this is one language of, or null where it is the original. */
  readonly translationOf?: string | null
  readonly version: number
  readonly publishedAt: string | null
  readonly updatedAt: string
}

export type PageDetail = {
  readonly id: string
  readonly slug: string
  readonly title: string
  readonly status: PageStatus
  readonly locale?: string
  readonly translationOf?: string | null
  readonly mode: 'draft' | 'published'
  readonly tree: BlockTree
  readonly meta: Readonly<Record<string, unknown>>
  readonly version: number
  readonly hasUnpublishedChanges: boolean
  readonly publishedAt: string | null
  readonly updatedAt: string
}

export type Paged<T> = {
  readonly data: readonly T[]
  readonly total: number
  readonly page: number
  readonly perPage: number
  readonly lastPage: number
}

/**
 * What a page command answers with.
 *
 * A tree edit hands back the tree and the version it produced; `pages.publish` and
 * `pages.delete` answer about the page rather than about a tree, so neither is
 * promised. Declaring them as always present would be a type that lies.
 */
export type TreeResult = {
  readonly id: string
  readonly version?: number
  readonly tree?: BlockTree
  readonly blockId?: string
}

export const usePages = (
  filters: { status?: string; search?: string; page?: number } = {},
): UseQueryResult<Paged<PageSummary>> =>
  useQuery({
    queryKey: ['pages', filters],
    queryFn: ({ signal }) => api.query<Paged<PageSummary>>('pages.list', { ...filters }, signal),
  })

export const usePage = (id: string | undefined, mode: 'draft' | 'published' = 'draft') =>
  useQuery({
    queryKey: ['page', id, mode],
    queryFn: ({ signal }) => api.query<PageDetail>('pages.get', { id, mode }, signal),
    enabled: id !== undefined && id !== '',
    // The builder holds the tree itself once it starts editing; refetching under it
    // would throw away what the last command returned.
    staleTime: Number.POSITIVE_INFINITY,
  })

export const usePageMutation = () => {
  const client = useQueryClient()

  return useMutation({
    mutationFn: ({ command, input }: { command: string; input: Record<string, unknown> }) =>
      api.command<Record<string, unknown>>(command, input),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ['pages'] })
    },
  })
}
