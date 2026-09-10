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

/**
 * Node's type-stripping notice, silenced — and nothing else.
 *
 * Running a project's TypeScript directly is the mechanism this CLI is built on
 * (ADR-0005), so node announces it as experimental the moment `assemora.config.ts` is
 * loaded. The announcement is addressed to whoever chose the flag, and nobody did:
 * every `assemora` command printed it, so the first thing somebody trying the
 * framework read was that it might change at any moment.
 *
 * The child process is given `--disable-warning=ExperimentalWarning` instead
 * (`commands/run.ts`), which is what this repository already does in its own scripts.
 * A flag cannot be passed through `#!/usr/bin/env node`, so the same thing is done
 * here by hand — narrower, in fact: it drops one warning by name and hands every
 * other one to the printer node came with, so a deprecation, or an experiment a
 * project really did opt into, still arrives.
 */
const printers = process.listeners('warning')

process.removeAllListeners('warning')
process.on('warning', (warning) => {
  if (warning.name === 'ExperimentalWarning' && warning.message.includes('Type Stripping')) return

  for (const printer of printers) printer(warning)
})

const compiled = new URL('./dist/bin.js', import.meta.url)

if (existsSync(compiled)) {
  await import(compiled.href)
} else {
  // `process.exitCode` rather than `process.exit()`, for the reason `src/bin.ts` gives:
  // exiting outright truncates what is still being written.
  process.stderr.write('assemora: @assemora/cli is not built. Run `pnpm build` first.\n')
  process.exitCode = 1
}
