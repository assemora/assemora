/**
 * Booting the project's application (ADR-0021).
 *
 * The applications here are written into a temporary `assemora.config.ts` and record
 * what happens to them in a file, because the point of this module is *how often* an
 * application is booted, and a real one would answer that question the same way while
 * also opening a database connection.
 */
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { type LoadedConfig, loadConfig } from './config.js'
import { loadApplication, shutdown } from './project.js'

const created: string[] = []

/** A config whose application appends a line to `log` every time it is touched. */
const application = (log: string, failing = false): string =>
  [
    "import { appendFileSync } from 'node:fs'",
    `const log = ${JSON.stringify(log)}`,
    'const application = {',
    '  registry: {},',
    '  commands: {},',
    '  queries: {},',
    "  boot: async () => { appendFileSync(log, 'boot\\n'); return application },",
    "  shutdown: async () => { appendFileSync(log, 'shutdown\\n') },",
    '}',
    'export default {',
    '  app: async () => {',
    "    appendFileSync(log, 'asked\\n')",
    failing ? "    throw new Error('no database')" : '    return application',
    '  },',
    '}',
    '',
  ].join('\n')

const project = async (contents: string): Promise<LoadedConfig> => {
  const root = await mkdtemp(join(tmpdir(), 'assemora-cli-project-'))
  created.push(root)
  await writeFile(join(root, 'assemora.config.ts'), contents)

  return loadConfig(root)
}

const events = async (log: string): Promise<string[]> =>
  (await readFile(log, 'utf8').catch(() => '')).split('\n').filter((entry) => entry !== '')

afterEach(async () => {
  await shutdown()
  for (const root of created.splice(0)) await rm(root, { recursive: true, force: true })
})

describe('booting once', () => {
  it('returns the same application however many callers ask for it', async () => {
    const root = await mkdtemp(join(tmpdir(), 'assemora-cli-project-'))
    created.push(root)
    const log = join(root, 'events.log')
    await writeFile(join(root, 'assemora.config.ts'), application(log))
    const loaded = await loadConfig(root)

    const first = await loadApplication(loaded)
    const second = await loadApplication(loaded)

    expect(second).toBe(first)
    expect(await events(log)).toEqual(['asked', 'boot'])
  })

  it('boots the second project rather than answering with the first', async () => {
    const one = await mkdtemp(join(tmpdir(), 'assemora-cli-project-'))
    const two = await mkdtemp(join(tmpdir(), 'assemora-cli-project-'))
    created.push(one, two)
    await writeFile(join(one, 'assemora.config.ts'), application(join(one, 'events.log')))
    await writeFile(join(two, 'assemora.config.ts'), application(join(two, 'events.log')))

    const first = await loadApplication(await loadConfig(one))
    const second = await loadApplication(await loadConfig(two))

    expect(second).not.toBe(first)
    expect(await events(join(two, 'events.log'))).toEqual(['asked', 'boot'])
  })

  it('does not remember a boot that failed', async () => {
    const root = await mkdtemp(join(tmpdir(), 'assemora-cli-project-'))
    created.push(root)
    const log = join(root, 'events.log')
    await writeFile(join(root, 'assemora.config.ts'), application(log, true))
    const loaded = await loadConfig(root)

    await expect(loadApplication(loaded)).rejects.toThrow('no database')
    await expect(loadApplication(loaded)).rejects.toThrow('no database')

    expect(await events(log)).toEqual(['asked', 'asked'])
  })
})

describe('what counts as an application', () => {
  it('refuses something else, and names the config that produced it', async () => {
    const loaded = await project('export default { app: () => ({ boot: 1 }) }\n')

    await expect(loadApplication(loaded)).rejects.toThrow(
      /assemora\.config\.ts: "app" did not return an Assemora application/,
    )
  })

  it('refuses nothing at all', async () => {
    const loaded = await project('export default { app: () => undefined }\n')

    await expect(loadApplication(loaded)).rejects.toThrow(/did not return an Assemora application/)
  })
})

describe('shutting down', () => {
  it('closes what it booted and forgets it, so the next caller gets a fresh one', async () => {
    const root = await mkdtemp(join(tmpdir(), 'assemora-cli-project-'))
    created.push(root)
    const log = join(root, 'events.log')
    await writeFile(join(root, 'assemora.config.ts'), application(log))
    const loaded = await loadConfig(root)

    await loadApplication(loaded)
    await shutdown()
    await loadApplication(loaded)

    expect(await events(log)).toEqual(['asked', 'boot', 'shutdown', 'asked', 'boot'])
  })

  it('has nothing to close when nothing was booted', async () => {
    await expect(shutdown()).resolves.toBeUndefined()
  })
})
