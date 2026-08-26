/**
 * Finding and reading `assemora.config.ts` (SPEC.md §79, ADR-0021).
 *
 * The config is written by hand and imported at runtime, so nothing about it can be
 * assumed. What is under test is that it is found from anywhere inside the project,
 * that its paths mean what the config says rather than what the shell was pointing
 * at, and that every refusal names the field somebody has to go and fix.
 */
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { type CONFIG_FILENAMES, defineConfig, loadConfig } from './config.js'

const created: string[] = []

const project = async (
  contents: string,
  filename: (typeof CONFIG_FILENAMES)[number] = 'assemora.config.ts',
): Promise<string> => {
  const root = await mkdtemp(join(tmpdir(), 'assemora-cli-config-'))
  created.push(root)
  await writeFile(join(root, filename), contents)

  return root
}

/** The smallest config that is valid: an `app` and nothing else. */
const MINIMAL = 'export default { app: () => ({}) }\n'

afterEach(async () => {
  for (const root of created.splice(0)) await rm(root, { recursive: true, force: true })
})

describe('defineConfig', () => {
  it('hands back exactly what it was given, because it is there for the types', () => {
    const app = () => ({}) as never
    const config = defineConfig({ app, server: 'src/server.ts' })

    expect(config).toEqual({ app, server: 'src/server.ts' })
  })
})

describe('finding the config', () => {
  it('walks up from the directory the command was typed in', async () => {
    const root = await project(MINIMAL)
    const deep = join(root, 'src', 'models')
    await mkdir(deep, { recursive: true })

    const loaded = await loadConfig(deep)

    expect(loaded.file).toBe(join(root, 'assemora.config.ts'))
    expect(loaded.root).toBe(root)
  })

  it('reads the JavaScript config when there is no TypeScript one', async () => {
    const root = await project(MINIMAL, 'assemora.config.js')

    expect((await loadConfig(root)).file).toBe(join(root, 'assemora.config.js'))
  })

  it('prefers the TypeScript config when both are there', async () => {
    const root = await project(MINIMAL)
    await writeFile(join(root, 'assemora.config.js'), MINIMAL)

    expect((await loadConfig(root)).file).toBe(join(root, 'assemora.config.ts'))
  })

  it('says what it looked for when there is none, rather than throwing a stack', async () => {
    const root = await mkdtemp(join(tmpdir(), 'assemora-cli-empty-'))
    created.push(root)

    await expect(loadConfig(root)).rejects.toThrow(
      /No assemora\.config\.ts or assemora\.config\.js in .* or any directory above it/,
    )
  })
})

describe('the paths a config declares', () => {
  it('defaults to the layout SPEC.md §79 fixes', async () => {
    const root = await project(MINIMAL)
    const loaded = await loadConfig(root)

    expect(loaded.paths).toEqual({
      source: join(root, 'src'),
      migrations: join(root, 'database/migrations'),
      generated: join(root, '.assemora/generated'),
    })
  })

  it('resolves them against the config, not against the cwd', async () => {
    const root = await project(
      "export default { app: () => ({}), server: 'src/server.ts', paths: { migrations: 'db/sql' } }\n",
    )
    const deep = join(root, 'src', 'models')
    await mkdir(deep, { recursive: true })

    const loaded = await loadConfig(deep)

    expect(loaded.paths.migrations).toBe(join(root, 'db/sql'))
    expect(loaded.server).toBe(join(root, 'src/server.ts'))
    expect(loaded.resolve('openapi.json')).toBe(join(root, 'openapi.json'))
  })

  it('leaves an absolute path alone', async () => {
    const root = await project(MINIMAL)
    const loaded = await loadConfig(root)

    expect(loaded.resolve('/var/tmp/openapi.json')).toBe('/var/tmp/openapi.json')
  })

  it('has no server when the config declares none', async () => {
    const root = await project(MINIMAL)

    expect((await loadConfig(root)).server).toBeUndefined()
  })
})

describe('a config that is wrong', () => {
  it('refuses one with no default export', async () => {
    const root = await project('export const config = { app: () => ({}) }\n')

    await expect(loadConfig(root)).rejects.toThrow(/has no default export/)
  })

  it('refuses one whose default export is not an object', async () => {
    const root = await project('export default 42\n')

    await expect(loadConfig(root)).rejects.toThrow(/must be the object defineConfig\(\) returns/)
  })

  it('names "app" when it is not a function', async () => {
    const root = await project('export default { app: {} }\n')

    await expect(loadConfig(root)).rejects.toThrow(/"app" must be a function/)
  })

  it('names the field that has the wrong type', async () => {
    const root = await project('export default { app: () => ({}), server: 5 }\n')

    await expect(loadConfig(root)).rejects.toThrow(/"server" must be a non-empty path/)
  })

  it('names a nested field by its path', async () => {
    const root = await project(
      "export default { app: () => ({}), openapi: { info: { title: 'x' } } }\n",
    )

    await expect(loadConfig(root)).rejects.toThrow(/"openapi\.info\.version" must be a non-empty/)
  })

  it('keeps the original failure as the cause when the config cannot be imported', async () => {
    const root = await project('export default { app: (\n')

    const error = await loadConfig(root).catch((thrown: unknown) => thrown)

    expect(error).toBeInstanceOf(Error)
    expect((error as Error).message).toContain('could not be imported')
    expect((error as Error).cause).toBeDefined()
  })
})

describe('a config written in TypeScript', () => {
  it('is imported without a transpiler, because Node 24 strips the types', async () => {
    const root = await project(
      [
        'type Paths = { readonly source: string }',
        "const paths: Paths = { source: 'source' }",
        'export default { app: () => ({}), paths }',
        '',
      ].join('\n'),
    )

    expect((await loadConfig(root)).paths.source).toBe(join(root, 'source'))
  })
})
