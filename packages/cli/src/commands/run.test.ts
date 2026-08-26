/**
 * `dev`, `start` and `build` (SPEC.md §77).
 *
 * Every case here runs against a throwaway project in a temporary directory whose
 * "server" is three lines of Node. What these commands are is a child process and
 * what happens to it, and a real Assemora server would answer those questions
 * identically while also wanting a database.
 *
 * The commands are reached through the table rather than through `run()`, so this
 * file loads nothing but the module it is testing. `run()` would pull in every other
 * group, and the stand-in `api:openapi` registered below would then collide with the
 * real one the moment that group lands.
 */
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { parseArgs } from '../args.js'
import { type CapturedOutput, captureOutput } from '../output.js'
import { commandNamed, defineCommand, register } from '../registry.js'
import './run.js'

/** Long enough for a spawned Node to start, which is most of what these cases cost. */
const PATIENCE = 20_000

const created: string[] = []
const artifacts: string[] = []
const exits = new Map<string, number>()

let output: CapturedOutput

/**
 * Stands in for the commands `build` delegates to.
 *
 * `build` finds them by name in the table, which is the seam being tested: it must
 * run the command that owns an artifact rather than generate one of its own.
 */
const artifact = (name: string) =>
  defineCommand({
    name,
    group: 'artifacts',
    summary: `stands in for ${name}`,
    usage: `assemora ${name}`,
    handler: async () => {
      artifacts.push(name)

      return exits.get(name) ?? 0
    },
  })

register(artifact('api:openapi'), artifact('sdk:generate'))

const project = async (files: Readonly<Record<string, string>>): Promise<string> => {
  const root = await mkdtemp(join(tmpdir(), 'assemora-cli-run-'))
  created.push(root)

  for (const [name, contents] of Object.entries(files)) {
    const path = join(root, name)
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, contents)
  }

  return root
}

/** `app` is never called by any of these commands, and a config without one is invalid. */
const config = (fields: string): string =>
  `export default { app: () => { throw new Error('no application is needed here') }, ${fields} }\n`

/** Written beside the script rather than into the working directory, which is the CLI's choice. */
const beside = (file: string, value: string): string =>
  `writeFileSync(new URL('./${file}', import.meta.url), ${value})`

const server = (...body: readonly string[]): string =>
  ["import { writeFileSync } from 'node:fs'", ...body, ''].join('\n')

/**
 * A `typescript` the project owns, whose compiler records how it was called.
 *
 * `build` resolves `typescript/package.json` from the project root, so a directory
 * with these two files in it is a complete TypeScript as far as the command is
 * concerned — and one that can be told to fail.
 */
const typescript = (exitCode: number): Readonly<Record<string, string>> => ({
  'node_modules/typescript/package.json': '{ "name": "typescript", "version": "5.0.0" }',
  'node_modules/typescript/bin/tsc': [
    "const { writeFileSync } = require('node:fs')",
    "const { join } = require('node:path')",
    "writeFileSync(join(__dirname, 'argv.json'), JSON.stringify(process.argv.slice(2)))",
    `process.exit(${exitCode})`,
    '',
  ].join('\n'),
  'tsconfig.json': '{ "compilerOptions": { "strict": true } }',
})

const invoke = async (argv: readonly string[], cwd: string): Promise<number> => {
  const args = parseArgs(argv)
  const command = commandNamed(args.command ?? '')

  if (command === undefined) throw new Error(`"${String(args.command)}" is not registered`)

  return command.handler({ args, cwd })
}

const waitFor = async (path: string): Promise<string> => {
  for (let attempt = 0; attempt < 400; attempt += 1) {
    const contents = await readFile(path, 'utf8').catch(() => undefined)
    if (contents !== undefined && contents !== '') return contents

    await new Promise((resolve) => {
      setTimeout(resolve, 25)
    })
  }

  throw new Error(`${path} was never written`)
}

/**
 * Calls the signal handler the CLI installed, and only that one.
 *
 * `process.emit('SIGTERM')` would reach the test runner's handlers too, and what is
 * under test is the CLI's own: it has to stop the child rather than let this process
 * die, which is the whole reason it takes the signal over from Node.
 */
const raise = (signal: NodeJS.Signals): void => {
  const installed = process.listeners(signal).at(-1)

  expect(installed).toBeDefined()
  installed?.(signal)
}

beforeEach(() => {
  artifacts.length = 0
  exits.clear()
  output = captureOutput()
})

afterEach(async () => {
  output.restore()
  for (const root of created.splice(0)) await rm(root, { recursive: true, force: true })
})

describe('start', () => {
  it(
    'answers with the exit code the server left',
    async () => {
      const root = await project({
        'assemora.config.ts': config("server: 'server.mjs'"),
        'server.mjs': 'process.exit(3)\n',
      })

      expect(await invoke(['start'], root)).toBe(3)
    },
    PATIENCE,
  )

  it(
    'runs the server as its own child, with nothing in between',
    async () => {
      const root = await project({
        'assemora.config.ts': config("server: 'server.mjs'"),
        'server.mjs': server(beside('ppid.txt', 'String(process.ppid)')),
      })

      expect(await invoke(['start'], root)).toBe(0)
      expect(await readFile(join(root, 'ppid.txt'), 'utf8')).toBe(String(process.pid))
    },
    PATIENCE,
  )

  it(
    'gives node everything written after --',
    async () => {
      const root = await project({
        'assemora.config.ts': config("server: 'server.mjs'"),
        'server.mjs': server(beside('argv.json', 'JSON.stringify(process.execArgv)')),
      })

      expect(await invoke(['start', '--', '--no-warnings'], root)).toBe(0)
      expect(await readFile(join(root, 'argv.json'), 'utf8')).toContain('--no-warnings')
    },
    PATIENCE,
  )

  it('refuses a config that names no server, and says what to add', async () => {
    const root = await project({ 'assemora.config.ts': config("paths: { source: 'src' }") })

    await expect(invoke(['start'], root)).rejects.toThrow(/declares no "server"/)
  })

  it('refuses a server the config names and the project does not have', async () => {
    const root = await project({ 'assemora.config.ts': config("server: 'src/server.ts'") })

    await expect(invoke(['start'], root)).rejects.toThrow(/src\/server\.ts/)
  })

  it(
    'asks the server to stop when the CLI is signalled, and reports what that left',
    async () => {
      const root = await project({
        'assemora.config.ts': config("server: 'server.mjs'"),
        'server.mjs': server(beside('ready.txt', "'ready'"), 'setInterval(() => {}, 1000)'),
      })

      const running = invoke(['start'], root)
      await waitFor(join(root, 'ready.txt'))
      raise('SIGTERM')

      // 128 plus the signal's number, which is what the shell reports and what
      // running the server by hand and pressing Ctrl-C would have left behind.
      expect(await running).toBe(143)
    },
    PATIENCE,
  )
})

