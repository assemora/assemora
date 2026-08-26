#!/usr/bin/env node
/**
 * The `assemora` executable.
 *
 * It does the one thing `run()` deliberately does not: end the process. Setting
 * `process.exitCode` rather than calling `process.exit()` lets Node flush what was
 * written first — `process.exit()` truncates a piped listing halfway through a line.
 */
import { run } from './index.js'

process.exitCode = await run(process.argv.slice(2))
