import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { Readable } from 'node:stream'

import { afterEach, describe, expect, it } from 'vitest'

import { answered, type CliSession, nextSteps, parseArgs, run } from './cli.js'
import { collector, conversation } from './streams.fixture.js'
import { remove, temporaryDirectory, write, writeTemplate } from './template.fixture.js'

const directories: string[] = []

const temporary = async (): Promise<string> => {
  const directory = await temporaryDirectory()
  directories.push(directory)

  return directory
}

afterEach(async () => {
  await Promise.all(directories.splice(0).map(remove))
})

type Driven = {
  readonly code: number
  readonly out: string
  readonly err: string
}

/** Drives the whole command in-process, which is why `run()` returns a code. */
const drive = async (
  argv: readonly string[],
  session: Partial<CliSession> = {},
): Promise<Driven> => {
  const out = collector()
  const err = collector()
  const code = await run(argv, {
    cwd: session.cwd ?? process.cwd(),
    input: session.input ?? Readable.from([]),
    output: out.stream,
    error: err.stream,
    interactive: session.interactive ?? false,
  })

  return { code, out: out.text(), err: err.text() }
}

/** The same, with somebody at the other end typing the answers. */
const driveTerminal = async (
  argv: readonly string[],
  cwd: string,
  typed: readonly string[],
): Promise<Driven> => {
  const terminal = conversation(typed)
  const err = collector()
  const code = await run(argv, {
    cwd,
    input: terminal.input,
    output: terminal.output,
    error: err.stream,
    interactive: true,
  })

  return { code, out: terminal.text(), err: err.text() }
}

describe('parseArgs', () => {
  it('reads a value flag in both spellings', () => {
    expect(parseArgs(['--database', 'postgres://x']).flags.database).toBe('postgres://x')
    expect(parseArgs(['--database=postgres://x']).flags.database).toBe('postgres://x')
  })

  it('does not read the next flag as a value', () => {
    const args = parseArgs(['--database', '--force'])

    expect(args.flags.database).toBe(true)
    expect(args.flags.force).toBe(true)
  })

  it('leaves a flag that takes no value alone', () => {
    const args = parseArgs(['my-project', '--force', 'extra'])

    expect(args.positionals).toStrictEqual(['my-project', 'extra'])
    expect(args.flags.force).toBe(true)
  })

  it('reads -y', () => {
    expect(parseArgs(['-y']).flags.y).toBe(true)
  })
})

describe('answered', () => {
  it('is undefined when nothing said', () => {
    expect(answered(parseArgs([]), 'studio')).toBeUndefined()
  })

  it('reads both the spelling a person types and the one a script writes', () => {
    expect(answered(parseArgs(['--no-studio']), 'studio')).toBe(false)
    expect(answered(parseArgs(['--studio=false']), 'studio')).toBe(false)
    expect(answered(parseArgs(['--studio']), 'studio')).toBe(true)
  })
})

