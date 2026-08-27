/**
 * SPEC.md §124 — the Definition of Done for v1, asserted rather than believed.
 *
 * §124 is one narrative: a project is created, a developer adds a model and a
 * resource, migration gives them eight things nobody configured, a block is defined,
 * Studio assembles a page out of it, an agent connects over MCP and proposes a
 * change a person applies and publishes, and every step of it is recoverable. This
 * file walks that narrative in that order.
 *
 * It has two halves, and they are different kinds of claim.
 *
 * The **scaffold half** asserts what was *written*. A scaffolded project cannot be
 * imported from here: its `workspace:*` specifiers were rewritten to published
 * ranges on the way out, and nothing has been installed into the temporary directory
 * — so `import('…/demo/src/app.ts')` would fail on the first bare specifier it met.
 * What can be checked is the thing `scaffold()` is responsible for: the layout of
 * SPEC.md §79, the project's own name, the dotfiles npm cannot carry, and that no
 * feature marker survived into the source a developer opens.
 *
 * The **application half** builds what that project would have built once installed:
 * `assemora()` with a model, a resource and a block declared here the way §124's
 * developer declares them. Every promise is then asserted through the surface it is
 * a promise about — `server.inject` for REST, OpenAPI and the API Explorer,
 * `generateSdk` for the SDK, a real JSON-RPC handshake and tool calls for the agent,
 * `revisions.list` and `audit.list` for the history. Nothing is asserted against the
 * shape of an object this test constructed itself.
 *
 * The one promise with no assertion here is "PostgreSQL table", because it needs a
 * PostgreSQL. `tests/integration/postgres.test.ts` covers it against a real database
 * — CRUD, transactions, relations, JSONB, migrations — and this file goes as far as
 * a suite with no database honestly can: it asserts the DDL the migration runner
 * would run, which is the step between the model and the table.
 */

import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  auth,
  clearPolicies,
  createAgent,
  hashPassword,
  Permission,
  Role,
  RolePermission,
  User,
  UserRole,
} from '@assemora/auth'
import { clearRestorers, createLogger, type Logger, module, silentWriter } from '@assemora/core'
import { boolean, model, string, uuid } from '@assemora/data'
import { createMemoryAdapter } from '@assemora/database'
import { createTableSql } from '@assemora/database-postgres'
import { clearRouteRegistry, type HttpServer, type InjectedResponse } from '@assemora/http'
import { block, clearBlockRegistry, pages } from '@assemora/pages'
import { clearResourceRegistry, resource, text, toggle } from '@assemora/resources'
import { generateSdk } from '@assemora/sdk'
import { type AssemoraApplication, assemora } from 'assemora'
import { scaffold } from 'create-assemora'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'

/*
 * "The developer adds:" — SPEC.md §124, as it writes it.
 *
 * `.defaultRandom()` is the one addition. §124 writes `uuid().primary()`, which says
 * where the key is and not who fills it in; a project that means the database to
 * generate it says so, and `starters/bare` does.
 */
const Article = model('articles', {
  id: uuid().primary().defaultRandom(),
  title: string(),
  published: boolean().default(false),
})

const Articles = resource(Article, {
  title: text().required(),
  published: toggle(),
})

/** "The developer then defines:" — SPEC.md §124, verbatim. */
const Hero = block('hero', {
  title: text(),
  subtitle: text(),
})

const content = () => module('content').models(Article).resources(Articles)

const PASSWORD = 'correct horse battery staple'

const quiet: Logger = createLogger(silentWriter)

let built: AssemoraApplication
let server: HttpServer
/** Every application under test, so no Fastify instance outlives its test. */
let running: AssemoraApplication[] = []
/** What a signed-in browser holds. */
let jar: Record<string, string>
let agentToken: string

const cookiesOf = (response: InjectedResponse): Record<string, string> => {
  const header = response.headers['set-cookie']
  const all = Array.isArray(header) ? header : [String(header ?? '')]
  const found: Record<string, string> = {}

  for (const line of all) {
    const [pair] = String(line).split(';')
    const [name, ...rest] = (pair ?? '').split('=')

    if (name !== undefined && name !== '') found[name] = decodeURIComponent(rest.join('='))
  }

  return found
}

/** What a browser has to send with a mutation once it holds a session (SPEC.md §85). */
const asStudio = (): Record<string, string> => ({
  cookie: `assemora_session=${jar.assemora_session}; assemora_csrf=${jar.assemora_csrf}`,
  'x-csrf-token': jar.assemora_csrf ?? '',
})

