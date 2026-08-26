/**
 * `pnpm create assemora my-project` — the command around `scaffold()`.
 *
 * `run()` answers with an exit code instead of taking the process down, so the whole
 * command is drivable from a test with two streams; `bin.ts` is what exits. The exit
 * codes are the ones `@assemora/cli` uses, because the two commands land in the same
 * scripts: `0` succeeded, `1` the work failed, `2` the invocation was wrong.
 */
import { resolve } from 'node:path'

import { ScaffoldError } from './error.js'
import { isUnreleased, packageVersion } from './package-json.js'
import { ask } from './prompts.js'
import { scaffold, shortestPath } from './scaffold.js'
import { DEFAULT_TEMPLATE } from './template.js'

/**
 * Flags that take the following token as their value.
 *
 * `@assemora/cli` parses argv without a table like this, because its command table is
 * assembled by seven modules that know nothing about each other's flags. Here there
 * is one command and eight flags, so naming the three that take a value removes the
 * guesswork entirely: `--database --force` cannot be read as a URL called `--force`.
 */
const VALUED = new Set(['database', 'template', 'directory'])

/** Everything the command accepts, so that a misspelt flag is refused rather than ignored. */
const KNOWN = new Set([
  ...VALUED,
  'studio',
  'pages',
  'mcp',
  'no-studio',
  'no-pages',
  'no-mcp',
  'force',
  'yes',
  'y',
  'help',
  'h',
  'version',
  'debug',
])

export type ParsedArgs = {
  readonly positionals: readonly string[]
  readonly flags: Readonly<Record<string, string | boolean>>
}

export const parseArgs = (argv: readonly string[]): ParsedArgs => {
  const positionals: string[] = []
  const flags: Record<string, string | boolean> = {}
  let index = 0

  while (index < argv.length) {
    const token = argv[index]
    index += 1

    if (token === undefined) continue

    if (!token.startsWith('-') || token === '-' || token === '--') {
      positionals.push(token)
      continue
    }

    const body = token.slice(token.startsWith('--') ? 2 : 1)
    const separator = body.indexOf('=')

    if (separator >= 0) {
      flags[body.slice(0, separator)] = body.slice(separator + 1)
      continue
    }

    const next = argv[index]

    if (VALUED.has(body) && next !== undefined && !next.startsWith('-')) {
      flags[body] = next
      index += 1
      continue
    }

    flags[body] = true
  }

  return { positionals, flags }
}

/** What a scripted `--force=$SOMETHING` means when `$SOMETHING` is empty or a denial. */
const DENIALS = new Set(['', 'false', '0', 'no', 'off'])

const bool = (args: ParsedArgs, name: string): boolean => {
  const value = args.flags[name]

  if (value === undefined) return false
  if (typeof value === 'boolean') return value

  return !DENIALS.has(value.toLowerCase())
}

const value = (args: ParsedArgs, name: string): string | undefined => {
  const given = args.flags[name]

  return typeof given === 'string' && given.trim() !== '' ? given.trim() : undefined
}

/**
 * Whether an optional part of the starter was settled by a flag.
 *
 * Both spellings are accepted because both get typed: `--no-studio` is what a person
 * writes, and `--studio=false` is what a script does.
 */
export const answered = (args: ParsedArgs, name: string): boolean | undefined => {
  if (args.flags[`no-${name}`] !== undefined) return !bool(args, `no-${name}`)
  if (args.flags[name] !== undefined) return bool(args, name)

  return undefined
}

export const HELP = [
  'create-assemora — start an Assemora project',
  '',
  'Usage',
  '  pnpm create assemora <name> [options]',
  '',
  'Options',
  '  --database <url>    the DATABASE_URL to write into .env',
  `  --template <name>   which starter to copy (default: ${DEFAULT_TEMPLATE})`,
  '  --directory <path>  where to write it (default: ./<name>)',
  '  --no-studio         leave Studio out',
  '  --no-pages          leave the page builder out',
  '  --no-mcp            leave the MCP server out',
  '  --force             write into a directory that is not empty',
  '  -y, --yes           take every default and ask nothing',
  '  -h, --help          this',
  '      --version       the version of create-assemora',
  '',
  'Nothing is installed. The three commands to run next are printed when it is done.',
].join('\n')

