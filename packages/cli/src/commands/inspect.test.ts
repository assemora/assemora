/**
 * The listings of SPEC.md §77, driven through `run()` against a real application.
 *
 * Nothing here is a stub of the Schema Registry: the entries below are registered
 * into the registry a booted application owns, and the commands read them back the
 * only way they can — as the plain data `describe()` returns (ADR-0021). `agents`
 * goes further and travels the real Query Bus, so what these tests prove about it is
 * that the read is authorized and carries a `cli` context.
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'

import {
  type Actor,
  type Application,
  type ContextSource,
  createApplication,
  module,
  permitAll,
  query,
} from '@assemora/core'
import { number } from '@assemora/schema'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { run } from '../index.js'
import { type CapturedOutput, captureOutput } from '../output.js'
import { shutdown } from '../project.js'
import { commandNamed } from '../registry.js'
import { inspectCommands } from './inspect.js'

type Descriptor = { readonly name: string } & Readonly<Record<string, unknown>>

const roots: string[] = []
const handles: string[] = []

let output: CapturedOutput

/**
 * Registers entries in a section whose descriptor type this package may not import.
 *
 * `routes`, `resources` and `blocks` are declared by packages `@assemora/cli` is
 * forbidden to depend on (ADR-0021), so they are written here as the plain data the
 * registry stores — which is also exactly what the commands read back.
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
 * picks it up off `globalThis`. Everything below the config is the real thing.
 */
const cli = async (app: Application, argv: readonly string[]): Promise<number> => {
  const root = await mkdtemp(join(tmpdir(), 'assemora-cli-inspect-'))
  const handle = basename(root)

  roots.push(root)
  handles.push(handle)
  Reflect.set(globalThis, handle, app)

  await writeFile(
    join(root, 'assemora.config.ts'),
    `export default { app: () => globalThis[${JSON.stringify(handle)}] }\n`,
  )

  return run(argv, { cwd: root, commands: inspectCommands })
}

/** Every written line, trailing spaces kept: an empty last cell is part of the row. */
const lines = (): string[] => output.stdout.split('\n').slice(0, -1)

const printed = (): unknown => JSON.parse(output.stdout)

const empty = (): Application => createApplication({ authorization: permitAll() })

const withRoutes = (): Application => {
  const app = empty()

  registerSection(app, 'routes', [
    {
      name: 'get /articles/:id',
      method: 'get',
      path: '/articles/:id',
      description: 'One article',
      tags: [],
      module: 'blog',
      auth: true,
      status: 200,
      errors: [],
    },
    {
      name: 'post /auth/login',
      method: 'post',
      path: '/auth/login',
      description: 'Exchanges credentials for a token',
      tags: ['auth'],
      module: 'accounts',
      auth: false,
      status: 201,
      errors: [],
    },
  ])

  return app
}

const withModels = (): Application => {
  const app = empty()

  registerSection(app, 'models', [
    {
      name: 'articles',
      module: 'blog',
      table: {
        name: 'articles',
        primaryKey: 'id',
        columns: [{ name: 'id' }, { name: 'title' }, { name: 'authorId' }],
        relations: [
          { name: 'author', kind: 'belongsTo', target: 'users', foreignKey: 'authorId' },
          { name: 'comments', kind: 'hasMany', target: 'comments', foreignKey: 'articleId' },
        ],
      },
    },
    {
      name: 'users',
      module: 'accounts',
      table: { name: 'users', primaryKey: 'id', columns: [{ name: 'id' }], relations: [] },
    },
  ])

  return app
}

const withResources = (): Application => {
  const app = empty()

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
        { name: 'title', kind: 'text', hidden: false },
        { name: 'internalNote', kind: 'text', hidden: true },
      ],
    },
  ])

  return app
}

const withBlocks = (): Application => {
  const app = empty()

  registerSection(app, 'blocks', [
    {
      name: 'hero',
      label: 'Hero',
      fields: [{ name: 'title' }, { name: 'subtitle' }],
      acceptsChildren: false,
      allowedChildren: [],
    },
    {
      name: 'section',
      label: 'Section',
      fields: [],
      acceptsChildren: true,
      allowedChildren: ['hero', 'text'],
    },
    {
      name: 'container',
      label: 'Container',
      fields: [],
      acceptsChildren: true,
      allowedChildren: [],
    },
  ])

  return app
}

type Asked = {
  readonly source: ContextSource
  readonly actor: Actor | undefined
  readonly input: Readonly<Record<string, unknown>>
}

