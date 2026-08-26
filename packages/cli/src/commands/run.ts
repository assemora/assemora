/**
 * `dev`, `start` and `build` — running the project (SPEC.md §77).
 *
 * The three commands are one idea: the CLI spawns a process and lives exactly as
 * long as it does. Node 24 executes TypeScript directly, so `assemora dev` is
 * `node --watch src/server.ts` and nothing more. There is no transpiler here and
 * there must not be one — it would put a build step back between the file a
 * developer edits and the file that runs, which is the step Node removed.
 *
 * `build` is the exception that proves it: the only thing it compiles is the
 * project's types, and it does that with the project's own TypeScript.
 */
import { spawn } from 'node:child_process'
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

/** The signals a terminal sends when it wants what is running to stop. */
const FORWARDED = ['SIGINT', 'SIGTERM'] as const satisfies readonly NodeJS.Signals[]

/**
 * Runs a child process to completion and answers with its exit code.
 *
 * Two things here are the whole point. Listening for SIGINT and SIGTERM suppresses
 * Node's default of dying on the spot, so Ctrl-C asks the child to stop and the CLI
 * stays alive until it has — a `dev` server never outlives the command that started
 * it, and never keeps the port. And a second signal escalates to SIGKILL, because
 * a child that ignores SIGTERM would otherwise make Ctrl-C look broken.
 *
 * The child is not detached, so it shares the process group and a terminal's own
 * Ctrl-C reaches it as well. The forwarding is what covers `kill` sent to the CLI
 * alone, which is how a supervisor stops a process.
 */
const spawnProcess = (
  executable: string,
  argv: readonly string[],
  options: { readonly cwd: string },
): Promise<number> =>
  new Promise<number>((resolve, reject) => {
    const child = spawn(executable, [...argv], { cwd: options.cwd, stdio: 'inherit' })

    let asked = false

    const forward = (signal: NodeJS.Signals): void => {
      child.kill(asked ? 'SIGKILL' : signal)
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
 * `dev` and `start`, which differ by one flag.
 *
 * Everything after `--` is node's, and node reads its own options before the script
 * path: `assemora dev -- --inspect` runs `node --watch --inspect src/server.ts`.
 * Arguments meant for the server itself have a better home — a server already reads
 * its port and its database URL from the environment, and the environment is
 * inherited whole.
 *
 * The child is `process.execPath` rather than the word `node`, so the server runs
 * under the same Node the CLI is running under, whatever PATH happens to say.
 */
const runServer = async (cwd: string, args: ParsedArgs, watch: boolean): Promise<number> => {
  const loaded = await loadConfig(cwd)
  const entry = await serverEntry(loaded)

  return spawnProcess(
    process.execPath,
    [...(watch ? ['--watch'] : []), ...args.passthrough, entry],
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
 * A project that declares its own `build` script owns the answer, and this defers to
 * it whole rather than running half of each. Otherwise: typecheck first, because
 * generating an OpenAPI document from an application that does not compile is worse
 * than generating nothing, and then regenerate exactly what the config declares.
 *
 * Any failed step answers `1`. A child's own code is not passed through, because `2`
 * already means the invocation was wrong and a compiler's `2` does not mean that.
 */
const build: CommandHandler = async ({ args, cwd }) => {
  const loaded = await loadConfig(cwd)
  const manifest = await manifestAt(loaded.root)
  const own = scriptNamed(manifest, 'build')

  if (own !== undefined) {
    const manager = await packageManagerFor(loaded.root, manifest)

    line(`Running the project's own build script (${manager} run build): ${own}`)

    const code = await spawnProcess(executableName(manager), ['run', 'build'], {
      cwd: loaded.root,
    })

    return code === 0 ? 0 : 1
  }

  if (!bool(args, 'no-typecheck')) {
    line('Typechecking')

    if ((await typecheck(loaded.root)) !== 0) {
      fail('The typecheck failed, so nothing was regenerated.')

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
    summary: 'typecheck the project and regenerate what the config declares',
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
