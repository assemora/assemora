/**
 * `assemora new` (SPEC.md §78).
 *
 * The command owns one thing — the translation from argv to the options
 * `create-assemora` takes — so that is what most of this file asserts, directly
 * against `scaffoldOptions`. Nothing here writes a project: what a scaffolded
 * project contains is the scaffolder's own question, and answering it twice is how
 * the two would come to disagree.
 */
import { describe, expect, it } from 'vitest'

import { parseArgs } from '../args.js'
import { type CapturedOutput, captureOutput } from '../output.js'
import { commandNamed } from '../registry.js'
import { scaffoldOptions } from './new.js'

const optionsFor = (argv: readonly string[], cwd = '/work') => {
  const args = parseArgs(['new', ...argv])
  const name = args.positionals[0]

  expect(name).toBeDefined()

  return scaffoldOptions(name ?? '', args, cwd)
}

const invoke = async (argv: readonly string[]): Promise<number> => {
  const command = commandNamed('new')

  expect(command).toBeDefined()

  return command === undefined ? -1 : command.handler({ args: parseArgs(argv), cwd: '/work' })
}

describe('what the invocation becomes', () => {
  it('puts the project beside where the command was typed, in a directory of its name', () => {
    expect(optionsFor(['demo']).directory).toBe('/work/demo')
  })

  it('takes --directory over the name when both are given', () => {
    expect(optionsFor(['demo', '--directory', 'apps/demo']).directory).toBe('/work/apps/demo')
  })

  it('leaves an absolute --directory alone', () => {
    expect(optionsFor(['demo', '--directory', '/srv/demo']).directory).toBe('/srv/demo')
  })

  it('includes Studio, Pages and MCP, which is what SPEC.md §78 defaults them to', () => {
    expect(optionsFor(['demo'])).toMatchObject({ studio: true, pages: true, mcp: true })
  })

  it('turns one off for --no-studio, and leaves the other two alone', () => {
    expect(optionsFor(['demo', '--no-studio'])).toMatchObject({
      studio: false,
      pages: true,
      mcp: true,
    })
  })

  it('understands the spelling a script writes as well as the one a person types', () => {
    expect(optionsFor(['demo', '--mcp=false']).mcp).toBe(false)
    expect(optionsFor(['demo', '--no-mcp=false']).mcp).toBe(true)
  })

  it('passes the database URL and the template through untouched', () => {
    expect(
      optionsFor(['demo', '--database', 'postgres://x/y', '--template', 'blog']),
    ).toMatchObject({ database: 'postgres://x/y', template: 'blog' })
  })

  it('omits a database and a template that were never given, rather than sending undefined', () => {
    const options = optionsFor(['demo'])

    expect('database' in options).toBe(false)
    expect('template' in options).toBe(false)
  })
})

describe('the invocation itself', () => {
  let output: CapturedOutput

  it('answers 2 without a name, and shows a complete invocation', async () => {
    output = captureOutput()

    try {
      expect(await invoke(['new'])).toBe(2)
      expect(output.stderr).toContain('assemora new my-project')
    } finally {
      output.restore()
    }
  })

  // TODO(phase-10): replace this with a case that scaffolds into a temporary
  // directory once `create-assemora` exists and the import in `new.ts` is live.
  it('says plainly that create-assemora has not landed yet, and what to run meanwhile', async () => {
    await expect(invoke(['new', 'demo'])).rejects.toThrow(/pnpm create assemora demo/)
  })
})