export type CliSession = {
  readonly cwd: string
  readonly input: NodeJS.ReadableStream
  readonly output: NodeJS.WritableStream
  readonly error: NodeJS.WritableStream
  /** Whether there is somebody at the other end of stdin. */
  readonly interactive: boolean
}

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

/** The stack and every cause below it — what `--debug` is for. */
const stackOf = (error: unknown): string => {
  const lines: string[] = []
  let current: unknown = error

  while (current instanceof Error) {
    lines.push(current.stack ?? `${current.name}: ${current.message}`)
    current = current.cause
  }

  return lines.join('\n')
}

const count = (amount: number, noun: string): string =>
  `${amount} ${noun}${amount === 1 ? '' : 's'}`

/**
 * The three commands the developer runs next, in order.
 *
 * `pnpm dev` rather than `assemora dev`: the executable arrives with the install on
 * the line above it, and telling somebody to run a binary that is not there yet is
 * how a first run fails before it starts.
 */
const nextSteps = (cwd: string, directory: string): readonly string[] => [
  '',
  'Next',
  `  cd ${shortestPath(cwd, directory)}`,
  '  pnpm install',
  '  pnpm dev',
]

export const run = async (argv: readonly string[], session: CliSession): Promise<number> => {
  const args = parseArgs(argv)
  const say = (text: string): void => {
    session.output.write(`${text}\n`)
  }

  const unknown = Object.keys(args.flags).filter((name) => !KNOWN.has(name))

  if (unknown.length > 0) {
    // Silently ignoring `--no-studios` would ship a project with Studio in it and
    // nothing to say why, which is the one failure this command cannot afford.
    session.error.write(`Unknown option "--${unknown[0] ?? ''}". Run with --help.\n`)

    return 2
  }

  if (bool(args, 'help') || bool(args, 'h')) {
    say(HELP)

    return 0
  }

  const version = await packageVersion()

  if (bool(args, 'version')) {
    say(version)

    return 0
  }

  try {
    const answers = await ask(
      {
        name: args.positionals[0],
        database: value(args, 'database'),
        studio: answered(args, 'studio'),
        pages: answered(args, 'pages'),
        mcp: answered(args, 'mcp'),
      },
      {
        input: session.input,
        output: session.output,
        interactive: session.interactive && !bool(args, 'yes') && !bool(args, 'y'),
      },
    )

    if (answers.name.trim() === '') {
      // Nothing was typed and nothing could be: a pipeline that forgot the argument
      // wants the exit code that says retrying will not help.
      session.error.write('A project needs a name: `pnpm create assemora my-project`.\n')

      return 2
    }

    const template = value(args, 'template')
    const created = await scaffold({
      name: answers.name,
      directory: resolve(session.cwd, value(args, 'directory') ?? answers.name.trim()),
      // Spread rather than assigned: `exactOptionalPropertyTypes` draws a line
      // between "no answer" and "the answer is undefined", and so does this command.
      ...(answers.database === undefined ? {} : { database: answers.database }),
      studio: answers.studio,
      pages: answers.pages,
      mcp: answers.mcp,
      ...(template === undefined ? {} : { template }),
      force: bool(args, 'force'),
    })

    say(`Created ${answers.name.trim()} — ${count(created.files.length, 'file')}.`)
    for (const step of nextSteps(session.cwd, created.directory)) say(step)

    if (isUnreleased(version)) {
      // One line, and it goes the day there is a release to install. Saying nothing
      // would leave somebody reading a resolver error for a package that has never
      // existed and assuming they mistyped something.
      say('')
      say(
        'The @assemora packages are not published yet, so `pnpm install` has nothing to fetch ' +
          'for them. Until the first release, run the project from a checkout of the framework.',
      )
    }

    return 0
  } catch (error) {
    session.error.write(`${messageOf(error)}\n`)

    if (bool(args, 'debug')) session.error.write(`${stackOf(error)}\n`)
    // Anything that is not a refusal is a bug in this package rather than a mistake
    // in the invocation, and the difference is worth keeping visible.
    else if (!(error instanceof ScaffoldError)) {
      session.error.write('Run again with --debug for the stack.\n')
    }

    return 1
  }
}
