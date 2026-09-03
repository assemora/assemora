#!/usr/bin/env node
/**
 * The file `create-assemora` is linked to.
 *
 * The same defect and the same fix as `packages/cli/bin.mjs`, which explains both: the
 * executable is created when the package is installed, and `dist/` is written after
 * that, so the name has to be linked to a file a fresh clone already has.
 */
import { existsSync } from 'node:fs'

const compiled = new URL('./dist/bin.js', import.meta.url)

if (existsSync(compiled)) {
  await import(compiled.href)
} else {
  process.stderr.write('create-assemora: the package is not built. Run `pnpm build` first.\n')
  process.exitCode = 1
}
