/**
 * `dev`, `start` and `build` — running the project (SPEC.md §77).
 *
 * The three commands are one idea: the CLI spawns a process and lives exactly as
 * long as it does. Node 24 executes TypeScript directly, so `assemora dev` is
 * `node --watch src/server.ts` and nothing more. There is no transpiler here and
 * there must not be one — it would put a build step back between the file a
 * developer edits and the file that runs, which is the step Node removed.
 *
 * `build` is the exception that proves it: the only thing this CLI compiles is the
 * project's types, and it does that with the project's own TypeScript. A project that
 * bundles something of its own declares a `build` script, and that script is the last
 * of `build`'s three steps rather than a replacement for the other two.
 */
import { type ChildProcess, spawn } from 'node:child_process'
import { readFile, stat } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { constants } from 'node:os'
import { dirname, join } from 'node:path'

import { ConfigurationError } from '@assemora/core'

import { bool, type ParsedArgs } from '../args.js'
import { type LoadedConfig, loadConfig } from '../config.js'
import { fail, line, ok } from '../output.js'
import { type CommandHandler, commandNamed, defineCommand, register } from '../registry.js'

const isFile = async (path: string): Promise<boolean> => {
  try {
    return (await stat(path)).isFile()
  } catch {
    return false
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null

/** What the shell reports for a process a signal killed, and what Ctrl-C leaves behind. */
const codeForSignal = (signal: NodeJS.Signals): number => 128 + (constants.signals[signal] ?? 0)

/**
 * The signals a terminal sends when it wants what is running to stop.
 *
 * SIGHUP is here because the child runs in a process group of its own: closing the
 * terminal signals its foreground group, which is now the CLI alone, so a hangup the
 * CLI does not pass on is a `dev` server left running with no terminal to stop it from.
 */
const FORWARDED = ['SIGINT', 'SIGTERM', 'SIGHUP'] as const satisfies readonly NodeJS.Signals[]

/**
 * Whether a signal can address a whole process group.
 *
 * POSIX has one; Windows has nothing equivalent — the shape of the answer there is
 * `taskkill /T`, a second process spawned to end the first, which is not something to
 * write untested. On Windows the child alone is signalled, exactly as before.
 */
const GROUPS = process.platform !== 'win32'

/**
 * Stops the child, and everything the child started with it.
 *
 * A negative pid addresses the process group, which is the whole reason the child is
 * spawned detached. `assemora dev` runs `node --watch`, and the watcher is a wrapper:
 * the server holding the port is *its* child. Signalling the wrapper alone — and
 * SIGKILL in particular, which it cannot pass on — left the server running with init
 * for a parent and the port still held, which is exactly what the docstring below
 * promises cannot happen.
 */
const stop = (child: ChildProcess, signal: NodeJS.Signals): void => {
  const { pid } = child

  if (pid === undefined) return

  try {
    if (GROUPS) process.kill(-pid, signal)
    else child.kill(signal)
  } catch {
    // ESRCH is the group having already gone, which is the outcome being asked for;
    // anything else is a group that could not be signalled, and the child alone is
    // better than nothing. Neither may throw: this runs inside a signal listener,
    // where an exception ends the process with the child still running.
    child.kill(signal)
  }
}

/**
 * Runs a child process to completion and answers with its exit code.
 *
 * Three things here are the whole point. Listening for the terminal's signals
 * suppresses Node's default of dying on the spot, so Ctrl-C asks the child to stop and
 * the CLI stays alive until it has — a `dev` server never outlives the command that
 * started it, and never keeps the port. A second signal escalates to SIGKILL, because
 * a child that ignores SIGTERM would otherwise make Ctrl-C look broken. And every
 * signal goes to the child's process group rather than to the child, because what is
 * spawned is often a wrapper — `node --watch`, a package manager — and the process
 * that holds the port is one below it.
 *
 * `detached` is what creates that group. It also takes the child out of the terminal's
 * foreground group, so the terminal's own Ctrl-C no longer reaches it directly and the
 * forwarding below is the only path — which is why SIGHUP is forwarded too. And it
 * means a CLI killed outright, with nothing forwarded, leaves the group untouched:
 * `watchdog.ts` is preloaded into the server for exactly that case.
 */
const spawnProcess = (
  executable: string,
  argv: readonly string[],
  options: { readonly cwd: string },
): Promise<number> =>
  new Promise<number>((resolve, reject) => {
    const child = spawn(executable, [...argv], {
      cwd: options.cwd,
      stdio: 'inherit',
      detached: GROUPS,
    })

    let asked = false

    const forward = (signal: NodeJS.Signals): void => {
      stop(child, asked ? 'SIGKILL' : signal)
      asked = true
    }

    const listeners = FORWARDED.map((signal) => {
      const listener = (): void => forward(signal)
      process.on(signal, listener)

      return [signal, listener] as const
    })

    // A CLI that ran two commands in one process would otherwise keep signalling a
    // child that had already exited, and the listeners alone would stop Node leaving.
    const release = (): void => {
      for (const [signal, listener] of listeners) process.off(signal, listener)
    }

    child.once('error', (error) => {
      release()
      reject(error)
    })

    child.once('exit', (code, signal) => {
      release()
      resolve(code ?? (signal === null ? 1 : codeForSignal(signal)))
    })
  })

const serverEntry = async (loaded: LoadedConfig): Promise<string> => {
  if (loaded.server === undefined) {
    throw new ConfigurationError(
      `${loaded.file} declares no "server", so there is nothing to run. ` +
        "Add `server: 'src/server.ts'` — the file that starts the application.",
    )
  }

  if (!(await isFile(loaded.server))) {
    throw new ConfigurationError(
      `${loaded.file} names ${loaded.server} as the server to run, and there is no such file.`,
    )
  }

  return loaded.server
}

/**
 * The preload that takes the server down when the CLI dies with no chance to say so.
 *
 * Under Vitest this module runs from its source, and the file beside it is the source
 * too; Node executes it as it executes the project's own `server.ts`.
 */
const WATCHDOG = new URL(
  import.meta.url.endsWith('.ts') ? './watchdog.ts' : './watchdog.js',
  import.meta.url,
)

/**
 * What node is given to run the server.
 *
 * Everything after `--` is node's, and node reads its own options before the script
 * path: `assemora dev -- --inspect` runs `node --watch --inspect src/server.ts`.
 * Arguments meant for the server itself have a better home — a server already reads
 * its port and its database URL from the environment, and the environment is
 * inherited whole.
 *
 * The watchdog is preloaded with the pid of the process supervising the server, which
 * is what it watches. `--watch` hands node's own flags on to the process it restarts,
 * so the server has it under `dev` too, one process below.
 */
export const serverArgv = (options: {
  readonly watch: boolean
  readonly passthrough: readonly string[]
  readonly entry: string
  readonly supervisor: number
}): string[] => [
  ...(options.watch ? ['--watch'] : []),
  '--import',
  `${WATCHDOG.href}?parent=${options.supervisor}`,
  ...options.passthrough,
  options.entry,
]

/**
 * `dev` and `start`, which differ by one flag.
 *
 * The child is `process.execPath` rather than the word `node`, so the server runs
 * under the same Node the CLI is running under, whatever PATH happens to say.
 */
const runServer = async (cwd: string, args: ParsedArgs, watch: boolean): Promise<number> => {
  const loaded = await loadConfig(cwd)
  const entry = await serverEntry(loaded)

  return spawnProcess(
    process.execPath,
    serverArgv({ watch, passthrough: args.passthrough, entry, supervisor: process.pid }),
    { cwd: loaded.root },
  )
}

const manifestAt = async (root: string): Promise<Record<string, unknown>> => {
  try {
    const parsed: unknown = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))

    return isRecord(parsed) ? parsed : {}
  } catch {
    // The only question being asked of the manifest is whether it declares a build
    // script. A project that has no readable one has not declared anything.
    return {}
  }
}

