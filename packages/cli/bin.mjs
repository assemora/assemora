#!/usr/bin/env node
/**
 * The file `assemora` is linked to.
 *
 * A package manager creates the executable when a package is *installed*, and `dist/`
 * does not exist at that moment: it is gitignored and written by `pnpm build`, which
 * runs afterwards. A `bin` pointing straight at `dist/bin.js` is therefore a link to
 * nothing on a fresh clone — pnpm warns once and moves on, and every script that types
 * `assemora` fails for the life of that checkout, which is how CI came to fail on a
 * repository whose sources were fine.
 *
 * So the linked file is committed, and it loads the build. It is `.mjs` rather than
 * TypeScript for the same reason `scripts/copy-templates.mjs` is: it has to run before
 * this package has a build of its own.
 *
 * The build is looked for rather than caught. Catching `ERR_MODULE_NOT_FOUND` around
 * the import would also swallow a missing dependency *inside* the CLI and report it as
 * an unbuilt package, which is a worse lie than the error it replaces.
 */
import { existsSync } from 'node:fs'

const compiled = new URL('./dist/bin.js', import.meta.url)

if (existsSync(compiled)) {
  await import(compiled.href)
} else {
  // `process.exitCode` rather than `process.exit()`, for the reason `src/bin.ts` gives:
  // exiting outright truncates what is still being written.
  process.stderr.write('assemora: @assemora/cli is not built. Run `pnpm build` first.\n')
  process.exitCode = 1
}
