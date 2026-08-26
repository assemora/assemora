import tailwind from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

const API = process.env.ASSEMORA_API ?? 'http://127.0.0.1:4000'

export default defineConfig({
  plugins: [react(), tailwind()],
  server: {
    port: 5173,
    // Studio talks to the application through the same origin it is served from, so
    // the session cookie is first-party in development as it is in production.
    proxy: {
      '/api': { target: API, changeOrigin: true },
      // The builder canvas is an iframe on this origin, so it shares the session
      // cookie and Studio can talk to it (SPEC.md §59).
      '/preview': { target: `${API}/api`, changeOrigin: true },
    },
  },
})
