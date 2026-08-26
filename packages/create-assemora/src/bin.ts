#!/usr/bin/env node
/**
 * The `create-assemora` executable — what `pnpm create assemora my-project` runs.
 *
 * It does the one thing `run()` deliberately does not: end the process. Setting
 * `process.exitCode` rather than calling `process.exit()` lets Node flush what was
 * written first, which `process.exit()` would truncate mid-line.
 */
import { run } from './cli.js'

process.exitCode = await run(process.argv.slice(2), {
  cwd: process.cwd(),
  input: process.stdin,
  output: process.stdout,
  error: process.stderr,
  interactive: process.stdin.isTTY === true,
})
