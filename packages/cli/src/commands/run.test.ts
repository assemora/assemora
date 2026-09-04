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
import { type ChildProcess, spawn } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { connect } from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { parseArgs } from '../args.js'
import { type CapturedOutput, captureOutput } from '../output.js'
import { commandNamed, defineCommand, register } from '../registry.js'
import { serverArgv } from './run.js'

/** Long enough for a spawned Node to start, which is most of what these cases cost. */
const PATIENCE = 20_000

const created: string[] = []
const artifacts: string[] = []
const exits = new Map<string, number>()

/** Anything a case started that has to die even when the case fails. */
const stragglers: number[] = []

let output: CapturedOutput

/** The marker an artifact command leaves behind, as a filename can hold it. */
const markerFor = (name: string): string => `ran-${name.replace(':', '-')}.txt`

/**
 * Stands in for the commands `build` delegates to.
 *
 * `build` finds them by name in the table, which is the seam being tested: it must
 * run the command that owns an artifact rather than generate one of its own. The
 * marker file is written where the project's own build script can see it, because the
 * other half of the seam is ordering: a bundle that includes the generated SDK has to
 * run after the command that generates it.
 */
const artifact = (name: string) =>
  defineCommand({
    name,
    group: 'artifacts',
    summary: `stands in for ${name}`,
    usage: `assemora ${name}`,
    handler: async ({ cwd }) => {
      artifacts.push(name)
      await writeFile(join(cwd, markerFor(name)), 'yes')

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

const pause = (milliseconds: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, milliseconds)
  })

/** Whether anything answers on the port — the question `dev` has to leave answered "no". */
const listening = (port: number): Promise<boolean> =>
  new Promise((resolve) => {
    const socket = connect({ port, host: '127.0.0.1' })

    const answer = (held: boolean) => (): void => {
      socket.destroy()
      resolve(held)
    }

    socket.once('connect', answer(true))
    socket.once('error', answer(false))
  })

/**
 * Waits for the port to come free, which after a signal is a moment away rather than
 * instant: the CLI answers when its own child is reaped, and the process that held the
 * socket is one below that.
 */
const freed = async (port: number): Promise<boolean> => {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (!(await listening(port))) return true

    await pause(50)
  }

  return false
}

const alive = (pid: number): boolean => {
  try {
    process.kill(pid, 0)

    return true
  } catch {
    return false
  }
}

/**
 * Waits for a process to be gone, the way `freed` waits for a port.
 *
 * A server closes its listening socket while it is shutting down, so the port is free
 * before the process that held it has been reaped — asking about the pid the instant the
 * port frees is asking during that window. Polled rather than paused once: the width of
 * the window is the machine's, and this suite runs beside 137 other files.
 */
const buried = async (pid: number): Promise<boolean> => {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (!alive(pid)) return true

    await pause(50)
  }

  return false
}

/**
 * A server that holds a port, and may ignore the polite signal.
 *
 * Ignoring it is what a graceful drain looks like for the seconds that matter, and it
 * is the case the escalation to SIGKILL exists for. It reports where it is listening,
 * who it is and who its parent is, because all three are what a case has to check
 * afterwards: under `dev` the parent is Node's watch wrapper, which has to go too.
 */
const listeningServer = (options: { readonly stubborn: boolean }): string =>
  [
    "import { writeFileSync } from 'node:fs'",
    "import { createServer } from 'node:net'",
    '',
    ...(options.stubborn
      ? ["process.on('SIGTERM', () => {})", "process.on('SIGINT', () => {})", '']
      : []),
    'const socket = createServer(() => {})',
    '',
    "socket.listen(0, '127.0.0.1', () => {",
    '  const address = socket.address()',
    '',
    '  writeFileSync(',
    "    new URL('./listening.json', import.meta.url),",
    "    JSON.stringify({ port: typeof address === 'object' && address !== null ? address.port : 0, pid: process.pid, ppid: process.ppid }),",
    '  )',
    '})',
    '',
  ].join('\n')

const STUBBORN_SERVER = listeningServer({ stubborn: true })

const whereItListens = async (
  root: string,
): Promise<{ port: number; pid: number; ppid: number }> => {
  const written: unknown = JSON.parse(await waitFor(join(root, 'listening.json')))

  if (
    typeof written !== 'object' ||
    written === null ||
    typeof (written as { port?: unknown }).port !== 'number' ||
    typeof (written as { pid?: unknown }).pid !== 'number' ||
    typeof (written as { ppid?: unknown }).ppid !== 'number'
  ) {
    throw new Error('the server did not report where it was listening')
  }

  return written as { port: number; pid: number; ppid: number }
}

