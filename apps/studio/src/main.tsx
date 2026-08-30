/**
 * Studio (SPEC.md §58).
 *
 * A React SPA and a client of the application layer: it holds no business logic the
 * API does not have, and it never reaches past the API to the database.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { RouterProvider } from '@tanstack/react-router'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import { worthRetrying } from './api/client.ts'
import { LocaleProvider } from './api/locale.tsx'
import { SessionProvider } from './api/session.tsx'
import { router } from './app/router.tsx'
import './styles.css'

const client = new QueryClient({
  // Every screen, rather than the one that noticed: a query the viewer may not run is
  // a screen that has to explain itself, and every one of them was waiting out a
  // retry before it could.
  defaultOptions: {
    queries: { refetchOnWindowFocus: false, retry: worthRetrying },
  },
})

const container = document.querySelector('#root')

if (container === null) throw new Error('Studio needs a #root element to mount into')

createRoot(container).render(
  <StrictMode>
    <QueryClientProvider client={client}>
      <SessionProvider>
        <LocaleProvider>
          <RouterProvider router={router} />
        </LocaleProvider>
      </SessionProvider>
    </QueryClientProvider>
  </StrictMode>,
)
