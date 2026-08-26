/**
 * The root layout every route is rendered inside — Next.js requires exactly one.
 *
 * It is an ordinary Next.js file and Assemora has no opinion about it. That is the
 * shape of this whole starter: the frontend stays yours, and the CMS is something it
 * reads.
 */
import type { Metadata, Viewport } from 'next'
import type { ReactNode } from 'react'

import './globals.css'

export const metadata: Metadata = {
  title: 'My site',
  description: 'An Assemora application with a Next.js frontend',
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
}

const RootLayout = ({ children }: { readonly children: ReactNode }) => (
  <html lang="en">
    <body>{children}</body>
  </html>
)

export default RootLayout