describe('run', () => {
  it('prints the usage', async () => {
    const { code, out } = await drive(['--help'])

    expect(code).toBe(0)
    expect(out).toContain('pnpm create assemora <name>')
  })

  /*
   * Which starter to copy is not one of SPEC.md §78's five questions, so `--help` is
   * where somebody who wants the worked example rather than the empty default finds
   * out that it exists. The list is read from `starters/` in this checkout, which is
   * the same list a published install carries under `templates/`.
   */
  it('lists the templates this install carries, by name', async () => {
    const { code, out } = await drive(['--help'])

    expect(code).toBe(0)
    expect(out).toContain('Templates')
    expect(out).toContain('bare')
    expect(out).toContain('blog')
  })

  it('names the other templates to somebody who never chose, and not to somebody who did', async () => {
    const root = await temporary()

    const chose = await drive(
      ['chosen', `--template=${await writeTemplate(root)}`, `--directory=${join(root, 'chosen')}`],
      { cwd: root },
    )

    expect(chose.out).not.toContain('Other templates')

    // No `--template`, so this copies the real default starter and is the invocation
    // the line exists for: an empty project, and one sentence saying what else there is.
    const took = await drive(['took', `--directory=${join(root, 'took')}`], { cwd: root })

    expect(took.code).toBe(0)
    expect(took.out).toContain('Other templates')
    expect(took.out).toContain('--template blog')
    expect(took.out).not.toContain('--template bare')
  })

  it('says the invocation was wrong when nobody named the project', async () => {
    const { code, err } = await drive([])

    expect(code).toBe(2)
    expect(err).toContain('needs a name')
  })

  it('refuses a flag it does not know, rather than ignoring it', async () => {
    const { code, err } = await drive(['my-project', '--no-studios'])

    expect(code).toBe(2)
    expect(err).toContain('--no-studios')
  })

  it('asks nothing when stdin is not a terminal, and says which defaults it took', async () => {
    const root = await temporary()
    const template = await writeTemplate(root)

    const { code, out } = await drive(['my-project', `--template=${template}`, '--no-mcp'], {
      cwd: root,
    })

    expect(code).toBe(0)
    expect(out).toContain('Studio yes, Pages yes, MCP no')
    expect(out).toContain('no DATABASE_URL')
  })

  it('finishes with the three commands to run next, in order, once there is a release', () => {
    const steps = [...nextSteps('/work', '/work/my-project', true)].map((entry) => entry.trim())

    expect(steps.indexOf('cd my-project')).toBeGreaterThan(steps.indexOf('Next'))
    expect(steps.indexOf('pnpm install')).toBe(steps.indexOf('cd my-project') + 1)
    expect(steps.indexOf('pnpm dev')).toBe(steps.indexOf('pnpm install') + 1)
  })

  /**
   * The one instruction, rather than an instruction and a retraction of it.
   *
   * The packages are on npm, so a generated project installs: the executable prints
   * `pnpm install` and nothing about a checkout. The other branch — the checkout route
   * printed while the tree was at `0.0.0` — is `nextSteps(…, false)`, kept for a fork
   * that has not released.
   */
  it('names the install route, now that the packages are published', async () => {
    const root = await temporary()
    const template = await writeTemplate(root)

    const { out } = await drive(['my-project', `--template=${template}`], { cwd: root })

    expect(out).toContain('  pnpm install\n')
    expect(out).not.toContain('not published yet')
    expect(out).not.toContain('git clone')
  })

  it('still names the checkout route for a tree that has not released', () => {
    const steps = nextSteps('/work', '/work/my-project', false).join('\n')

    expect(steps).toContain('git clone https://github.com/assemora/assemora.git')
    expect(steps).not.toContain('  pnpm install\n')
  })

  it('writes the project where the name says, relative to the working directory', async () => {
    const root = await temporary()
    const template = await writeTemplate(root)

    await drive(['my-project', `--template=${template}`], { cwd: root })

    const manifest = JSON.parse(
      await readFile(join(root, 'my-project', 'package.json'), 'utf8'),
    ) as { name: string }

    expect(manifest.name).toBe('my-project')
  })

  it('writes a .env when the database was given as a flag', async () => {
    const root = await temporary()
    const template = await writeTemplate(root)

    await drive(
      ['my-project', `--template=${template}`, '--database', 'postgres://localhost/demo'],
      { cwd: root },
    )

    expect(await readFile(join(root, 'my-project', '.env'), 'utf8')).toContain(
      'postgres://localhost/demo',
    )
  })

  it('answers the questions from a terminal', async () => {
    const root = await temporary()
    const template = await writeTemplate(root)

    const { code, out } = await driveTerminal(
      [`--template=${template}`, `--directory=${join(root, 'typed')}`],
      root,
      ['typed-project', 'postgres://localhost/typed', 'y', 'n', ''],
    )

    expect(code).toBe(0)
    expect(out).toContain('Project name')
    expect(out).toContain('Include MCP?')

    const manifest = JSON.parse(await readFile(join(root, 'typed', 'package.json'), 'utf8')) as {
      name: string
      dependencies: Record<string, string>
    }

    expect(manifest.name).toBe('typed-project')
    expect(manifest.dependencies['@assemora/studio']).toBeDefined()
    expect(manifest.dependencies['@assemora/pages']).toBeUndefined()
    expect(manifest.dependencies['@assemora/mcp']).toBeDefined()
  })

  it('takes every default with --yes, asking nothing even on a terminal', async () => {
    const root = await temporary()
    const template = await writeTemplate(root)

    const { code, out } = await drive(['my-project', `--template=${template}`, '--yes'], {
      cwd: root,
      interactive: true,
    })

    expect(code).toBe(0)
    expect(out).not.toContain('Project name')
  })

  it('fails with one sentence, not a stack', async () => {
    const root = await temporary()
    await write(root, 'taken/notes.md', 'mine\n')
    const template = await writeTemplate(root)

    const { code, err } = await drive(['taken', `--template=${template}`], { cwd: root })

    expect(code).toBe(1)
    expect(err).toContain('is not empty')
    // One sentence and nothing else: a stack belongs behind --debug.
    expect(err.trim().split('\n')).toHaveLength(1)
  })

  it('says nothing was scaffolded when the template does not exist', async () => {
    const root = await temporary()

    const { code, err } = await drive(['my-project', `--template=${join(root, 'nothing')}`], {
      cwd: root,
    })

    expect(code).toBe(1)
    expect(err).toContain('no template directory')
  })
})
