/**
 * `api:openapi` and `sdk:generate`, driven through `run()` (SPEC.md §44, §48, §77).
 *
 * The application below is a real one and the entries are registered into its real
 * Schema Registry, because that registry is the whole input to both generators: if a
 * route can be registered and does not reach the document, these commands are the
 * only place that can be true (SPEC.md §3.7).
 */
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'

import { type Application, createApplication, permitAll } from '@assemora/core'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { run } from '../index.js'
import { type CapturedOutput, captureOutput } from '../output.js'
import { shutdown } from '../project.js'
import { commandNamed } from '../registry.js'
import { artifactCommands } from './artifacts.js'

type Descriptor = { readonly name: string } & Readonly<Record<string, unknown>>

const roots: string[] = []
const handles: string[] = []

let output: CapturedOutput
let project: string

/**
 * Registers entries in a section whose descriptor type this package may not import.
 *
 * `routes` and `resources` belong to packages `@assemora/cli` is forbidden to depend
 * on (ADR-0021), so they are written here as the plain data the registry stores.
 */
const registerSection = (
  app: Application,
  section: string,
  entries: readonly Descriptor[],
): void => {
  const registry = app.registry as unknown as {
    register(section: string, entry: Descriptor): void
  }

  for (const entry of entries) registry.register(section, entry)
}

/**
 * A project whose config hands the CLI the application built here.
 *
 * A config written into a temporary directory cannot import `@assemora/core` —
 * resolution from the system temp directory finds no workspace — so the application
 * is constructed in this file, where the imports resolve, and the generated config
 * picks it up off `globalThis`.
 */
const projectFor = async (
  app: Application,
  declared: Readonly<Record<string, unknown>> = {},
): Promise<string> => {
  const root = await mkdtemp(join(tmpdir(), 'assemora-cli-artifacts-'))
  const handle = basename(root)

  roots.push(root)
  handles.push(handle)
  Reflect.set(globalThis, handle, app)

  await writeFile(
    join(root, 'assemora.config.ts'),
    [
      `const declared = ${JSON.stringify(declared, null, 2)}`,
      `export default { ...declared, app: () => globalThis[${JSON.stringify(handle)}] }`,
      '',
    ].join('\n'),
  )

  return root
}

const cli = (argv: readonly string[]): Promise<number> =>
  run(argv, { cwd: project, commands: artifactCommands })

const empty = (): Application => createApplication({ authorization: permitAll() })

const described = (): Application => {
  const app = empty()

  registerSection(app, 'routes', [
    {
      name: 'post /auth/login',
      method: 'post',
      path: '/auth/login',
      description: 'Exchanges credentials for a token',
      tags: ['auth'],
      auth: false,
      status: 201,
      errors: [],
      body: { type: 'object', properties: { email: { type: 'string' } }, required: ['email'] },
      response: { type: 'object', properties: { token: { type: 'string' } } },
    },
  ])

  registerSection(app, 'resources', [
    {
      name: 'articles',
      label: 'Articles',
      kind: 'static',
      model: 'articles',
      primaryKey: 'id',
      perPage: 20,
      api: { create: true, read: true, update: true, delete: true },
      fields: [
        { name: 'title', kind: 'text', required: true, hidden: false, schema: { type: 'string' } },
        {
          name: 'internalNote',
          kind: 'text',
          required: false,
          hidden: true,
          schema: { type: 'string' },
        },
      ],
    },
  ])

  return app
}

const contentsOf = (relative: string): Promise<string> => readFile(join(project, relative), 'utf8')

/** What the "Wrote …" line claims, so a test can hold it against the file itself. */
const reported = (): { readonly path: string; readonly bytes: number } => {
  const match = /^Wrote (.+) \((\d+) bytes\)$/m.exec(output.stdout)

  if (match?.[1] === undefined || match[2] === undefined) {
    throw new Error(`No "Wrote …" line in: ${JSON.stringify(output.stdout)}`)
  }

  return { path: match[1], bytes: Number(match[2]) }
}

beforeEach(() => {
  output = captureOutput()
})

