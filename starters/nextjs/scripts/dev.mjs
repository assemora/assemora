/**
 * Runs both halves of this project at once.
 *
 * They are genuinely two processes: Assemora is an HTTP application with its own
 * lifecycle, and Next.js is a bundler and a server with its own. Nothing here hides
 * that — `pnpm dev:api` and `pnpm dev:web` run either one alone, which is also how a
 * deployment runs them, in two containers. This file exists so that the first thing
 * anybody types after `pnpm install` shows a working site.
 *
 * It has no dependencies on purpose. Delete it and run the two scripts in two
 * terminals if you prefer; nothing else refers to it.
 */
import { spawn } from 'node:child_process'

/** `dev` or `start`: the pair of scripts to run is named after it. */
const mode = process.argv[2] === 'start' ? 'start' : 'dev'

/**
 * The package manager that is running this script.
 *
 * npm, pnpm, yarn and bun all announce themselves here when they run a script, which
 * is what lets a generated project be installed with any of them and still have one
 * `dev` command. On Windows each of them is a `.cmd` shim, which `spawn` only finds
 * through a shell.
 */
const agent = process.env.npm_config_user_agent ?? ''
const manager = ['pnpm', 'yarn', 'bun'].find((name) => agent.startsWith(name)) ?? 'npm'

const children = ['api', 'web'].map((half) =>
  spawn(manager, ['run', `${mode}:${half}`], {
    stdio: 'inherit',
    shell: process.platform === 'win32',
  }),
)

/**
 * One of them stopping stops the other.
 *
 * A frontend still serving pages against an application that has crashed is worse
 * than no frontend at all: every request becomes a confusing error rather than an
 * obvious one, and the terminal that would have said why has scrolled away.
 */
let stopping = false

const stop = (code) => {
  if (stopping) return

  stopping = true
  for (const child of children) child.kill('SIGTERM')
  process.exitCode = code
}

for (const child of children) {
  child.on('exit', (code, signal) => stop(signal === null ? (code ?? 1) : 0))
  child.on('error', (error) => {
    console.error(error)
    stop(1)
  })
}

// Ctrl-C reaches the children through the process group already; this is for a `kill`
// sent to this process alone, which is how a supervisor asks it to stop.
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => stop(0))