/** What it sends when it is only reading: the session, and nothing else. */
const asReader = (): Record<string, string> => ({
  cookie: `assemora_session=${jar.assemora_session}`,
})

/** A command, sent the way Studio sends one (SPEC.md §60, ADR-0017). */
const send = (command: string, payload: Record<string, unknown>): Promise<InjectedResponse> =>
  server.inject({
    method: 'POST',
    url: `/api/commands/${command}`,
    payload,
    headers: asStudio(),
  })

/** A query, read the way Studio reads one (ADR-0018). */
const ask = (query: string, search = ''): Promise<InjectedResponse> =>
  server.inject({
    method: 'GET',
    url: `/api/queries/${query}${search === '' ? '' : `?${search}`}`,
    headers: asReader(),
  })

const rpc = (id: number, method: string, params: Record<string, unknown> = {}) => ({
  jsonrpc: '2.0',
  id,
  method,
  params,
})

/** One JSON-RPC message, over the endpoint an agent actually reaches. */
const overMcp = (id: number, method: string, params: Record<string, unknown> = {}) =>
  server.inject({
    method: 'POST',
    url: '/api/mcp',
    headers: { authorization: `Bearer ${agentToken}` },
    payload: rpc(id, method, params),
  })

/**
 * A tool call, exactly as a connected agent makes it.
 *
 * One JSON-RPC message per request, so the id only has to be unique within the
 * request it is answering.
 */
const call = async (name: string, args: unknown = {}): Promise<Record<string, unknown>> => {
  const response = await overMcp(3, 'tools/call', { name, arguments: args })
  const answered = response.json<{
    result: { isError?: boolean; content: { text: string }[] }
  }>().result

  if (answered.isError === true) throw new Error(answered.content[0]?.text ?? 'the tool failed')

  return JSON.parse(answered.content[0]?.text ?? '{}') as Record<string, unknown>
}

/**
 * The application half's setup, and the reason it is not a top-level `beforeEach`.
 *
 * The scaffold half asserts what `scaffold()` wrote and needs no application at all.
 * Booting one for it would tie the two halves together, so a broken application
 * would report the scaffolder as broken too.
 */
const startApplication = async (): Promise<void> => {
  clearPolicies()
  clearResourceRegistry()
  clearBlockRegistry()
  clearRouteRegistry()
  clearRestorers()

  built = assemora({
    database: createMemoryAdapter(),
    modules: [auth(), pages({ blocks: [Hero] }), content()],
    project: { name: 'demo', version: '1.0.0', description: 'A site with one page' },
    mcp: true,
    logger: quiet,
  })

  running.push(built)

  await built.boot()

  if (built.server === undefined) throw new Error('this application was built without an API')

  server = built.server

  // An administrator, the way an application seeds its first one.
  const admin = await User.create({
    email: 'ada@assemora.dev',
    name: 'Ada',
    passwordHash: await hashPassword(PASSWORD),
    active: true,
    version: 1,
  })
  const role = await Role.create({ name: 'administrator', label: 'Administrator', version: 1 })
  const everything = await Permission.create({ name: '*', description: null })

  await UserRole.create({ userId: admin.id, roleId: role.id })
  await RolePermission.create({ roleId: role.id, permissionId: everything.id })

  jar = cookiesOf(
    await server.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'ada@assemora.dev', password: PASSWORD },
    }),
  )

  const agent = await createAgent({
    name: 'content-agent',
    // A block edit is a page edit: `blocks.add` declares `pages` as its subject,
    // because that is the record it changes (ADR-0015, amended). So the permission
    // is `pages.add`, and `pages.update` is the second question the loaded row asks.
    // Named one by one rather than as `pages.*`: this agent may not delete a page.
    permissions: ['assemora.*', 'pages.read', 'pages.add', 'pages.update', 'changesets.propose'],
  })

  agentToken = agent.token

  await overMcp(1, 'initialize', {
    protocolVersion: '2025-06-18',
    capabilities: {},
    clientInfo: { name: 'v1-test', version: '1' },
  })
}

const stopApplications = async (): Promise<void> => {
  for (const application of running) await application.shutdown()

  running = []
}

/*
 * ---------------------------------------------------------------------------------
 * 1. `pnpm create assemora demo`
 * ---------------------------------------------------------------------------------
 */