let asked: Asked | undefined
let agents: Readonly<Record<string, unknown>>[] = []
let total = 0

/**
 * `auth.agents.list` as `@assemora/auth` declares it (SPEC.md §72).
 *
 * The CLI may not import that package, so the query is declared here with the input
 * and the page shape the real one has. What is under test is that `assemora agents`
 * reaches it through the Query Bus at all, and inside which context.
 */
const listAgents = query('auth.agents.list', {
  description: 'The agent identities this application knows',
  input: { page: number().integer().optional(), perPage: number().integer().optional() },
  handle: async (input, context) => {
    asked = { source: context.source, actor: context.actor, input }

    return {
      data: agents,
      total,
      page: input.page ?? 1,
      perPage: input.perPage ?? 20,
      lastPage: 1,
    }
  },
})

/** `authorization` is left out to get core's `denyAll()`, which is what a real one has. */
const withAgents = (options: { readonly authorized?: boolean } = {}): Application =>
  createApplication({
    ...(options.authorized === false ? {} : { authorization: permitAll() }),
    modules: [module('auth').queries(listAgents)],
  })

beforeEach(() => {
  output = captureOutput()
  asked = undefined
  agents = [
    { id: 'a-1', name: 'editor-bot', permissions: ['articles.read'], enabled: true },
    { id: 'a-2', name: 'sunset-bot', permissions: [], enabled: false },
  ]
  total = 2
})

