/**
 * What Studio is allowed to rely on (SPEC.md §60, §115, §123).
 *
 * Studio is a client, so everything it can do has to exist in the application layer
 * first. These are the contracts it is built against: if one breaks, the interface
 * breaks with it, and a test says so before anybody clicks anything.
 */
import { auth, clearPolicies, policies } from '@assemora/auth'
import {
  clearRestorers,
  createApplication,
  createLogger,
  module,
  silentWriter,
} from '@assemora/core'
import { dataTransactions, model, string, useAdapter, uuid } from '@assemora/data'
import { createMemoryAdapter } from '@assemora/database'
import { createHttpServer, type HttpServer } from '@assemora/http'
import { media } from '@assemora/media'
import { introspectionRoute } from '@assemora/openapi'
import { block, clearBlockRegistry, pages } from '@assemora/pages'
import { clearResourceRegistry, resource, select, text } from '@assemora/resources'
import { revisions, revisionsModule } from '@assemora/revisions'
import { beforeEach, describe, expect, it } from 'vitest'

const Note = model('notes', {
  id: uuid().primary().defaultRandom(),
  title: string(),
  status: string().default('draft'),
})

const Notes = resource(Note as never, {
  title: text().required().searchable(),
  status: select('draft', 'published').required().filterable(),
})

const Hero = block('hero', { title: text().required() }, { label: 'Hero' })

let app: ReturnType<typeof createApplication>
let server: HttpServer

beforeEach(async () => {
  clearPolicies()
  clearBlockRegistry()
  clearResourceRegistry()
  clearRestorers()
  useAdapter(createMemoryAdapter())

  app = createApplication({
    modules: [
      auth(),
      pages({ blocks: [Hero] }),
      media(),
      revisionsModule(),
      // A module declaring one resource, to prove nothing about it is hand-written.
      module('notes')
        .models(Note as never)
        .resources(Notes as never),
    ],
    authorization: policies(),
    transactions: dataTransactions(),
    revisions: revisions(),
    logger: createLogger(silentWriter),
  })

  await app.boot()

  server = createHttpServer({
    registry: app.registry,
    commands: app.commands,
    queries: app.queries,
    logger: app.logger,
  })

  // Open, because this server resolves no actor: the claim under test is what Studio
  // is told, not who may ask. Who may ask is asserted in `@assemora/openapi`.
  server
    .mountCommands()
    .mountQueries()
    .mountResources()
    .mount(introspectionRoute(app.registry, { public: true }))

  await server.ready()
})

/** SPEC.md §60, verbatim, minus the two the editor performs without a command. */
const BUILDER_OPERATIONS = {
  'add block': 'blocks.add',
  'remove block': 'blocks.remove',
  'duplicate block': 'blocks.duplicate',
  'move block': 'blocks.move',
  'nest block': 'blocks.move',
  'edit props': 'blocks.update',
  'hide block': 'blocks.hide',
  'change block variant': 'blocks.update',
  undo: 'revisions.undo',
  redo: 'revisions.redo',
  publish: 'pages.publish',
} as const

describe('every builder operation maps to a command (SPEC.md §60)', () => {
  for (const [operation, command] of Object.entries(BUILDER_OPERATIONS)) {
    it(`"${operation}" is ${command}`, () => {
      expect(app.commands.has(command)).toBe(true)
    })
  }

  it('publishes each of them as an endpoint, so an agent reaches the same one', () => {
    for (const command of new Set(Object.values(BUILDER_OPERATIONS))) {
      expect(app.registry.find('routes', `post /commands/${command}`)).toBeDefined()
    }
  })
})

describe('every screen has a read path (SPEC.md §115)', () => {
  const READS = [
    'pages.list',
    'pages.get',
    'revisions.list',
    'revisions.get',
    'revisions.compare',
    'media.list',
    'auth.users.list',
    'auth.roles.list',
    'auth.permissions.list',
    'auth.tokens.list',
    'auth.agents.list',
    'entries.list',
    'entries.get',
  ]

  for (const query of READS) {
    it(`${query} is a query, and a GET endpoint`, () => {
      expect(app.queries.has(query)).toBe(true)
      expect(app.registry.find('routes', `get /queries/${query}`)).toBeDefined()
    })
  }
})

describe('Studio is told what exists rather than told what to draw (SPEC.md §42)', () => {
  it('describes a resource well enough to render a list and a form', async () => {
    const described = await server.inject({ method: 'GET', url: '/api/_introspection' })
    const introspection = described.json<{
      resources: { name: string; fields: { name: string; kind: string }[] }[]
      blocks: { name: string; label: string; acceptsChildren: boolean }[]
    }>()

    const notes = introspection.resources.find((entry) => entry.name === 'notes')

    expect(notes?.fields.map((field) => field.kind)).toEqual(['text', 'select'])
  })

  it('describes a block well enough to render a palette entry and a properties panel', async () => {
    const described = await server.inject({ method: 'GET', url: '/api/_introspection' })
    const introspection = described.json<{
      blocks: {
        name: string
        label: string
        acceptsChildren: boolean
        allowedChildren: string[]
        fields: { name: string; required: boolean }[]
      }[]
    }>()

    // The palette keys on `name`; a mirror that called it `type` would render nothing.
    expect(introspection.blocks).toEqual([
      expect.objectContaining({
        name: 'hero',
        label: 'Hero',
        acceptsChildren: false,
        allowedChildren: [],
        fields: [expect.objectContaining({ name: 'title', required: true })],
      }),
    ])
  })
})
