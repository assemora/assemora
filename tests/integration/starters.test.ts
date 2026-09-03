/**
 * What a scaffolded project does on its first boot (SPEC.md §79, §85).
 *
 * `assemora start` — the production command — runs `src/server.ts` and nothing else,
 * so whatever that file does at the top level is what a first deploy does. Two things
 * must therefore be true of every starter and every example in this repository, and
 * neither is provable by reading the file once and remembering:
 *
 * - a deploy against a fresh database does not gain an administrator nobody asked
 *   for, least of all one whose password is published here;
 * - no credential reaches a stream. `assemora start` inherits the streams of whatever
 *   supervises it, so a password or an API token printed on boot is a password or an
 *   API token in the log aggregator (docs/rules/security.md).
 *
 * The first half of this file states both as a contract over the sources of the four
 * projects. The second half boots two of them for real, signs in, and proves it.
 */

import { spawn } from 'node:child_process'
import { copyFile, cp, mkdtemp, readdir, readFile, rm, symlink } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, it } from 'vitest'

import { realInfrastructure } from './budget.ts'

realInfrastructure()

/** Every project in this repository that a person is invited to copy or to run. */
const PROJECTS = ['starters/bare', 'starters/nextjs', 'examples/blog', 'examples/company'] as const

const pathOf = (project: string): string =>
  fileURLToPath(new URL(`../../${project}`, import.meta.url))

/** The one this repository used to ship, quoted so a regression is named rather than described. */
const PUBLISHED = ['correct', 'horse', 'battery', 'staple'].join(' ')

const SOURCES = new Set(['.ts', '.tsx', '.mjs', '.json', '.md', '.example', '.css', '.html'])

const IGNORED = new Set(['node_modules', 'dist', '.next', '.turbo', '.assemora', 'database'])

const filesUnder = async (root: string): Promise<readonly string[]> => {
  const found: string[] = []

  const walk = async (directory: string): Promise<void> => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (IGNORED.has(entry.name)) continue

      const path = join(directory, entry.name)

      if (entry.isDirectory()) await walk(path)
      else if (SOURCES.has(entry.name.slice(entry.name.lastIndexOf('.')))) found.push(path)
    }
  }

  await walk(root)

  return found
}

describe.each(PROJECTS)('%s, as a source', (project) => {
  const root = pathOf(project)

  it('carries no password of its own', async () => {
    const offenders: string[] = []

    for (const file of await filesUnder(root)) {
      const source = await readFile(file, 'utf8')

      // Two claims in one: the passphrase this repository used to publish is gone,
      // and nothing has taken its place. A credential a project ships is a credential
      // every copy of that project shares.
      if (source.includes(PUBLISHED)) offenders.push(`${file}: the published passphrase`)
      if (/(?:password|PASSWORD)\s*=\s*['"][^'"]+['"]/.test(source)) {
        offenders.push(`${file}: a password written into the source`)
      }
    }

    expect(offenders).toEqual([])
  })

  it('does not seed a real database from the start path', async () => {
    const server = await readFile(join(root, 'src/server.ts'), 'utf8')
    const calls = server.match(/\bseed\(/g) ?? []

    // One call, and it is the guarded one. `assemora start` runs this file, so a
    // second unguarded call is a deploy that creates an account of its own.
    expect(calls).toHaveLength(1)
    expect(server).toMatch(/if \(databaseUrl\(\) === undefined\) await seed\(/)
  })

  it('writes no secret to a stream', async () => {
    for (const file of await filesUnder(root)) {
      const source = await readFile(file, 'utf8')
      const printed = source.match(/console\.\w+\([\s\S]*?\n?\)/g) ?? []

      for (const call of printed) {
        expect(call, `${file} prints a secret`).not.toMatch(/\$\{[^}]*[Pp]assword[^}]*\}/)
        expect(call, `${file} prints a secret`).not.toMatch(/\$\{[^}]*[Tt]oken[^}]*\}/)
      }
    }
  })
})

/*
 * ---------------------------------------------------------------------------------
 * Booted for real: the two starters, on an in-memory database, over HTTP.
 * ---------------------------------------------------------------------------------
 */