const scriptNamed = (manifest: Record<string, unknown>, name: string): string | undefined => {
  const scripts = manifest.scripts
  if (!isRecord(scripts)) return undefined

  const script = scripts[name]

  return typeof script === 'string' && script.trim() !== '' ? script : undefined
}

const LOCKFILES = [
  { file: 'pnpm-lock.yaml', executable: 'pnpm' },
  { file: 'yarn.lock', executable: 'yarn' },
  { file: 'bun.lockb', executable: 'bun' },
  { file: 'package-lock.json', executable: 'npm' },
] as const

/**
 * Which package manager runs the project's own `build` script.
 *
 * `packageManager` is asked first because it is the field a project uses to say so;
 * the lockfile answers when it is absent, and npm is what is left when a project has
 * neither. Getting this wrong is cheap and loud — the wrong manager fails to start
 * — where guessing npm unconditionally would run a script against the wrong
 * `node_modules`.
 */
const packageManagerFor = async (
  root: string,
  manifest: Record<string, unknown>,
): Promise<string> => {
  const declared = manifest.packageManager

  if (typeof declared === 'string') {
    const name = declared.split('@')[0]
    if (name !== undefined && name !== '') return name
  }

  for (const { file, executable } of LOCKFILES) {
    if (await isFile(join(root, file))) return executable
  }

  return 'npm'
}

/** On Windows a package manager is a `.cmd` shim, and spawn does not find it otherwise. */
const executableName = (name: string): string =>
  process.platform === 'win32' ? `${name}.cmd` : name

/**
 * The project's own TypeScript, run as a script by the Node already running.
 *
 * Resolving `typescript/package.json` from the project root is what finds it: every
 * version of the package exports that file, where `typescript/bin/tsc` is not
 * reachable through the package's own `exports`. Spawning it through
 * `process.execPath` avoids depending on `node_modules/.bin` being populated, which
 * a pnpm store layout or a hoisting setting is free to change.
 */
