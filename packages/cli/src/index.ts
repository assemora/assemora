/**
 * `@assemora/cli` — the front door (SPEC.md §77, ADR-0021).
 *
 * The CLI is one more client of the application layer. It never imports a feature
 * package and never reaches a database on its own: it loads the project's
 * `assemora.config.ts`, boots the application that config hands back, and asks it
 * questions through the Schema Registry and the Query Bus — the same two doors
 * Studio and an agent use.
 *
 * `run()` returns the exit code instead of taking the process down with it, so the
 * whole CLI is drivable from a test. `bin.ts` is what exits.
 */
import { readFile } from 'node:fs/promises'

import { bool, parseArgs } from './args.js'
import './commands/index.js'
import { detail, fail, line } from './output.js'
import { shutdown } from './project.js'
import { type CliCommand, commandHelpText, helpText, registeredCommands } from './registry.js'

export {
  type AssemoraConfig,
  type AssemoraPaths,
  defineConfig,
  type LoadedConfig,
  type ResolvedPaths,
} from './config.js'

export type RunOptions = {
  /** Where the command runs. Defaults to `process.cwd()`. */
  readonly cwd?: string
  /** What `--version` prints. Defaults to the version of this package. */
  readonly version?: string
  /** The command table. Defaults to everything the groups registered. */
  readonly commands?: readonly CliCommand[]
}

const UNKNOWN_VERSION = '0.0.0-unknown'

/**
 * Read rather than compiled in, so that a published build reports its own version
 * and a checkout reports the one in the repository.
 */
const declaredVersion = async (): Promise<string> => {
  try {
    const manifest: unknown = JSON.parse(
      await readFile(new URL('../package.json', import.meta.url), 'utf8'),
    )
    const version =
      typeof manifest === 'object' && manifest !== null
        ? (manifest as { version?: unknown }).version
        : undefined

    return typeof version === 'string' ? version : UNKNOWN_VERSION
  } catch {
    return UNKNOWN_VERSION
  }
}

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

/** The console methods that write to stdout, which is the stream the answer owns. */
const LOGGING = ['log', 'info', 'debug'] as const

/**
 * Keeps stdout for the answer, for as long as this invocation lasts.
 *
 * `@assemora/core`'s logger writes info records with `console.log`, and every command
 * that inspects an application boots one — so `assemora routes --json | jq` was handed
 * a boot record before the JSON, and `assemora api:openapi --stdout > openapi.json`
 * wrote a file that was not a document. The CLI cannot reach into the logger: the
 * project's config builds the application, and `logger` is its option to pass. What
 * the CLI does own is what stdout means for one invocation, and this is that: anything
 * that is not the answer goes to stderr, which is the rule the whole of `output.ts` is
 * written to.
 *
 * The REPL is unaffected — it writes to its own stream — though a `console.log` typed
 * inside it lands on stderr, where a terminal shows it just the same.
 *
 * It is put back afterwards because `run()` is called in process, by `assemora new`
 * running two commands and by every test in this package.
 */
const keepStdoutForTheAnswer = (): (() => void) => {
  const original = LOGGING.map((name) => [name, console[name]] as const)

  for (const [name] of original) {
    console[name] = (...values: readonly unknown[]) => {
      console.error(...values)
    }
  }

  return () => {
    for (const [name, method] of original) console[name] = method
  }
}

/** The stack and every cause below it — what `--debug` is for. */
const reportStack = (error: unknown): void => {
  let current: unknown = error

  while (current instanceof Error) {
    detail(current.stack ?? `${current.name}: ${current.message}`)
    current = current.cause
  }
}

const close = async (debug: boolean): Promise<void> => {
  try {
    await shutdown()
  } catch (error) {
    // Failing to close is not what the command was asked to do, so it must not
    // change the exit code. It is still worth saying when somebody is looking.
    if (debug) detail(`The application did not shut down cleanly: ${messageOf(error)}`)
  }
}

/**
 * Resolves one invocation and returns its exit code.
 *
 * It never calls `process.exit`: a test drives it in-process, and a command that has
 * written to a pipe needs the process to flush before it leaves.
 */
export const run = async (argv: readonly string[], options: RunOptions = {}): Promise<number> => {
  const args = parseArgs(argv)
  const commands = options.commands ?? registeredCommands()
  const debug = bool(args, 'debug')
  const restoreConsole = keepStdoutForTheAnswer()

  try {
    if (bool(args, 'version')) {
      line(options.version ?? (await declaredVersion()))
      return 0
    }

    // No command at all is a question, not a mistake: the answer is the list.
    if (args.command === undefined) {
      line(helpText(commands))
      return 0
    }

    const command = commands.find((entry) => entry.name === args.command)

    if (command === undefined) {
      fail(`Unknown command "${args.command}". Run \`assemora --help\` to see what there is.`)
      return 2
    }

    if (bool(args, 'help') || bool(args, 'h')) {
      line(commandHelpText(command))
      return 0
    }

    return await command.handler({ args, cwd: options.cwd ?? process.cwd() })
  } catch (error) {
    fail(messageOf(error))
    if (debug) reportStack(error)

    return 1
  } finally {
    // Shutting down is still the application talking, so the redirect outlives it.
    await close(debug)
    restoreConsole()
  }
}
