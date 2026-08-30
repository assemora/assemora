/**
 * The site's bundle.
 *
 * `pnpm build` writes it into `app/dist`, and the application serves it at `/preview`
 * — the URL Studio's canvas frames. `base` has to match that path, or the document
 * loads and every script in it is a 404.
 *
 * `pnpm build -- --watch` rebuilds while a block view is being written.
 */
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  root: import.meta.dirname,
  base: '/preview/',
  plugins: [react()],
  /**
   * One React, however many packages ask for it.
   *
   * `@assemora/react` is a dependency like any other, and a package manager is free to
   * give it its own copy — which it does the moment this project is linked to a checkout
   * of the framework rather than installed from the registry. Two copies bundle two
   * dispatchers, and a hook called inside `@assemora/react` then reads `null`: the
   * builder canvas goes blank with `Cannot read properties of null (reading 'useRef')`
   * and nothing else says why.
   */
  resolve: { dedupe: ['react', 'react-dom'] },
  build: { outDir: 'dist', emptyOutDir: true },
})
