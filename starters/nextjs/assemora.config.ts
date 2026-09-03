/**
 * How the `assemora` command finds this project (ADR-0021).
 *
 * The CLI never builds an application of its own. It imports the one below, boots it
 * once, and asks it questions — so `assemora routes` lists the routes this project
 * actually registers rather than a parse of its source, and `assemora agents` goes
 * through the Query Bus, authorized and audited, like every other read.
 *
 * It knows nothing about Next.js, and it should not: the CLI describes the
 * application layer, and the frontend is a client of it like Studio and the SDK are.
 *
 * Every path here is relative to this file, so a command means the same thing typed
 * from `src/` as from the project root.
 */
import { defineConfig } from '@assemora/cli'

export default defineConfig({
  // Not booted: the CLI boots it, once per process, so two commands share one
  // application and one database pool.
  app: () => import('./src/app.ts').then((module) => module.createApp()),
  server: 'src/server.ts',
  // Where `assemora sdk:generate` writes the typed client (SPEC.md §46). It lands on
  // the Next.js side because that is the half of this project that calls the API.
  sdk: { out: 'app/lib/sdk.ts' },
})
