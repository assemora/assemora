/**
 * Who is signed in (SPEC.md §49, §115).
 *
 * The session token itself is an httpOnly cookie, so nothing here ever holds it.
 * What Studio keeps is the answer to `/auth/me`: an identity and a permission set,
 * which is what the navigation and the guards are drawn from.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createContext, type ReactNode, use } from 'react'

import { ApiError, api } from './client.ts'
import { holds } from './permissions.ts'

export type Viewer = {
  readonly id: string
  readonly email: string
  readonly name: string
  readonly permissions: readonly string[]
}

export type Session = {
  readonly viewer: Viewer | undefined
  readonly isLoading: boolean
  readonly can: (permission: string) => boolean
  signIn(credentials: { email: string; password: string }): Promise<void>
  signOut(): Promise<void>
}

const SessionContext = createContext<Session | undefined>(undefined)

export const SessionProvider = ({ children }: { children: ReactNode }) => {
  const client = useQueryClient()

  const viewer = useQuery({
    queryKey: ['viewer'],
    queryFn: async ({ signal }) => {
      try {
        return await api.get<Viewer>('/auth/me', signal)
      } catch (error) {
        // Not signed in is an answer, not a failure: the login screen is the point.
        if (error instanceof ApiError && error.status === 401) return null
        throw error
      }
    },
    retry: false,
  })

  const signIn = useMutation({
    mutationFn: (credentials: { email: string; password: string }) =>
      api.post<{ userId: string }>('/auth/login', credentials),
    onSuccess: async () => {
      await client.invalidateQueries()
    },
  })

  const signOut = useMutation({
    mutationFn: () => api.post('/auth/logout'),
    onSuccess: () => {
      client.clear()
    },
  })

  const permissions = viewer.data?.permissions ?? []

  const session: Session = {
    viewer: viewer.data ?? undefined,
    isLoading: viewer.isLoading,
    can: (permission) => holds(permissions, permission),
    signIn: async (credentials) => {
      await signIn.mutateAsync(credentials)
    },
    signOut: async () => {
      await signOut.mutateAsync()
    },
  }

  return <SessionContext value={session}>{children}</SessionContext>
}

export const useSession = (): Session => {
  const session = use(SessionContext)

  if (session === undefined) throw new Error('useSession outside of a SessionProvider')

  return session
}