describe('dev', () => {
  it(
    'puts a watcher between itself and the server',
    async () => {
      const root = await project({
        'assemora.config.ts': config("server: 'server.mjs'"),
        'server.mjs': server(beside('ppid.txt', 'String(process.ppid)'), 'process.exit(0)'),
      })

      const running = invoke(['dev'], root)
      const parent = await waitFor(join(root, 'ppid.txt'))

      // `node --watch` runs the script in a child of its own, so the process that
      // wrote this is a grandchild — which is the only externally visible difference
      // between `dev` and `start`, and the one worth asserting.
      expect(parent).not.toBe(String(process.pid))

      raise('SIGTERM')
      expect(await running).toBe(0)
    },
    PATIENCE,
  )
})

describe('build', () => {
  const ownScript = {
    'assemora.config.ts': config("openapi: { out: 'openapi.json' }, sdk: { out: 'sdk.ts' }"),
    'package.json': '{ "name": "demo", "private": true, "scripts": { "build": "node own.mjs" } }',
    'own.mjs': server(beside('built.txt', "'yes'")),
  }

  it(
    "runs the project's own build script and says that it did",
    async () => {
      const root = await project(ownScript)

      expect(await invoke(['build'], root)).toBe(0)
      expect(await readFile(join(root, 'built.txt'), 'utf8')).toBe('yes')
      expect(output.stdout).toContain("the project's own build script")
    },
    PATIENCE,
  )

  it(
    'leaves the artifacts alone when the project builds itself',
    async () => {
      const root = await project(ownScript)

      await invoke(['build'], root)

      expect(artifacts).toEqual([])
    },
    PATIENCE,
  )

  it(
    "typechecks with the project's own TypeScript, against the project's own tsconfig",
    async () => {
      const root = await project({
        'assemora.config.ts': config("server: 'server.mjs'"),
        ...typescript(0),
      })

      expect(await invoke(['build'], root)).toBe(0)

      const argv: unknown = JSON.parse(
        await readFile(join(root, 'node_modules/typescript/bin/argv.json'), 'utf8'),
      )

      expect(argv).toEqual(['--project', join(root, 'tsconfig.json'), '--noEmit'])
    },
    PATIENCE,
  )

  it(
    'regenerates nothing when the typecheck fails, and says why',
    async () => {
      const root = await project({
        'assemora.config.ts': config("openapi: { out: 'openapi.json' }"),
        ...typescript(2),
      })

      expect(await invoke(['build'], root)).toBe(1)
      expect(artifacts).toEqual([])
      expect(output.stderr).toContain('typecheck failed')
    },
    PATIENCE,
  )

  it('runs every artifact command the config declares, the document before its client', async () => {
    const root = await project({
      'assemora.config.ts': config("sdk: { out: 'sdk.ts' }, openapi: { out: 'openapi.json' }"),
    })

    expect(await invoke(['build', '--no-typecheck'], root)).toBe(0)
    expect(artifacts).toEqual(['api:openapi', 'sdk:generate'])
  })

  it('runs only the artifact the config declares', async () => {
    const root = await project({
      'assemora.config.ts': config("sdk: { out: 'sdk.ts' }"),
    })

    expect(await invoke(['build', '--no-typecheck'], root)).toBe(0)
    expect(artifacts).toEqual(['sdk:generate'])
  })

  it('stops at the first artifact command that fails', async () => {
    const root = await project({
      'assemora.config.ts': config("openapi: { out: 'openapi.json' }, sdk: { out: 'sdk.ts' }"),
    })
    exits.set('api:openapi', 1)

    expect(await invoke(['build', '--no-typecheck'], root)).toBe(1)
    expect(artifacts).toEqual(['api:openapi'])
    expect(output.stderr).toContain('api:openapi failed')
  })

  it('says plainly when the config declares nothing to regenerate', async () => {
    const root = await project({ 'assemora.config.ts': config("server: 'server.mjs'") })

    expect(await invoke(['build', '--no-typecheck'], root)).toBe(0)
    expect(output.stdout).toContain('no artifacts to regenerate')
  })

  it('refuses to build a project with no TypeScript to check with', async () => {
    const root = await project({
      'assemora.config.ts': config("server: 'server.mjs'"),
      'tsconfig.json': '{}',
    })

    await expect(invoke(['build'], root)).rejects.toThrow(/TypeScript is not installed/)
  })

  it('names the tsconfig.json it could not find', async () => {
    const root = await project({ 'assemora.config.ts': config("server: 'server.mjs'") })

    await expect(invoke(['build'], root)).rejects.toThrow(/no tsconfig\.json/)
  })
})