const compilerIn = (root: string): string | undefined => {
  try {
    const resolve = createRequire(join(root, 'package.json'))

    return join(dirname(resolve.resolve('typescript/package.json')), 'bin', 'tsc')
  } catch {
    return undefined
  }
}

const typecheck = async (root: string): Promise<number> => {
  const tsconfig = join(root, 'tsconfig.json')

  if (!(await isFile(tsconfig))) {
    throw new ConfigurationError(
      `There is no tsconfig.json in ${root}, so the project cannot be typechecked. ` +
        'Add one, or run `assemora build --no-typecheck`.',
    )
  }

  const compiler = compilerIn(root)

  if (compiler === undefined) {
    throw new ConfigurationError(
      `TypeScript is not installed in ${root}, so there is nothing to typecheck with. ` +
        'Install it as a dependency of the project, or run `assemora build --no-typecheck`.',
    )
  }

  return spawnProcess(process.execPath, [compiler, '--project', tsconfig, '--noEmit'], {
    cwd: root,
  })
}

const NO_ARGUMENTS: ParsedArgs = {
  command: undefined,
  positionals: [],
  flags: {},
  passthrough: [],
}

/**
 * Regenerates one artifact by running the command that owns it.
 *
 * `build` generates nothing itself. `api:openapi` and `sdk:generate` already know
 * how, and reaching them through the command table is what stops a build writing a
 * document that differs from the one the command writes — the reason the table
 * exists at all.
 */
const regenerate = async (name: string, cwd: string): Promise<number> => {
  const command = commandNamed(name)

  if (command === undefined) {
    // Every group registers from `commands/index.ts`, so a missing one is a mistake
    // in the CLI rather than anything the project can fix. It still has to stop the
    // build: a green build that quietly generated nothing is how a stale document
    // reaches a deployment.
    throw new ConfigurationError(
      `The config declares an artifact for "${name}", and this CLI has no such command.`,
    )
  }

  line(`Running ${name}`)

  return command.handler({ args: NO_ARGUMENTS, cwd })
}

/**
 * Everything that must be current before the project is deployed.
 *
 * Three steps, in the only order that makes sense. Typecheck first, because generating
 * an OpenAPI document from an application that does not compile is worse than
 * generating nothing. Then regenerate exactly what the config declares. Then the
 * project's own `build` script, if it declares one — last, because the generated SDK is
 * an input to whatever bundles it, and a bundle built before it is a bundle built
 * against the previous client.
 *
 * The project's script used to be an alternative to the other two rather than a step
 * after them, and the scaffolded project declares one — so `assemora build` there did
 * neither of the things this command exists to do, and `--no-typecheck` was a flag with
 * nowhere to take effect.
 *
 * Any failed step answers `1`. A child's own code is not passed through, because `2`
 * already means the invocation was wrong and a compiler's `2` does not mean that.
 */
const build: CommandHandler = async ({ args, cwd }) => {
  const loaded = await loadConfig(cwd)
  const manifest = await manifestAt(loaded.root)
  const own = scriptNamed(manifest, 'build')

  if (!bool(args, 'no-typecheck')) {
    line('Typechecking')

    if ((await typecheck(loaded.root)) !== 0) {
      fail('The typecheck failed, so nothing was regenerated and nothing was built.')

      return 1
    }
  }

  const declared = [
    ...(loaded.config.openapi === undefined ? [] : ['api:openapi']),
    ...(loaded.config.sdk === undefined ? [] : ['sdk:generate']),
  ]

  if (declared.length === 0) line('The config declares no artifacts to regenerate.')

  for (const name of declared) {
    if ((await regenerate(name, loaded.root)) !== 0) {
      fail(`${name} failed, so the build is not complete.`)

      return 1
    }
  }

  if (own !== undefined) {
    const manager = await packageManagerFor(loaded.root, manifest)

    line(`Running the project's own build script (${manager} run build): ${own}`)

    if (
      (await spawnProcess(executableName(manager), ['run', 'build'], { cwd: loaded.root })) !== 0
    ) {
      fail("The project's own build script failed, so the build is not complete.")

      return 1
    }
  }

  ok('Build complete.')

  return 0
}

register(
  defineCommand({
    name: 'dev',
    group: 'run',
    summary: 'run the server and restart it when a file changes',
    usage: 'assemora dev [-- <node options>]',
    handler: ({ args, cwd }) => runServer(cwd, args, true),
  }),
  defineCommand({
    name: 'build',
    group: 'run',
    summary: "typecheck, regenerate what the config declares, run the project's build",
    usage: 'assemora build [--no-typecheck]',
    handler: build,
  }),
  defineCommand({
    name: 'start',
    group: 'run',
    summary: 'run the server',
    usage: 'assemora start [-- <node options>]',
    handler: ({ args, cwd }) => runServer(cwd, args, false),
  }),
)