/** SPEC.md §79, written as §79 writes it. A trailing `/` is a directory. */
const LAYOUT = [
  'src/models/',
  'src/resources/',
  'src/blocks/',
  'src/modules/',
  'app/blocks/',
  'database/migrations/',
  'assemora.config.ts',
  'package.json',
  'tsconfig.json',
] as const

const holds = (files: readonly string[], entry: string): boolean =>
  entry.endsWith('/') ? files.some((file) => file.startsWith(entry)) : files.includes(entry)

describe('pnpm create assemora demo (SPEC.md §124, §78, §79)', () => {
  let root: string
  let files: readonly string[]
  const read = (path: string): Promise<string> =>
    readFile(join(root, 'demo', ...path.split('/')), 'utf8')

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'assemora-v1-'))

    // The starter this repository ships, by path rather than by name, so the test
    // scaffolds the directory it names rather than whatever a resolver finds.
    const template = fileURLToPath(new URL('../../starters/bare', import.meta.url))

    const written = await scaffold({ name: 'demo', directory: join(root, 'demo'), template })

    files = written.files
  })

  afterAll(async () => {
    await rm(root, { recursive: true, force: true })
  })

  it('writes the layout SPEC.md §79 fixes', () => {
    for (const entry of LAYOUT) expect(holds(files, entry)).toBe(true)
  })

  it('gives the project its own name and a range a package manager can resolve', async () => {
    const manifest = JSON.parse(await read('package.json')) as {
      name: string
      dependencies: Record<string, string>
    }

    expect(manifest.name).toBe('demo')
    // Nothing outside this repository can resolve `workspace:*`, so a project that
    // kept one is a project that cannot be installed.
    expect(Object.values(manifest.dependencies).join(' ')).not.toContain('workspace:')
    expect(manifest.dependencies.assemora).toMatch(/^\^/)
  })

  it('restores the dotfiles npm will not carry, and leaves its own manifest behind', async () => {
    expect(files).toContain('.gitignore')
    expect(files).not.toContain('_gitignore')
    // `template.json` is the template talking about itself.
    expect(files).not.toContain('template.json')
    expect(await read('.gitignore')).toContain('node_modules/')
  })

  it('carries no feature marker into the source a developer opens', async () => {
    for (const file of files) {
      if (/\.(png|jpg|jpeg|gif|ico|woff2?)$/.test(file)) continue

      const source = await read(file)

      expect(source).not.toContain('assemora:if')
      expect(source).not.toContain('assemora:end')
    }
  })

  it('already carries the model, the resource and the block §124 goes on to add', async () => {
    // The declarations at the top of this file are not invented for the test: they
    // are the ones the scaffolded project starts life with.
    expect(await read('src/models/article.ts')).toMatch(/model\('articles'/)
    expect(await read('src/resources/articles.ts')).toMatch(/resource\(\s*Article/)
    expect(await read('src/blocks/hero.ts')).toMatch(/block\(\s*'hero'/)
  })
})

/*
 * ---------------------------------------------------------------------------------
 * 2 & 3. The developer adds a model and a resource, and after migration the system
 *        automatically provides eight things nobody configured.
 * ---------------------------------------------------------------------------------
 */

describe('after migration the system automatically provides (SPEC.md §124)', () => {
  beforeEach(startApplication)
  afterEach(stopApplications)

  it('a PostgreSQL table', () => {
    // The live half of this — the table, the rows, the transactions, the migration
    // runner — is `tests/integration/postgres.test.ts`, which needs a database and
    // skips itself without one. Asserted here is the step in between, which needs
    // none: what the migration runner would run for this model, from the model.
    const ddl = createTableSql(Article.descriptor)

    expect(ddl).toContain('create table')
    expect(ddl).toContain('"articles"')
    expect(ddl).toContain('"title"')
    expect(ddl).toContain('"published"')
  })

  it('Assemora Data querying', async () => {
    const created = await send('entries.create', {
      resource: 'articles',
      data: { title: 'Ada writes', published: true },
    })

    expect(created.statusCode).toBe(200)

    // The query builder, over the row the command wrote — one declaration, and both
    // ends of it agree without a second description of an article anywhere.
    const found = await Article.where('published', true).orderBy('title').get()

    expect(found.map((entry) => entry.title)).toEqual(['Ada writes'])
    expect(await Article.where('published', false).first()).toBeNull()
  })

  it('Studio CRUD', async () => {
    // Studio holds no list of resources and no hand-written form: it draws both from
    // what the registry describes, and it writes through the generic commands.
    const described = (await ask('entries.list', 'resource=articles')).json<{
      data: unknown[]
    }>()

    expect(described.data).toEqual([])

    const created = await send('entries.create', {
      resource: 'articles',
      data: { title: 'A draft', published: false },
    })

    expect(created.statusCode).toBe(200)

    const id = created.json<{ entry: { id: string } }>().entry.id

    await send('entries.update', { resource: 'articles', id, data: { published: true } })

    expect(
      (await ask('entries.get', `resource=articles&id=${id}`)).json<{ published: boolean }>()
        .published,
    ).toBe(true)

    await send('entries.delete', { resource: 'articles', id })

    expect((await ask('entries.list', 'resource=articles')).json<{ total: number }>().total).toBe(0)
  })

  it('REST CRUD', async () => {
    const created = await server.inject({
      method: 'POST',
      url: '/api/articles',
      payload: { title: 'Ada writes', published: false },
      headers: asStudio(),
    })

    expect(created.statusCode).toBe(201)

    const id = created.json<{ id: string }>().id

    const listed = await server.inject({
      method: 'GET',
      url: '/api/articles',
      headers: asReader(),
    })

    expect(listed.json<{ total: number }>().total).toBe(1)

    const patched = await server.inject({
      method: 'PATCH',
      url: `/api/articles/${id}`,
      payload: { published: true },
      headers: asStudio(),
    })

    expect(patched.statusCode).toBe(200)
    expect(patched.json<{ entry: { published: boolean } }>().entry.published).toBe(true)

    const removed = await server.inject({
      method: 'DELETE',
      url: `/api/articles/${id}`,
      headers: asStudio(),
    })

    expect(removed.statusCode).toBe(200)
    expect(
      (await server.inject({ method: 'GET', url: '/api/articles', headers: asReader() })).json<{
        total: number
      }>().total,
    ).toBe(0)
  })

  it('OpenAPI documentation', async () => {
    const document = await server.inject({ method: 'GET', url: '/api/openapi.json' })
    const described = document.json<{
      info: { title: string; version: string }
      paths: Record<string, unknown>
      components: { schemas: Record<string, { properties: Record<string, unknown> }> }
    }>()

    expect(document.statusCode).toBe(200)
    expect(described.info).toMatchObject({ title: 'demo', version: '1.0.0' })
    expect(Object.keys(described.paths)).toEqual(
      expect.arrayContaining(['/api/articles', '/api/articles/{id}']),
    )
    expect(Object.keys(described.components.schemas.articles?.properties ?? {})).toEqual(
      expect.arrayContaining(['title', 'published']),
    )
  })

  it('the API Explorer', async () => {
    // Signed in, like Studio: the snapshot is the registry itself, so the route asks
    // for a credential (SPEC.md §85).
    const explorer = await server.inject({
      method: 'GET',
      url: '/api/_introspection',
      headers: asReader(),
    })
    const snapshot =
      explorer.json<Record<string, { name: string; fields?: { name: string; kind: string }[] }[]>>()
    const names = (section: string) => (snapshot[section] ?? []).map((entry) => entry.name)

    expect(explorer.statusCode).toBe(200)
    expect(names('resources')).toContain('articles')
    expect(names('routes')).toEqual(expect.arrayContaining(['get /articles', 'post /articles']))
    expect(names('commands')).toContain('entries.create')
    expect(names('queries')).toContain('entries.list')

    // Enough to draw a list and a form without Studio knowing what an article is.
    const articles = (snapshot.resources ?? []).find((entry) => entry.name === 'articles')

    expect(articles?.fields).toEqual([
      expect.objectContaining({ name: 'title', kind: 'text' }),
      expect.objectContaining({ name: 'published', kind: 'boolean' }),
    ])
  })

  it('a TypeScript SDK', () => {
    // Generated from the very snapshot the API Explorer just served.
    const source = generateSdk(built.app.registry.describe())

    expect(source).toContain('readonly articles: ResourceClient<Articles>')
    // The record type, from the same declaration the form and the table came from.
    // `published` is optional because the resource does not require it.
    expect(source).toContain('readonly title: string')
    expect(source).toContain('readonly published?: boolean')
  })

  it('MCP introspection', async () => {
    const listed = await overMcp(2, 'tools/list')
    const tools = listed.json<{ result: { tools: { name: string }[] } }>().result.tools

    // Every tool is generated from the registry, so the resource declared above is
    // already one and nobody edited a list (ADR-0020).
    expect(tools.map((tool) => tool.name)).toEqual(
      expect.arrayContaining([
        'assemora.describe',
        'assemora.entries.create',
        'assemora.blocks.add',
        'assemora.pages.publish',
      ]),
    )

    const project = (await call('assemora.describe')) as {
      project: { name: string }
      capabilities: string[]
      resources: { name: string }[]
    }

    expect(project.project.name).toBe('demo')
    expect(project.capabilities).toEqual(expect.arrayContaining(['content', 'pages', 'blocks']))
    expect(project.resources.map((entry) => entry.name)).toContain('articles')
  })
})

/*
 * ---------------------------------------------------------------------------------
 * 4. The developer defines a block, and Studio assembles a page from blocks.
 * ---------------------------------------------------------------------------------
 */

describe('Studio lets a page be assembled from blocks (SPEC.md §124, §60)', () => {
  beforeEach(startApplication)
  afterEach(stopApplications)

  it('offers the block the developer declared, and places it', async () => {
    // A block reaches the palette by being listed in `pages({ blocks })`, and by
    // nothing else. Studio reads it from the registry like everything else it draws.
    // Signed in, like Studio: the snapshot is the registry itself, so the route asks
    // for a credential (SPEC.md §85).
    const explorer = await server.inject({
      method: 'GET',
      url: '/api/_introspection',
      headers: asReader(),
    })
    const blocks = explorer.json<{
      blocks: { name: string; fields: { name: string }[] }[]
    }>().blocks

    expect(blocks).toEqual([
      expect.objectContaining({
        name: 'hero',
        fields: [
          expect.objectContaining({ name: 'title' }),
          expect.objectContaining({ name: 'subtitle' }),
        ],
      }),
    ])

    const page = (await send('pages.create', { slug: 'home', title: 'Home' })).json<{
      id: string
      version: number
    }>()

    const added = await send('blocks.add', {
      id: page.id,
      expectedVersion: page.version,
      type: 'hero',
      props: { title: 'Welcome', subtitle: 'A site with one page' },
    })

    expect(added.statusCode).toBe(200)

    // Every tree command answers with the tree it produced, so the canvas redraws
    // without a second read (ADR-0018).
    expect(
      added.json<{ tree: { blocks: { type: string; props: { title: string } }[] } }>().tree.blocks,
    ).toEqual([
      expect.objectContaining({
        type: 'hero',
        props: { title: 'Welcome', subtitle: 'A site with one page' },
      }),
    ])

    const published = await send('pages.publish', {
      id: page.id,
      expectedVersion: added.json<{ version: number }>().version,
    })

    expect(published.statusCode).toBe(200)

    // A page is a block tree, never an HTML blob (SPEC.md §125.14).
    const live = (await ask('pages.get', 'slug=home')).json<{
      status: string
      tree: { blocks: { type: string }[] }
    }>()

    expect(live.status).toBe('published')
    expect(live.tree.blocks.map((entry) => entry.type)).toEqual(['hero'])
  })
})

/*
 * ---------------------------------------------------------------------------------
 * 5 & 6. An agent connects over MCP; every change is recorded and can be undone.
 * ---------------------------------------------------------------------------------
 */

describe('an AI agent connects over MCP (SPEC.md §124, §75)', () => {
  beforeEach(startApplication)
  afterEach(stopApplications)

  /** The homepage the agent finds, put there by a person, the way it would be. */
  const homepage = async (): Promise<{ id: string; version: number }> => {
    const page = (await send('pages.create', { slug: 'home', title: 'Home' })).json<{
      id: string
      version: number
    }>()

    const added = await send('blocks.add', {
      id: page.id,
      expectedVersion: page.version,
      type: 'hero',
      props: { title: 'Welcome', subtitle: 'A site with one page' },
    })

    return { id: page.id, version: added.json<{ version: number }>().version }
  }

  it('describes, reads, dry-runs, shows a diff, and a person applies and publishes', async () => {
    const home = await homepage()

    // → describe
    const project = (await call('assemora.describe')) as {
      project: { name: string }
      blocks: { name: string }[]
      commands: { name: string }[]
    }

    expect(project.project.name).toBe('demo')
    expect(project.blocks.map((entry) => entry.name)).toEqual(['hero'])
    expect(project.commands.map((entry) => entry.name)).toContain('pages.publish')

    // → get page
    const page = (await call('assemora.pages.get', { slug: 'home', mode: 'draft' })) as {
      id: string
      tree: { blocks: { id: string; type: string }[] }
    }

    expect(page.id).toBe(home.id)
    expect(page.tree.blocks.map((entry) => entry.type)).toEqual(['hero'])

    // → add block dry-run: a mutating tool call previews the command and proposes it
    //   (SPEC.md §75, ADR-0020). Nothing has happened yet.
    const proposal = (await call('assemora.blocks.add', {
      id: page.id,
      type: 'hero',
      props: { title: 'And another thing', subtitle: 'Proposed by an agent' },
    })) as { id: string; status: string; changes: { summary: string }[] }

    expect(proposal.status).toBe('pending')

    // → show diff — one line a person can read, not two block trees
    expect(proposal.changes.map((change) => change.summary)).toEqual(['hero — new block'])

    // → and production has not moved
    expect(
      (await ask('pages.get', 'slug=home&mode=draft')).json<{
        tree: { blocks: unknown[] }
      }>().tree.blocks,
    ).toHaveLength(1)

    // → apply, which is a person's act, in the person's own name
    const applied = await send('changesets.apply', { id: proposal.id })

    expect(applied.statusCode).toBe(200)
    expect(applied.json<{ status: string }>().status).toBe('applied')

    const draft = (await ask('pages.get', 'slug=home&mode=draft')).json<{
      version: number
      tree: { blocks: { props: { title: string } }[] }
    }>()

    expect(draft.tree.blocks.map((entry) => entry.props.title)).toEqual([
      'Welcome',
      'And another thing',
    ])

    // → publish
    const published = await send('pages.publish', {
      id: page.id,
      expectedVersion: draft.version,
    })

    expect(published.statusCode).toBe(200)

    const live = (await ask('pages.get', 'slug=home')).json<{
      status: string
      tree: { blocks: { props: { title: string } }[] }
    }>()

    expect(live.status).toBe('published')
    expect(live.tree.blocks.map((entry) => entry.props.title)).toEqual([
      'Welcome',
      'And another thing',
    ])
  })

  it('records every change in the revision history and the audit log, and undoes it', async () => {
    const home = await homepage()

    const page = (await call('assemora.pages.get', { slug: 'home', mode: 'draft' })) as {
      id: string
    }

    const proposal = (await call('assemora.blocks.add', {
      id: page.id,
      type: 'hero',
      props: { title: 'And another thing', subtitle: 'Proposed by an agent' },
    })) as { id: string }

    await send('changesets.apply', { id: proposal.id })
    await send('pages.publish', { id: home.id })

    // revision history — newest first, and the agent's write is a revision of its
    // own rather than something folded into the person's apply.
    const history = (await ask('revisions.list', `entityType=pages&entityId=${home.id}`)).json<{
      data: { id: string; command: string }[]
    }>()

    expect(history.data.map((entry) => entry.command)).toEqual([
      'pages.publish',
      'blocks.add',
      'blocks.add',
      'pages.create',
    ])

    // audit log — including who asked and from where, which a revision does not say.
    const log = (await ask('audit.list', 'perPage=100')).json<{
      data: { action: string; actorType: string | null; source: string }[]
    }>()

    const proposed = log.data.find((entry) => entry.action === 'changesets.propose')
    const applied = log.data.find((entry) => entry.action === 'changesets.apply')

    expect(proposed).toMatchObject({ actorType: 'agent', source: 'mcp' })
    expect(applied).toMatchObject({ actorType: 'user', source: 'rest' })
    expect(log.data.map((entry) => entry.action)).toEqual(
      expect.arrayContaining(['pages.create', 'blocks.add', 'pages.publish', 'auth.login']),
    )

    // and can be undone — the stack is derived from the history, not held in a tab.
    const undone = await send('revisions.undo', { entityType: 'pages', entityId: home.id })

    expect(undone.statusCode).toBe(200)

    await send('revisions.undo', { entityType: 'pages', entityId: home.id })

    expect(
      (await ask('pages.get', 'slug=home&mode=draft'))
        .json<{
          tree: { blocks: { props: { title: string } }[] }
        }>()
        .tree.blocks.map((entry) => entry.props.title),
    ).toEqual(['Welcome'])
  })
})
