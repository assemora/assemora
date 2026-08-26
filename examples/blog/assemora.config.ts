/**
 * How the `assemora` command finds this example (ADR-0021).
 *
 * The CLI builds no application of its own: it imports the one below, boots it once
 * and asks it questions, so `assemora routes` lists what this project registers rather
 * than a parse of its source.
 */
import { defineConfig } from '@assemora/cli'

export default defineConfig({
  app: () => import('./src/app.ts').then((module) => module.createApp().app),
  server: 'src/server.ts',
})
