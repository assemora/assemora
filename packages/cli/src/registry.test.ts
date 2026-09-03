/**
 * The command table and the help it prints (SPEC.md §77).
 *
 * The help is generated from the table rather than written beside it, so what is
 * under test is that a command registered anywhere appears in the right group, and
 * that a group nobody uses leaves no empty heading behind.
 */
import { describe, expect, it } from 'vitest'

import {
  type CliCommand,
  COMMAND_GROUPS,
  commandHelpText,
  commandNamed,
  defineCommand,
  helpText,
  register,
  registeredCommands,
} from './registry.js'

const stub = (name: string, group: CliCommand['group'], summary: string): CliCommand =>
  defineCommand({
    name,
    group,
    summary,
    usage: `assemora ${name}`,
    handler: async () => 0,
  })

const table: readonly CliCommand[] = [
  stub('new', 'project', 'scaffold a new project'),
  stub('dev', 'run', 'run the application with reloading'),
  stub('build', 'run', 'typecheck and regenerate everything a deploy needs'),
  stub('start', 'run', 'run the application'),
  stub('db:migrate', 'database', 'apply pending migrations'),
  stub('routes', 'inspect', 'list the registered routes'),
]

describe('the groups', () => {
  /**
   * The blocks SPEC.md §77 separates its listing into, in its order — plus `identity`.
   *
   * §77 says of itself that it "is not a closed list — a capability that needs a
   * command gets one, and does not get bent into an existing one to avoid a
   * twenty-third". Creating an agent identity is that case: it mints a credential, so
   * it does not belong under Inspect beside the listing of them, and it is not a
   * generator, a migration or an artifact. It sits after Run because that is where
   * somebody goes looking for it — the reason to want one is `assemora mcp`.
   */
  it('are the ones SPEC.md §77 separates, in its order', () => {
    expect(COMMAND_GROUPS).toEqual([
      'project',
      'run',
      'identity',
      'make',
      'database',
      'inspect',
      'artifacts',
      'console',
    ])
  })
})

describe('the help', () => {
  it('prints each command under its own group, in that order', () => {
    const printed = helpText(table)
    const at = (needle: string) => printed.indexOf(needle)

    expect(at('Project')).toBeGreaterThan(-1)
    expect(at('Project')).toBeLessThan(at('Run'))
    expect(at('Run')).toBeLessThan(at('Database'))
    expect(at('Database')).toBeLessThan(at('Inspect'))
  })

  it('keeps a group in the order it was registered, not in alphabetical order', () => {
    const printed = helpText(table)

    expect(printed.indexOf('dev')).toBeLessThan(printed.indexOf('build'))
    expect(printed.indexOf('build')).toBeLessThan(printed.indexOf('start'))
  })

  it('leaves no heading behind for a group nothing registered', () => {
    const printed = helpText(table)

    expect(printed).not.toContain('Generate')
    expect(printed).not.toContain('Artifacts')
  })

  it('lines the summaries up in a column', () => {
    const lines = helpText(table).split('\n')
    const dev = lines.find((entry) => entry.includes('dev')) ?? ''
    const migrate = lines.find((entry) => entry.includes('db:migrate')) ?? ''

    expect(dev.indexOf('run the application')).toBe(migrate.indexOf('apply pending'))
  })

  it('says how to ask about one command, and where flags go', () => {
    const printed = helpText(table)

    expect(printed).toContain('-h, --help')
    expect(printed).toContain('Flags follow the command')
  })

  it('is still a usable page when nothing is registered at all', () => {
    const printed = helpText([])

    expect(printed).toContain('assemora <command> [options]')
    expect(printed).toContain('--version')
  })
})

describe('one command on its own', () => {
  it('prints its usage and what it is for', () => {
    expect(commandHelpText(stub('make:model', 'make', 'write a model declaration'))).toBe(
      'Usage\n  assemora make:model\n\nwrite a model declaration',
    )
  })
})

describe('registering', () => {
  it('makes a command findable by the name that is typed', () => {
    register(stub('spec:example', 'inspect', 'an example'))

    expect(commandNamed('spec:example')?.summary).toBe('an example')
    expect(registeredCommands().map((command) => command.name)).toContain('spec:example')
  })

  it('refuses the same name twice, rather than letting the last import win', () => {
    register(stub('spec:once', 'inspect', 'first'))

    expect(() => register(stub('spec:once', 'inspect', 'second'))).toThrow(
      /"spec:once" is registered twice/,
    )
    expect(commandNamed('spec:once')?.summary).toBe('first')
  })

  it('knows nothing about a name nobody registered', () => {
    expect(commandNamed('spec:absent')).toBeUndefined()
  })
})