/**
 * Stands in for the CLI, in a process of its own, so that it can be killed outright.
 *
 * It spawns what it is sent exactly as `spawnProcess` does — detached, in a group of
 * its own — and then waits to be killed. What is under test is the argv `serverArgv`
 * builds: that a server started with it does not survive the process it names.
 */
const SUPERVISOR = [
  "import { spawn } from 'node:child_process'",
  '',
  "let input = ''",
  "process.stdin.on('data', (chunk) => { input += chunk })",
  "process.stdin.on('end', () => {",
  '  const { argv, cwd } = JSON.parse(input)',
  "  spawn(process.execPath, argv, { cwd, stdio: 'inherit', detached: true })",
  '  setInterval(() => {}, 1000)',
  '})',
  '',
].join('\n')

/** Starts the stand-in and hands it the server, with itself as the process to watch. */
const supervise = (root: string, watch: boolean): ChildProcess => {
  const supervisor = spawn(process.execPath, [join(root, 'supervisor.mjs')], {
    stdio: ['pipe', 'inherit', 'inherit'],
  })

  if (supervisor.pid === undefined) throw new Error('the stand-in did not start')
  stragglers.push(supervisor.pid)

  const argv = serverArgv({
    watch,
    passthrough: [],
    entry: 'server.mjs',
    supervisor: supervisor.pid,
  })

  supervisor.stdin?.end(JSON.stringify({ argv, cwd: root }))

  return supervisor
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

  // A case that fails is a case that left a server running, and a server that outlives
  // the suite is the very defect under test leaking into the next run.
  for (const pid of stragglers.splice(0)) {
    try {
      process.kill(pid, 'SIGKILL')
    } catch {
      // Already gone, which is what every passing case leaves behind.
    }
  }

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

  it(
    'preloads the watchdog, naming the CLI as the process it watches',
    async () => {
      const root = await project({
        'assemora.config.ts': config("server: 'server.mjs'"),
        'server.mjs': server(beside('argv.json', 'JSON.stringify(process.execArgv)')),
      })

      expect(await invoke(['start'], root)).toBe(0)

      const argv: unknown = JSON.parse(await readFile(join(root, 'argv.json'), 'utf8'))

      expect(argv).toEqual([
        '--import',
        expect.stringMatching(new RegExp(`/watchdog\\.[jt]s\\?parent=${process.pid}$`)),
      ])
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

  it(
    'stops the server on a hangup, which the child no longer hears for itself',
    async () => {
      const root = await project({
        'assemora.config.ts': config("server: 'server.mjs'"),
        'server.mjs': server(beside('ready.txt', "'ready'"), 'setInterval(() => {}, 1000)'),
      })

      const running = invoke(['start'], root)
      await waitFor(join(root, 'ready.txt'))

      // The child runs in a process group of its own, so closing the terminal reaches
      // the CLI and nothing else. A hangup the CLI does not pass on is a dev server
      // left running with no terminal to stop it from.
      raise('SIGHUP')

      expect(await running).toBe(129)
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

  it(
    'takes the server the watcher started down with it, so nothing keeps the port',
    async () => {
      const root = await project({
        'assemora.config.ts': config("server: 'server.mjs'"),
        'server.mjs': STUBBORN_SERVER,
      })

      const running = invoke(['dev'], root)
      const { port, pid } = await whereItListens(root)
      stragglers.push(pid)

      expect(await listening(port)).toBe(true)

      // The first signal is the one this server ignores; the second escalates. Sent to
      // the watcher alone, the escalation killed the wrapper and left the server — the
      // process actually holding the port — running with init for a parent.
      raise('SIGTERM')
      raise('SIGTERM')

      await running

      expect(await freed(port)).toBe(true)
      expect(await buried(pid)).toBe(true)
    },
    PATIENCE,
  )

  it(
    'takes everything down when the CLI dies outright, which no signal announces',
    async () => {
      const root = await project({
        'supervisor.mjs': SUPERVISOR,
        'server.mjs': listeningServer({ stubborn: false }),
      })

      const supervisor = supervise(root, true)
      const { port, pid, ppid } = await whereItListens(root)
      stragglers.push(pid, ppid)

      expect(await listening(port)).toBe(true)

      // SIGKILL is the one signal a process cannot forward, and a tool that ends the
      // shell it started by killing the shell's group reaches the CLI and stops there:
      // the server is detached, in a group of its own, and hears nothing. Nineteen of
      // them were found listening with init for a parent (#27).
      supervisor.kill('SIGKILL')

      expect(await freed(port)).toBe(true)
      expect(await buried(pid)).toBe(true)
      expect(await buried(ppid)).toBe(true)
    },
    PATIENCE,
  )

  it(
    'and does so for a server that ignores the polite signal, a little later',
    async () => {
      const root = await project({
        'supervisor.mjs': SUPERVISOR,
        'server.mjs': STUBBORN_SERVER,
      })

      const supervisor = supervise(root, true)
      const { port, pid, ppid } = await whereItListens(root)
      stragglers.push(pid, ppid)

      supervisor.kill('SIGKILL')

      // The watchdog's grace is five seconds, and `buried` gives up at five: the wait
      // here is for the escalation, and the check afterwards is that it happened.
      await pause(5_500)

      expect(await freed(port)).toBe(true)
      expect(await buried(pid)).toBe(true)
      expect(await buried(ppid)).toBe(true)
    },
    PATIENCE,
  )
})

describe('build', () => {
  /**
   * A project that builds itself, and reports whether the artifacts were there first.
   *
   * The generated SDK is an input to a project's own bundle, so "before" is not a
   * detail of ordering — it is a bundle built against last week's client.
   */
  const ownScript = {
    'assemora.config.ts': config("openapi: { out: 'openapi.json' }, sdk: { out: 'sdk.ts' }"),
    'package.json': '{ "name": "demo", "private": true, "scripts": { "build": "node own.mjs" } }',
    'own.mjs': [
      "import { existsSync, writeFileSync } from 'node:fs'",
      '',
      `const generated = existsSync(new URL('./${markerFor('sdk:generate')}', import.meta.url))`,
      '',
      beside('built.txt', "generated ? 'after' : 'before'"),
      '',
    ].join('\n'),
  }

  it(
    "runs the project's own build script and says that it did",
    async () => {
      const root = await project({ ...ownScript, ...typescript(0) })

      expect(await invoke(['build'], root)).toBe(0)
      expect(await readFile(join(root, 'built.txt'), 'utf8')).toBe('after')
      expect(output.stdout).toContain("the project's own build script")
    },
    PATIENCE,
  )

  it(
    'regenerates the artifacts before the project bundles them',
    async () => {
      const root = await project({ ...ownScript, ...typescript(0) })

      expect(await invoke(['build'], root)).toBe(0)

      expect(artifacts).toEqual(['api:openapi', 'sdk:generate'])
      expect(await readFile(join(root, 'built.txt'), 'utf8')).toBe('after')
    },
    PATIENCE,
  )

  it(
    'typechecks a project that builds itself, which is the project the CLI scaffolds',
    async () => {
      const root = await project({ ...ownScript, ...typescript(0) })

      expect(await invoke(['build'], root)).toBe(0)

      const argv: unknown = JSON.parse(
        await readFile(join(root, 'node_modules/typescript/bin/argv.json'), 'utf8'),
      )

      expect(argv).toEqual(['--project', join(root, 'tsconfig.json'), '--noEmit'])
    },
    PATIENCE,
  )

  it(
    "never reaches the project's own build script when the typecheck failed",
    async () => {
      const root = await project({ ...ownScript, ...typescript(2) })

      expect(await invoke(['build'], root)).toBe(1)
      expect(artifacts).toEqual([])
      expect(await readFile(join(root, 'built.txt'), 'utf8').catch(() => undefined)).toBeUndefined()
    },
    PATIENCE,
  )

  it(
    '--no-typecheck is heard on that path too, so a project that builds itself can skip it',
    async () => {
      const root = await project(ownScript)

      expect(await invoke(['build', '--no-typecheck'], root)).toBe(0)
      expect(await readFile(join(root, 'built.txt'), 'utf8')).toBe('after')
    },
    PATIENCE,
  )

  it(
    "fails the build when the project's own build script does, and says which half broke",
    async () => {
      const root = await project({
        ...ownScript,
        'own.mjs': 'process.exit(1)\n',
      })

      expect(await invoke(['build', '--no-typecheck'], root)).toBe(1)
      expect(output.stderr).toContain("project's own build script")
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
