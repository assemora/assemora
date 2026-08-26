/**
 * How the `assemora` command finds this example (ADR-0021).
 *
 * `assemora blocks` is the one worth trying here: it lists every block this site
 * offers, with the fields and the nesting rules, read from the Schema Registry rather
 * than from `src/blocks.ts`.
 */
import { defineConfig } from '@assemora/cli'

export default defineConfig({
  app: () => import('./src/app.ts').then((module) => module.createApp().app),
  server: 'src/server.ts',
})
