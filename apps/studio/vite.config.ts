import tailwind from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

const API = process.env.ASSEMORA_API ?? 'http://127.0.0.1:4000'

/**
 * Where the built bundle expects to be served from.
 *
 * The published package is built for `/studio/`, because that is where a generated
 * project mounts it — the API keeps `/api` on the same origin, so nothing about the
 * session changes. Development serves it at the root and leaves this alone.
 */
const base = process.env.ASSEMORA_STUDIO_BASE ?? '/'

export default defineConfig({
  base,
  plugins: [react(), tailwind()],
  server: {
    port: 5173,
    // Studio talks to the application through the same origin it is served from, so
    // the session cookie is first-party in development as it is in production.
    proxy: {
      '/api': { target: API, changeOrigin: true },
      // The builder canvas is an iframe on this origin, so it shares the session
      // cookie and Studio can talk to it (SPEC.md §59). It is proxied to the origin
      // root rather than under `/api`: a bundle is not an endpoint, so `assemora`
      // serves the application's frontend beside the API rather than inside it, and
      // the asset URLs baked into that bundle are absolute from the root.
      '/preview': { target: API, changeOrigin: true },
    },
  },
})
