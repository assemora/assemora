/**
 * `run()` — one invocation, from argv to exit code (SPEC.md §77).
 *
 * `run` returns the code instead of taking the process down with it, which is the
 * reason this file can exist at all: every case below is the real CLI, driven in
 * process, with only the write target replaced.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import type { ParsedArgs } from './args.js'
import { run } from './index.js'
import { type CapturedOutput, captureOutput } from './output.js'
import { type CliCommand, defineCommand } from './registry.js'

let output: CapturedOutput
let seen: { args: ParsedArgs; cwd: string } | undefined

const commands: readonly CliCommand[] = [
  defineCommand({
    name: 'routes',
    group: 'inspect',
    summary: 'list the registered routes',
    usage: 'assemora routes [--json]',
    handler: async (input) => {
      seen = input
      return 0
    },
  }),
  defineCommand({
    name: 'db:migrate',
    group: 'database',
    summary: 'apply pending migrations',
    usage: 'assemora db:migrate [--force]',
    handler: async () => 7,
  }),
  defineCommand({
    name: 'boom',
    group: 'run',
    summary: 'fails on purpose',
    usage: 'assemora boom',
    handler: async () => {
      throw new Error('the database refused the connection')
    },
  }),
]

beforeEach(() => {
  seen = undefined
  output = captureOutput()
})

afterEach(() => {
  output.restore()
})

describe('what happens with no command', () => {
  it('prints the grouped list, because asking for nothing is a question', async () => {
    const code = await run([], { commands })

    expect(code).toBe(0)
    expect(output.stdout).toContain('assemora <command> [options]')
    expect(output.stdout).toContain('Inspect')
    expect(output.stdout).toContain('routes')
  })

  it('prints the same list for --help and for -h', async () => {
    await run(['--help'], { commands })
    const long = output.stdout

    output.restore()
    output = captureOutput()
    await run(['-h'], { commands })

    expect(output.stdout).toBe(long)
  })

  it('prints the version for --version, and nothing else', async () => {
    const code = await run(['--version'], { commands, version: '1.2.3' })

    expect(code).toBe(0)
    expect(output.stdout).toBe('1.2.3\n')
  })

  it('reports its own version when the caller does not supply one', async () => {
    await run(['--version'], { commands })

    expect(output.stdout.trim()).toMatch(/^\d+\.\d+\.\d+/)
  })
})

describe('resolving a command', () => {
  it('hands it the parsed arguments and the directory to work in', async () => {
    const code = await run(['routes', 'extra', '--json'], { commands, cwd: '/somewhere' })

    expect(code).toBe(0)
    expect(seen?.cwd).toBe('/somewhere')
    expect(seen?.args.positionals).toEqual(['extra'])
    expect(seen?.args.flags).toEqual({ json: true })
  })

  it('returns whatever the handler returned', async () => {
    expect(await run(['db:migrate'], { commands })).toBe(7)
  })

  it('answers 2 for a command nobody registered, and says so on stderr', async () => {
    const code = await run(['migrat'], { commands })

    expect(code).toBe(2)
    expect(output.stdout).toBe('')
    expect(output.stderr).toContain('Unknown command "migrat"')
    expect(output.stderr).toContain('assemora --help')
  })

  it("prints one command's own usage rather than running it", async () => {
    const code = await run(['db:migrate', '--help'], { commands })

    expect(code).toBe(0)
    expect(output.stdout).toContain('assemora db:migrate [--force]')
    expect(output.stdout).toContain('apply pending migrations')
  })
})

describe('when a command throws', () => {
  it('turns it into one sentence on stderr and exit code 1', async () => {
    const code = await run(['boom'], { commands })

    expect(code).toBe(1)
    expect(output.stderr).toBe('error: the database refused the connection\n')
  })

  it('keeps the stack for --debug and hides it otherwise', async () => {
    await run(['boom', '--debug'], { commands })

    expect(output.stderr).toContain('error: the database refused the connection')
    expect(output.stderr).toContain('index.test.ts')
  })

  it('says something readable about a thrown value that is not an error', async () => {
    const thrower = defineCommand({
      name: 'odd',
      group: 'run',
      summary: 'throws a string',
      usage: 'assemora odd',
      handler: async () => {
        throw 'not an error'
      },
    })

    expect(await run(['odd'], { commands: [thrower] })).toBe(1)
    expect(output.stderr).toBe('error: not an error\n')
  })

  it('never takes the process down itself', async () => {
    const original = process.exit
    let called = false

    process.exit = ((code?: number): never => {
      called = true
      throw new Error(`process.exit(${String(code)}) was called`)
    }) as typeof process.exit

    try {
      expect(await run(['boom'], { commands })).toBe(1)
      expect(await run(['nope'], { commands })).toBe(2)
    } finally {
      process.exit = original
    }

    expect(called).toBe(false)
  })
})
