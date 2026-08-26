/**
 * `assemora new <name>` — the convenience, not a second scaffolder (SPEC.md §78).
 *
 * `pnpm create assemora my-project` is the primary way a project starts, and this
 * command runs the same `scaffold()` it does. Nothing about the layout of a
 * generated project is decided here: a second implementation would drift from the
 * starter the moment either changed, and the starter is the one CI typechecks
 * (ADR-0021).
 *
 * What this file owns is the translation from argv to that function's options, and
 * the defaults SPEC.md §78 fixes — Studio, Pages and MCP are all in unless the
 * invocation says otherwise.
 */
import { relative, resolve } from 'node:path'

import { scaffold } from 'create-assemora'

import { bool, flag, type ParsedArgs } from '../args.js'
import { fail, line, ok } from '../output.js'
import { type CommandHandler, defineCommand, register } from '../registry.js'

/** Exactly what `scaffold()` in `create-assemora` accepts. */
export type ScaffoldOptions = {
  readonly name: string
  readonly directory: string
  readonly database?: string
  readonly studio?: boolean
  readonly pages?: boolean
  readonly mcp?: boolean
  readonly template?: string
}

type Scaffolded = {
  readonly directory: string
  readonly files: readonly string[]
}

/**
 * Whether an optional part of the starter is included.
 *
 * SPEC.md §78 makes all three default to yes, so the question here is only whether
 * the invocation turned one off. Both spellings are accepted because both get typed:
 * `--no-studio` is what a person writes, and `--studio=false` is what a script does.
 */
const included = (args: ParsedArgs, name: string): boolean => {
  if (args.flags[`no-${name}`] !== undefined) return !bool(args, `no-${name}`)
  if (args.flags[name] !== undefined) return bool(args, name)

  return true
}

/**
 * argv, as the scaffolder's options.
 *
 * The name is not validated beyond being present. What makes a legal project name is
 * `create-assemora`'s question — it is the thing that writes the directory and the
 * `package.json` — and answering it twice is how the two would come to disagree.
 */
export const scaffoldOptions = (name: string, args: ParsedArgs, cwd: string): ScaffoldOptions => {
  const directory = flag(args, 'directory')
  const database = flag(args, 'database')
  const template = flag(args, 'template')

  return {
    name,
    directory: resolve(cwd, directory ?? name),
    ...(database === undefined ? {} : { database }),
    ...(template === undefined ? {} : { template }),
    studio: included(args, 'studio'),
    pages: included(args, 'pages'),
    mcp: included(args, 'mcp'),
  }
}

const runScaffold = async (options: ScaffoldOptions): Promise<Scaffolded> => scaffold(options)

/** An absolute path is a poor thing to type; a relative one is what `cd` wants. */
const shortest = (from: string, directory: string): string => {
  const step = relative(from, directory)

  return step === '' || step.startsWith('..') ? directory : step
}

const create: CommandHandler = async ({ args, cwd }) => {
  const name = args.positionals[0]

  if (name === undefined || name.trim() === '') {
    fail('`assemora new` needs a name for the project: `assemora new my-project`.')

    return 2
  }

  const options = scaffoldOptions(name, args, cwd)
  const created = await runScaffold(options)

  ok(`Created ${options.name}: ${created.files.length} files in ${created.directory}`)
  line()
  line('Next')
  line(`  cd ${shortest(cwd, created.directory)}`)
  line('  pnpm install')
  line('  assemora dev')

  return 0
}

register(
  defineCommand({
    name: 'new',
    group: 'project',
    summary: 'scaffold a new project',
    usage:
      'assemora new <name> [--directory <path>] [--database <url>] [--template <name>] [--no-studio] [--no-pages] [--no-mcp]',
    handler: create,
  }),
)
