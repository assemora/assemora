/**
 * The command table (SPEC.md §77).
 *
 * Every command is a small function of `{ args, cwd }` returning an exit code, and
 * that is the whole of what `run()` knows about it. The groups register themselves
 * into the table below, so adding `assemora db:seed` is one `defineCommand` in the
 * group that owns it and nothing anywhere else — including in the help, which is
 * printed from the table rather than written out beside it.
 */
import { ConfigurationError } from '@assemora/core'

import type { ParsedArgs } from './args.js'

/**
 * `0` succeeded, `1` the command failed, `2` the invocation was wrong.
 *
 * The distinction matters to a script: `2` says the arguments were nonsense and
 * retrying will not help, while `1` says the work was attempted and did not finish.
 */
export type CommandHandler = (input: {
  readonly args: ParsedArgs
  readonly cwd: string
}) => Promise<number>

/** The groups of SPEC.md §77, in the order it lists them. */
export type CommandGroup =
  | 'project'
  | 'run'
  | 'make'
  | 'database'
  | 'inspect'
  | 'artifacts'
  | 'console'

export type CliCommand = {
  /** What is typed: `make:model`, `db:migrate`, `api:openapi`. */
  readonly name: string
  readonly group: CommandGroup
  /** One line, lower case, no full stop — it is printed in a column. */
  readonly summary: string
  /** The whole invocation, starting with `assemora`. */
  readonly usage: string
  readonly handler: CommandHandler
}

/** Identity plus types, like `defineConfig` — the check happens where it is written. */
export const defineCommand = (command: CliCommand): CliCommand => command

const GROUPS: readonly { readonly group: CommandGroup; readonly title: string }[] = [
  { group: 'project', title: 'Project' },
  { group: 'run', title: 'Run' },
  { group: 'make', title: 'Generate' },
  { group: 'database', title: 'Database' },
  { group: 'inspect', title: 'Inspect' },
  { group: 'artifacts', title: 'Artifacts' },
  { group: 'console', title: 'Console' },
]

export const COMMAND_GROUPS: readonly CommandGroup[] = GROUPS.map((entry) => entry.group)

const table = new Map<string, CliCommand>()

/**
 * Adds commands to the table.
 *
 * Order inside a group is the order they are registered in, which is the order
 * SPEC.md §77 lists them — `dev, build, start`, not `build, dev, start`. Registering
 * a name twice is a mistake in the CLI itself, so it throws where it happens rather
 * than letting whichever module loaded last decide what `db:migrate` means.
 */
export const register = (...commands: readonly CliCommand[]): void => {
  for (const command of commands) {
    if (table.has(command.name)) {
      throw new ConfigurationError(`CLI command "${command.name}" is registered twice`)
    }

    table.set(command.name, command)
  }
}

export const registeredCommands = (): readonly CliCommand[] => [...table.values()]

export const commandNamed = (name: string): CliCommand | undefined => table.get(name)

const pad = (text: string, width: number): string => text.padEnd(width)

/**
 * What `assemora` and `assemora --help` print.
 *
 * The list is grouped exactly as SPEC.md §77 groups it, because those groups are the
 * four unrelated jobs the CLI does and reading it as one alphabetical run of
 * twenty-two names tells nobody which is which.
 */
export const helpText = (commands: readonly CliCommand[] = registeredCommands()): string => {
  const names = commands.map((command) => command.name.length)
  const width = Math.max(...names, '-h, --help'.length) + 2

  const lines = [
    'assemora — the command line for an Assemora project',
    '',
    'Usage',
    '  assemora <command> [options]',
  ]

  for (const { group, title } of GROUPS) {
    const members = commands.filter((command) => command.group === group)
    if (members.length === 0) continue

    lines.push('', title)

    for (const command of members) {
      lines.push(`  ${pad(command.name, width)}${command.summary}`)
    }
  }

  lines.push(
    '',
    'Options',
    `  ${pad('-h, --help', width)}this help, or one command's usage`,
    `  ${pad('--version', width)}the CLI version`,
    `  ${pad('--debug', width)}print stack traces when something fails`,
    '',
    'Flags follow the command: `assemora make:model Post --force`.',
  )

  return lines.join('\n')
}

/** What `assemora <command> --help` prints. */
export const commandHelpText = (command: CliCommand): string =>
  ['Usage', `  ${command.usage}`, '', command.summary].join('\n')
