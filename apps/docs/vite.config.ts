/**
 * The documentation site.
 *
 * There is nothing to configure beyond React, because the pages are not data this app
 * fetches: `src/guide.ts` reads `docs/guide/*.md` at build time through
 * `import.meta.glob`, so the built site is static and the Markdown files stay the one
 * copy of the guide.
 *
 * `base` is relative so the output can be served from a subdirectory — or opened from
 * disk — without being rebuilt for the path it landed on.
 */
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  root: import.meta.dirname,
  base: './',
  plugins: [react()],
  build: { outDir: 'dist', emptyOutDir: true },
  server: { port: 4200 },
})
