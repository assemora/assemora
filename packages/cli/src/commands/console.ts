/**
 * `assemora console` — a REPL holding the project's application (SPEC.md §77).
 *
 * The console is not a back door. What it puts in scope is the Command Bus, the
 * Query Bus and the Schema Registry — the same three doors Studio, REST and MCP go
 * through — so a mutation typed here passes validation, authorization, revisions and
 * audit exactly as one typed anywhere else does (ADR-0021). There is no database
 * handle in scope, and this package could not obtain one.
 *
 * The one thing a console must get right is leaving. `.exit` closes the application
 * so the pool it opened goes with it, and the command does not answer until the REPL
 * has closed and released the input it was reading — a REPL that prints its goodbye
 * and then holds the terminal is the failure this file is written against.
 */
import { start } from 'node:repl'

import type { Application } from '@assemora/core'

import { loadConfig } from '../config.js'
import { line } from '../output.js'
import { loadApplication } from '../project.js'
import { type CommandHandler, defineCommand, register } from '../registry.js'

/**
 * What the console needs of an application, which is less than all of it.
 *
 * Naming the four members here is what lets a test hand over something small, and it
 * says plainly that the console reaches for nothing else.
 */
export type ConsoleApplication = Pick<
  Application,
  'commands' | 'queries' | 'registry' | 'run' | 'shutdown'
>

export type ConsoleSession = {
  /** Defaults to `process.stdin`. */
  readonly input?: NodeJS.ReadableStream
  /** Defaults to `process.stdout`. */
  readonly output?: NodeJS.WritableStream
  /** Defaults to whether stdin is a terminal. */
  readonly terminal?: boolean
}

/**
 * Opens the REPL and resolves once it has closed and the application has stopped.
 *
 * The application is a parameter rather than something this function loads, so the
 * whole of the console's behaviour — what is in scope, what `.exit` does, whether it
 * returns at all — is drivable from a test with two streams.
 */
export const openConsole = async (
  app: ConsoleApplication,
  session: ConsoleSession = {},
): Promise<void> => {
  const input = session.input ?? process.stdin
  const output = session.output ?? process.stdout
  const terminal = session.terminal ?? process.stdin.isTTY === true

  /**
   * Runs an operation as a user, inside a context the application can see.
   *
   * A read typed here is authorized exactly as a read from Studio is, so
   * `queries.execute('auth.agents.list', {})` answers nothing until it is told who
   * is asking. `as` is how the console says who that is (SPEC.md §12).
   */
  const as = <T>(actorId: string, operation: () => T | Promise<T>): Promise<T> =>
    app.run({ source: 'cli', actor: { type: 'user', id: actorId } }, async () => operation())

  const repl = start({
    input,
    output,
    terminal,
    useColors: terminal,
    prompt: 'assemora > ',
    // A context of its own rather than the CLI's globals: `commands` and `queries`
    // are the names an operator reaches for first, and neither should be able to
    // collide with something this process happens to have defined.
    useGlobal: false,
    ignoreUndefined: true,
  })

  const scope = {
    app,
    commands: app.commands,
    queries: app.queries,
    registry: app.registry,
    as,
  }

  // Defined rather than assigned, so `app = null` typed by accident is an error
  // instead of the rest of the session being useless. `.clear` builds a fresh
  // context, which is why they are put back on every reset.
  const define = (): void => {
    for (const [name, value] of Object.entries(scope)) {
      Object.defineProperty(repl.context, name, { value, enumerable: true, configurable: true })
    }
  }

  define()
  repl.on('reset', define)

  line('Assemora console. The application is booted; everything below is in scope.')
  line()
  line('  app        the application itself')
  line("  commands   await commands.execute('entries.create', { resource: 'posts', data: {} })")
  line("  queries    await queries.execute('pages.list', {})")
  line('  registry   registry.describe()')
  line("  as         await as('user-id', () => queries.execute('auth.agents.list', {}))")
  line()
  line('.exit closes the application and leaves.')

  await new Promise<void>((resolve) => {
    repl.once('exit', () => {
      resolve()
    })
  })

  // The REPL stops reading when it closes, but an input it was handed rather than
  // one it created can still hold the event loop open, and stdin always does.
  input.pause()

  await app.shutdown()
}

const consoleCommand: CommandHandler = async ({ cwd }) => {
  const loaded = await loadConfig(cwd)

  await openConsole(await loadApplication(loaded))

  return 0
}

register(
  defineCommand({
    name: 'console',
    group: 'console',
    summary: 'open a REPL holding the booted application',
    usage: 'assemora console',
    handler: consoleCommand,
  }),
)