/** A port the operating system has just confirmed is free. */
const freePort = (): Promise<number> =>
  new Promise((resolve, reject) => {
    const probe = createServer()

    probe.once('error', reject)
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address()

      if (address === null || typeof address === 'string') {
        probe.close()
        reject(new Error('the probe did not report a port'))
        return
      }

      probe.close(() => resolve(address.port))
    })
  })

type Running = {
  readonly root: string
  readonly port: number
  readonly output: () => string
  stop(): Promise<void>
}

const running: Running[] = []

afterAll(async () => {
  for (const started of running) await started.stop()
})

/**
 * The project, copied somewhere it can be started without touching this checkout.
 *
 * Only `src/` and the manifest are copied — everything else the server reads is
 * optional — and `node_modules` is symlinked rather than copied, so the workspace
 * links inside it still resolve to `packages/`. The copy matters because the seed
 * writes a `.env`, and a test has no business writing one into `starters/`.
 */
const start = async (project: string): Promise<Running> => {
  const source = pathOf(project)
  const root = await mkdtemp(join(tmpdir(), 'assemora-starter-'))

  await cp(join(source, 'src'), join(root, 'src'), { recursive: true })
  await copyFile(join(source, 'package.json'), join(root, 'package.json'))
  await symlink(join(source, 'node_modules'), join(root, 'node_modules'), 'dir')

  const port = await freePort()
  const child = spawn(process.execPath, [join(root, 'src', 'server.ts')], {
    cwd: root,
    env: { ...process.env, PORT: String(port), DATABASE_URL: '' },
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  let output = ''

  child.stdout.on('data', (chunk: Buffer) => {
    output += chunk.toString()
  })
  child.stderr.on('data', (chunk: Buffer) => {
    output += chunk.toString()
  })

  const started: Running = {
    root,
    port,
    output: () => output,
    stop: async () => {
      child.kill('SIGKILL')
      await rm(root, { recursive: true, force: true })
    },
  }

  running.push(started)

  const deadline = Date.now() + 40_000

  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`${project} exited early:\n${output}`)

    try {
      await fetch(`http://127.0.0.1:${port}/api/health`)

      return started
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 200))
    }
  }

  throw new Error(`${project} never listened:\n${output}`)
}

const signIn = (port: number, email: string, password: string): Promise<Response> =>
  fetch(`http://127.0.0.1:${port}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })

const variable = (env: string, name: string): string => {
  const line = env.split('\n').find((entry) => entry.startsWith(`${name}=`))

  return line === undefined ? '' : line.slice(name.length + 1)
}

/** The first account each project seeds, which is the one a person signs in as. */
const ADMINISTRATOR: Readonly<Record<(typeof PROJECTS)[number], string>> = {
  'starters/bare': 'admin@example.com',
  'starters/nextjs': 'admin@example.com',
  'examples/blog': 'editor@example.com',
  'examples/company': 'admin@example.com',
}

describe.each(PROJECTS)('%s, booted', (project) => {
  it('seeds an account whose password this repository does not know', async () => {
    const started = await start(project)
    const env = await readFile(join(started.root, '.env'), 'utf8')
    const password = variable(env, 'ASSEMORA_SEED_PASSWORD')

    // Generated rather than shipped, and in `.env` rather than in the output.
    expect(password.length).toBeGreaterThan(15)
    expect(started.output()).not.toContain(password)
    expect(started.output()).not.toContain(PUBLISHED)

    const email = ADMINISTRATOR[project]

    const refused = await signIn(started.port, email, PUBLISHED)
    expect(refused.status).not.toBe(200)

    const allowed = await signIn(started.port, email, password)
    expect(allowed.status).toBe(200)
  }, 60_000)
})

describe('starters/nextjs, booted', () => {
  it('puts the frontend token in .env rather than in the log', async () => {
    // `createApiToken` hands back the plaintext exactly once (SPEC.md §52), and this
    // is the only place it may land: the file Next.js reads its own configuration
    // from, gitignored, mode 0600 — not a stream a supervisor is collecting.
    const started = await start('starters/nextjs')
    const env = await readFile(join(started.root, '.env'), 'utf8')
    const token = variable(env, 'ASSEMORA_TOKEN')

    expect(token).not.toBe('')
    expect(started.output()).not.toContain(token)
  }, 60_000)
})