afterEach(async () => {
  output.restore()
  await shutdown()

  for (const handle of handles.splice(0)) Reflect.deleteProperty(globalThis, handle)
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

describe('both artifacts are in the command table', () => {
  it('registers the two names SPEC.md §77 lists', () => {
    expect(artifactCommands.map((command) => command.name)).toEqual(['api:openapi', 'sdk:generate'])

    for (const command of artifactCommands) {
      expect(commandNamed(command.name)).toBe(command)
      expect(command.group).toBe('artifacts')
    }
  })
})

describe('api:openapi', () => {
  it('documents a route the application registered, and nothing anyone wrote by hand', async () => {
    project = await projectFor(described(), {
      openapi: { info: { title: 'Blog', version: '2.1.0' } },
    })

    expect(await cli(['api:openapi'])).toBe(0)

    const document = JSON.parse(await contentsOf('openapi.json')) as {
      openapi: string
      info: { title: string; version: string }
      paths: Record<string, Record<string, { summary?: string }>>
    }

    expect(document.openapi).toBe('3.1.0')
    expect(document.info).toEqual({ title: 'Blog', version: '2.1.0' })
    expect(document.paths['/api/auth/login']?.post?.summary).toBe(
      'Exchanges credentials for a token',
    )
  })

  it('reports where it wrote and how big it is, in bytes the file really has', async () => {
    project = await projectFor(described())

    await cli(['api:openapi'])

    const claimed = reported()

    expect(claimed.path).toBe('openapi.json')
    expect(claimed.bytes).toBe((await stat(join(project, 'openapi.json'))).size)
  })

  it('writes where the config says when no flag is given', async () => {
    project = await projectFor(described(), { openapi: { out: 'docs/api.json' } })

    await cli(['api:openapi'])

    expect(reported().path).toBe('docs/api.json')
    expect(JSON.parse(await contentsOf('docs/api.json'))).toMatchObject({ openapi: '3.1.0' })
  })

  it('creates the directory it was pointed at rather than refusing to write', async () => {
    project = await projectFor(described())

    expect(await cli(['api:openapi', '--out', 'build/nested/openapi.json'])).toBe(0)
    await expect(contentsOf('build/nested/openapi.json')).resolves.toContain('"openapi"')
  })

  it('lets --out win over the path the config declares', async () => {
    project = await projectFor(described(), { openapi: { out: 'docs/api.json' } })

    await cli(['api:openapi', '--out', 'elsewhere.json'])

    expect(reported().path).toBe('elsewhere.json')
    await expect(stat(join(project, 'docs/api.json'))).rejects.toThrow()
  })

  it('puts the document on stdout for --stdout, and puts nothing else there', async () => {
    project = await projectFor(described())

    expect(await cli(['api:openapi', '--stdout'])).toBe(0)

    expect(output.stdout).not.toContain('Wrote')
    expect(JSON.parse(output.stdout)).toMatchObject({ openapi: '3.1.0' })
    await expect(stat(join(project, 'openapi.json'))).rejects.toThrow()
  })

  it('titles the document after the project when the config declares no info', async () => {
    project = await projectFor(described())
    await writeFile(
      join(project, 'package.json'),
      `${JSON.stringify({ name: 'my-blog', version: '0.4.2' })}\n`,
    )

    await cli(['api:openapi', '--stdout'])

    expect(JSON.parse(output.stdout)).toMatchObject({
      info: { title: 'my-blog', version: '0.4.2' },
    })
  })

  it('falls back to a name of its own when there is no manifest either', async () => {
    project = await projectFor(described())

    await cli(['api:openapi', '--stdout'])

    expect(JSON.parse(output.stdout)).toMatchObject({
      info: { title: 'Assemora application', version: '0.0.0' },
    })
  })

  it('leaves a hidden field out of the document it publishes (SPEC.md §85)', async () => {
    project = await projectFor(described())

    await cli(['api:openapi', '--stdout'])

    expect(output.stdout).toContain('title')
    expect(output.stdout).not.toContain('internalNote')
  })

  it('describes an application that declares nothing without producing a broken document', async () => {
    project = await projectFor(empty())

    expect(await cli(['api:openapi', '--stdout'])).toBe(0)

    const document = JSON.parse(output.stdout) as {
      openapi: string
      paths: Record<string, unknown>
      components: { schemas: Record<string, unknown> }
      tags: unknown[]
    }

    expect(document.openapi).toBe('3.1.0')
    expect(document.paths).toEqual({})
    expect(document.tags).toEqual([])
    expect(document.components.schemas.Error).toBeDefined()
  })
})

describe('sdk:generate', () => {
  it('writes a record type for every resource, without the fields they hide', async () => {
    project = await projectFor(described())

    expect(await cli(['sdk:generate'])).toBe(0)

    const client = await contentsOf('src/generated/sdk.ts')

    expect(client).toContain('export type Articles = {')
    expect(client).toContain('readonly title: string')
    expect(client).not.toContain('internalNote')
    expect(client).toContain('export const createTypedClient')
  })

  it('lands beside the project source, so a renamed source directory takes it along', async () => {
    project = await projectFor(described(), { paths: { source: 'app' } })

    await cli(['sdk:generate'])

    expect(reported().path).toBe('app/generated/sdk.ts')
  })

  it('writes where the config says when no flag is given', async () => {
    project = await projectFor(described(), { sdk: { out: 'src/api.ts' } })

    await cli(['sdk:generate'])

    expect(reported().path).toBe('src/api.ts')
  })

  it('lets --out win over the path the config declares', async () => {
    project = await projectFor(described(), { sdk: { out: 'src/api.ts' } })

    await cli(['sdk:generate', '--out', 'other.ts'])

    expect(reported().path).toBe('other.ts')
    await expect(stat(join(project, 'src/api.ts'))).rejects.toThrow()
  })

  it('imports the runtime from the module the config names', async () => {
    project = await projectFor(described(), { sdk: { clientModule: '../runtime.js' } })

    await cli(['sdk:generate', '--stdout'])

    expect(output.stdout).toContain("from '../runtime.js'")
  })

  it('imports it from @assemora/sdk when the config names none', async () => {
    project = await projectFor(described())

    await cli(['sdk:generate', '--stdout'])

    expect(output.stdout).toContain("from '@assemora/sdk'")
  })

  it('ends the file with exactly one newline, whatever the generator left', async () => {
    project = await projectFor(described())

    await cli(['sdk:generate'])

    const client = await contentsOf('src/generated/sdk.ts')

    expect(client.endsWith('\n')).toBe(true)
    expect(client.endsWith('\n\n')).toBe(false)
  })

  it('generates a client for an application with no resources at all', async () => {
    project = await projectFor(empty())

    expect(await cli(['sdk:generate'])).toBe(0)

    const client = await contentsOf('src/generated/sdk.ts')

    expect(client).toContain('export type AssemoraApi = Client & {')
    expect(client).toContain('export const createTypedClient')
    expect(client).not.toContain('undefined')
  })
})

describe('a project without a config', () => {
  it('is one clear sentence rather than a stack trace', async () => {
    const root = await mkdtemp(join(tmpdir(), 'assemora-cli-artifacts-'))
    roots.push(root)

    const code = await run(['api:openapi'], { cwd: root, commands: artifactCommands })

    expect(code).toBe(1)
    expect(output.stderr).toContain('assemora.config.ts')
  })
})
