/**
 * `assemora new` (SPEC.md §78).
 *
 * The command owns one thing — the translation from argv to the options
 * `create-assemora` takes — so that is what most of this file asserts, directly
 * against `scaffoldOptions`. Nothing here writes a project: what a scaffolded
 * project contains is the scaffolder's own question, and answering it twice is how
 * the two would come to disagree.
 */
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
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

  it('scaffolds a real project, through the same function `pnpm create` calls', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'assemora-new-'))
    const template = join(directory, 'template')

    // The smallest thing `create-assemora` accepts as a starter: it insists on a
    // package.json, so that a directory of nothing cannot be reported as a project.
    await mkdir(template, { recursive: true })
    await writeFile(
      join(template, 'package.json'),
      JSON.stringify({ name: 'starter', private: true, dependencies: {} }),
    )
    await writeFile(join(template, 'README.md'), '# starter\n')

    const output = captureOutput()

    try {
      const code = await commandNamed('new')?.handler({
        args: parseArgs(['new', 'demo', '--template', template, '--yes']),
        cwd: directory,
      })

      expect(code).toBe(0)
      expect(await readFile(join(directory, 'demo', 'README.md'), 'utf8')).toContain('starter')
      expect(output.stdout).toContain('demo')
    } finally {
      output.restore()
      await rm(directory, { recursive: true, force: true })
    }
  })
})
