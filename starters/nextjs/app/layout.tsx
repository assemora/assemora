/**
 * The root layout every route is rendered inside — Next.js requires exactly one.
 *
 * It is an ordinary Next.js file and Assemora has one opinion about it: the theme's
 * stylesheet is linked here, because it is what a token in a block's design means.
 * Everything else is the shape of this whole starter — the frontend stays yours, and
 * the CMS is something it reads.
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

/**
 * Two stylesheets, and only one of them is this project's.
 *
 * The theme (SPEC.md §62) defines what `xl`, `wide` and `surface-sunken` mean and
 * carries the rules the universal design controls need, so a block given some spacing
 * in the builder actually gets some. It is served by the application, edited in
 * Studio's Design section, and this address never changes — it answers with the
 * stylesheet's own version in the URL, which is cached for a year.
 *
 * `/api/theme.css` is written relative, and it resolves on *this* origin because
 * `next.config.ts` forwards the whole `/api` prefix to the application, redirect
 * included. That is the same rewrite the session cookie and CSRF depend on, so a
 * deployment that broke this address broke signing in first.
 */
const RootLayout = ({ children }: { readonly children: ReactNode }) => (
  <html lang="en">
    <head>
      <link rel="stylesheet" href="/api/theme.css" />
    </head>
    <body>{children}</body>
  </html>
)

export default RootLayout
