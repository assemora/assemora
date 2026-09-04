/**
 * Every generated endpoint documents what it answers with (#16).
 *
 * A command and a query used to declare an input and nothing else, so the endpoints
 * generated from them reached OpenAPI and the SDK with an undocumented response — a
 * caller could read what to send and not what would come back. `output` closes that,
 * and this file is what keeps it closed: the application below carries every
 * first-party module, and a command or query added without an output would appear
 * here as an operation with no `200` schema.
 *
 * Read from the published document and the generated client rather than from the
 * registry, because those are the two things a caller holds.
 */
import { auth } from '@assemora/auth'
import { module } from '@assemora/core'
import { model, string, useAdapter, uuid } from '@assemora/data'
import { createMemoryAdapter } from '@assemora/database'
import { clearStorage } from '@assemora/media'
import { block, clearBlockRegistry, pages } from '@assemora/pages'
import { clearResourceRegistry, resource, text } from '@assemora/resources'
import { generateSdk } from '@assemora/sdk'
import { type AssemoraApplication, assemora } from 'assemora'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { realInfrastructure } from './budget.ts'

realInfrastructure()

const Note = model('notes', {
  id: uuid().primary().defaultRandom(),
  title: string(),
})

const Notes = resource(Note as never, { title: text().required() })
const Hero = block('hero', { title: text().required() }, { label: 'Hero' })

type Operation = {
  readonly responses?: Record<string, { content?: Record<string, { schema?: unknown }> }>
}

type Document = {
  readonly paths: Record<string, Record<string, Operation>>
}

let app: AssemoraApplication
let document: Document

const generated = (path: string): boolean =>
  path.startsWith('/commands/') || path.startsWith('/queries/')

beforeAll(async () => {
  clearBlockRegistry()
  clearResourceRegistry()
  clearStorage()
  useAdapter(createMemoryAdapter())

  app = assemora({
    database: createMemoryAdapter(),
    modules: [auth(), pages({ blocks: [Hero] }), module('notes').models(Note).resources(Notes)],
    project: { name: 'documented', version: '0.0.0' },
    mcp: true,
    changeSets: true,
  })

  await app.boot()

  if (app.server === undefined) throw new Error('this application was built without an API')

  const response = await app.server.inject({ method: 'GET', url: '/api/openapi.json' })

  document = response.json<Document>()
}, 60_000)

afterAll(async () => {
  await app.shutdown()
})

describe('every generated endpoint documents its response (#16)', () => {
  it('finds the generated endpoints, so an empty pass could not be a green one', () => {
    const paths = Object.keys(document.paths).filter(generated)

    expect(paths.length).toBeGreaterThan(40)
    expect(paths).toEqual(expect.arrayContaining(['/commands/pages.publish', '/queries/pages.get']))
  })

  it('leaves no command or query endpoint without a 200 schema in /api/openapi.json', () => {
    const undocumented = Object.entries(document.paths)
      .filter(([path]) => generated(path))
      .flatMap(([path, operations]) =>
        Object.entries(operations)
          .filter(([, operation]) => {
            const schema = operation.responses?.['200']?.content?.['application/json']?.schema

            return schema === undefined
          })
          .map(([method]) => `${method} ${path}`),
      )

    expect(undocumented).toEqual([])
  })

  it('types every one of those methods in the generated SDK, but the two that are open', () => {
    const client = generateSdk(app.app.registry.describe())
    const untyped = client
      .split('\n')
      .filter((line) => /^\s+(postCommands|getQueries)\w*\(/.test(line))
      .filter((line) => line.includes('Promise<unknown>'))
      .map((line) => line.trim().replace(/\(.*$/, ''))

    // Two answers are open by their nature rather than by omission: an entry of
    // whichever resource was asked for, and the descriptor of whichever resource was
    // named. Each is documented as any JSON, which is the truth. A third name here is
    // a command or query that described nothing, and this is where it shows.
    expect(untyped).toEqual(['getQueriesEntriesGet', 'getQueriesAssemoraResourcesDescribe'])
  })
})
