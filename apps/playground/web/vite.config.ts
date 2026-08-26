import { fileURLToPath } from 'node:url'

import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

/**
 * The application's own frontend bundle.
 *
 * Built into `web/dist` and served by the application at `/preview`, which is the
 * URL Studio's canvas iframe points at (SPEC.md §59).
 */
export default defineConfig({
  plugins: [react()],
  root: fileURLToPath(new URL('.', import.meta.url)),
  base: '/preview/',
  build: { outDir: 'dist', emptyOutDir: true },
  server: { port: 4100, proxy: { '/api': 'http://127.0.0.1:4000' } },
})