afterEach(async () => {
  output.restore()
  await shutdown()

  for (const handle of handles.splice(0)) Reflect.deleteProperty(globalThis, handle)
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

describe('every listing is in the command table', () => {
  it('registers the five names SPEC.md §77 lists', () => {
    expect(inspectCommands.map((command) => command.name)).toEqual([
      'routes',
      'models',
      'resources',
      'blocks',
      'agents',
    ])

    for (const command of inspectCommands) {
      expect(commandNamed(command.name)).toBe(command)
      expect(command.group).toBe('inspect')
    }
  })
})

describe('routes', () => {
  it('prints the method, the path, the summary and where the route came from', async () => {
    expect(await cli(withRoutes(), ['routes'])).toBe(0)

    expect(lines()[0]).toBe('Method  Path  Summary  From')
    expect(lines()).toContain('POST  /auth/login  Exchanges credentials for a token  auth')
  })

  it('names the module when a route carries no tags to file it under', async () => {
    await cli(withRoutes(), ['routes'])

    expect(lines()).toContain('GET  /articles/:id  One article  blog')
  })

  it('reads by path rather than in the order the routes were registered', async () => {
    await cli(withRoutes(), ['routes'])

    expect(
      lines()
        .slice(1)
        .map((row) => row.split('  ')[1]),
    ).toEqual(['/articles/:id', '/auth/login'])
  })

  it('prints the section as the registry holds it for --json, columns and all', async () => {
    expect(await cli(withRoutes(), ['routes', '--json'])).toBe(0)

    const entries = printed() as { name: string; status: number; auth: boolean }[]

    expect(entries).toHaveLength(2)
    expect(entries[0]).toMatchObject({ name: 'get /articles/:id', status: 200, auth: true })
  })

  it('says so in a sentence when an application registers none', async () => {
    expect(await cli(empty(), ['routes'])).toBe(0)

    expect(output.stdout).toBe('No routes are registered.\n')
  })

  it('answers --json with an empty array rather than that sentence', async () => {
    await cli(empty(), ['routes', '--json'])

    expect(printed()).toEqual([])
  })
})

describe('models', () => {
  it('counts the columns and names each relation with its kind', async () => {
    expect(await cli(withModels(), ['models'])).toBe(0)

    expect(lines()[0]).toBe('Model  Table  Columns  Relations')
    expect(lines()).toContain('articles  articles  3  author (belongsTo), comments (hasMany)')
  })

  it('leaves the relation cell empty for a model that declares none', async () => {
    await cli(withModels(), ['models'])

    expect(lines()).toContain('users  users  1  ')
  })

  it('says so in a sentence when nothing is declared', async () => {
    await cli(empty(), ['models'])

    expect(output.stdout).toBe('No models are declared.\n')
  })
})

describe('resources', () => {
  it('names the model behind a resource and every field it declares', async () => {
    expect(await cli(withResources(), ['resources'])).toBe(0)

    expect(lines()[0]).toBe('Resource  Model  Fields')
    // A hidden field is a declaration, and this is the developer who wrote it: what
    // SPEC.md §85 keeps out of sight is the value, and no value is read here.
    expect(lines()).toContain('articles  articles  title, internalNote')
  })

  it('says so in a sentence when nothing is declared', async () => {
    await cli(empty(), ['resources'])

    expect(output.stdout).toBe('No resources are declared.\n')
  })
})

describe('blocks', () => {
  it('says which block types a container will take', async () => {
    expect(await cli(withBlocks(), ['blocks'])).toBe(0)

    expect(lines()[0]).toBe('Block  Fields  Children')
    expect(lines()).toContain('section    hero, text')
  })

  it('says "any" for a block that accepts children without naming them', async () => {
    await cli(withBlocks(), ['blocks'])

    expect(lines()).toContain('container    any')
  })

  it('says "no" for a block that takes none, and lists its fields', async () => {
    await cli(withBlocks(), ['blocks'])

    expect(lines()).toContain('hero  title, subtitle  no')
  })

  it('says so in a sentence when nothing is declared', async () => {
    await cli(empty(), ['blocks'])

    expect(output.stdout).toBe('No block types are declared.\n')
  })
})

describe('agents', () => {
  it('reads them through the Query Bus, in a context that says it came from the CLI', async () => {
    expect(await cli(withAgents(), ['agents'])).toBe(0)

    expect(asked?.source).toBe('cli')
    expect(asked?.actor).toBeUndefined()
    expect(lines()[0]).toBe('Agent  Enabled  Permissions')
    expect(lines()).toContain('editor-bot  yes  articles.read')
    expect(lines()).toContain('sunset-bot  no  ')
  })

  it('runs as the user --actor names, so the read is authorized as that person', async () => {
    await cli(withAgents(), ['agents', '--actor', 'ada'])

    expect(asked?.actor).toEqual({ type: 'user', id: 'ada' })
  })

  it('refuses the whole listing when the actor may not read it', async () => {
    expect(await cli(withAgents({ authorized: false }), ['agents'])).toBe(1)

    expect(output.stdout).toBe('')
    expect(output.stderr).toContain('error:')
    expect(output.stderr).toContain('auth.agents.list')
  })

  it('names --actor when the read was refused and nobody was named', async () => {
    await cli(withAgents({ authorized: false }), ['agents'])

    // The authorizer's sentence names the subject and the action, which is everything
    // except the thing the reader has to type next.
    expect(output.stderr).toContain('--actor')
  })

  it('names the actor it was given rather than the flag, when one was given', async () => {
    await cli(withAgents({ authorized: false }), ['agents', '--actor', 'ada'])

    expect(output.stderr).toContain('ada')
    expect(output.stderr).toContain('auth.agents')
  })

  it('says plainly that an application without @assemora/auth knows no agents', async () => {
    expect(await cli(empty(), ['agents'])).toBe(1)

    expect(output.stdout).toBe('')
    expect(output.stderr).toContain('registers no "auth.agents.list"')
    expect(output.stderr).toContain('@assemora/auth')
  })

  it('prints the whole page for --json, not only the rows', async () => {
    expect(await cli(withAgents(), ['agents', '--json'])).toBe(0)

    expect(printed()).toMatchObject({ total: 2, page: 1, perPage: 20 })
  })

  it('forwards --page and --per-page to the query that pages', async () => {
    await cli(withAgents(), ['agents', '--page', '2', '--per-page', '5'])

    expect(asked?.input).toEqual({ page: 2, perPage: 5 })
  })

  it('calls a page that is not a whole number a wrong invocation, not a failure', async () => {
    expect(await cli(withAgents(), ['agents', '--page', 'two'])).toBe(2)

    expect(asked).toBeUndefined()
    expect(output.stderr).toContain('--page and --per-page each take a whole number')
  })

  it('refuses a page of zero for the same reason', async () => {
    expect(await cli(withAgents(), ['agents', '--per-page', '0'])).toBe(2)

    expect(asked).toBeUndefined()
  })

  it('says how much of the total it showed, on stderr so the listing stays clean', async () => {
    total = 40

    await cli(withAgents(), ['agents'])

    expect(output.stdout).not.toContain('Showing')
    expect(output.stderr).toContain('Showing 2 of 40')
  })

  it('says nothing about a total it has already shown in full', async () => {
    await cli(withAgents(), ['agents'])

    expect(output.stderr).toBe('')
  })

  it('answers with a sentence when the application knows no agents at all', async () => {
    agents = []
    total = 0

    expect(await cli(withAgents(), ['agents'])).toBe(0)

    expect(output.stdout).toBe('No agent identities exist.\n')
  })
})
