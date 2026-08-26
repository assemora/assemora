/**
 * Where the two halves of this project meet.
 *
 * Assemora and Next.js are two processes — one owns the data, the other owns the
 * pages — but a browser must see exactly one origin, and this file is what makes that
 * true. Everything under `/api` and `/studio` is forwarded to the application server;
 * every other path is a Next.js route.
 *
 * One origin is not a preference, it is what three separate things need:
 *
 * - The session cookie is `httpOnly`, `Secure` and `SameSite=Strict` (SPEC.md §85).
 *   Set by this origin, sent back to this origin.
 * - CSRF is a double-submit cookie: the page reads it and repeats it in a header.
 *   Across origins the page could not read it.
 * assemora:if pages
 * - Studio's builder canvas is an iframe pointed at `/preview`, *relative to Studio's
 *   own origin*, and both ends check `event.origin === location.origin` before they
 *   will speak (SPEC.md §59). A cross-origin canvas is not configuration, it is
 *   silence.
 * assemora:end
 *
 * In production you may prefer a real reverse proxy or a CDN in front of both
 * services; the arrangement is the same and these rewrites are then redundant.
 */
import type { NextConfig } from 'next'

/**
 * The application server. Not public: nothing needs to reach it except this process.
 *
 * A deployment sets it to wherever `assemora start` runs — an internal hostname, a
 * container name, a private URL.
 */
const upstream = process.env.ASSEMORA_URL ?? 'http://127.0.0.1:4000'

const config: NextConfig = {
  // `next dev` otherwise writes an AGENTS.md and a CLAUDE.md into the project root,
  // about Next rather than about this project. Documenting your own application is
  // yours to do; switch this back on if you want Next's notes as well.
  agentRules: false,
  async rewrites() {
    return {
      // `beforeFiles` so that these two prefixes belong to Assemora and nothing in
      // `app/` can shadow them by accident. It is also the reason this project has no
      // `app/api/` directory: that path is spoken for.
      beforeFiles: [
        { source: '/api/:path*', destination: `${upstream}/api/:path*` },
        { source: '/studio', destination: `${upstream}/studio` },
        { source: '/studio/:path*', destination: `${upstream}/studio/:path*` },
      ],
    }
  },
  // assemora:if pages
  async headers() {
    return [
      {
        /**
         * Who may put the builder canvas in an iframe (SPEC.md §59, §85).
         *
         * This is the Next.js side of `frontend.framedBy`, which is the option an
         * application passes when *Assemora* serves the preview. Here Next.js serves
         * it, so Next.js is the only thing that can send the header — and it matters,
         * because `/preview` renders unpublished drafts with the editor's own
         * session. Studio is on this origin, so `'self'` is the whole list.
         */
        source: '/preview',
        headers: [{ key: 'Content-Security-Policy', value: "frame-ancestors 'self'" }],
      },
    ]
  },
  // assemora:end
}

export default config
