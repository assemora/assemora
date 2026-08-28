/**
 * Booting against a schema that is not applied yet (SPEC.md §37, ADR-0021).
 *
 * `assemora db:generate` imports the project's application and boots it, because the
 * registry it writes a migration from is the real one rather than a parse of the
 * source. The migration it then writes is the one that creates this package's tables —
 * so a boot hook that insisted on reading them made the first migration of every
 * project registering `collections()` impossible to generate. Two commands reproduced
 * it: `createdb`, then `assemora db:generate initial`, which answered
 * `error: The database rejected the operation` and wrote nothing.
 *
 * This is the mechanism at its own level. The starter proves the symptom is gone; what
 * is below proves the boundary, which is the half a starter cannot show: exactly one
 * failure is survivable, and every other way a database says no still stops the boot.
 */
import {
  type Application,
  AssemoraError,
  clearRestorers,
  createApplication,
  createLogger,
  type LogRecord,
  permitAll,
} from '@assemora/core'
import { dataTransactions, useAdapter } from '@assemora/data'
import {
  createMemoryAdapter,
  type DatabaseAdapter,
  isSchemaNotApplied,
  schemaNotApplied,
} from '@assemora/database'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { collections } from './collection-module.js'
import { clearCollections, loadCollections } from './collections.js'
import { clearResourceRegistry, registeredResources } from './registry.js'
import { ResourceDefinitionModel } from './system-models.js'
import './module.js'

const DEFINITIONS = ResourceDefinitionModel.table

let logs: LogRecord[]

/** A database that answers everything except one table, which it refuses `failure` for. */
const refusing = (table: string, failure: () => unknown): DatabaseAdapter => {
  const base = createMemoryAdapter()

  return {
    execute: <T>(
      query: Parameters<DatabaseAdapter['execute']>[0],
      context: Parameters<DatabaseAdapter['execute']>[1],
    ) => (query.model === table ? Promise.reject(failure()) : base.execute<T>(query, context)),
    transaction: (callback) => base.transaction(callback),
    introspect: () => base.introspect(),
  }
}

const build = async (): Promise<Application> => {
  const app = createApplication({
    modules: [collections()],
    authorization: permitAll(),
    transactions: dataTransactions(),
    logger: createLogger((record) => {
      logs.push(record)
    }),
  })

  return app.boot()
}

beforeEach(() => {
  clearResourceRegistry()
  clearCollections()
  clearRestorers()
  useAdapter(createMemoryAdapter())
  logs = []
})

afterEach(() => {
  clearCollections()
})

describe('a table that has not been created yet', () => {
  it('lets the application boot, which is what db:generate needs', async () => {
    useAdapter(refusing(DEFINITIONS, () => schemaNotApplied(DEFINITIONS)))

    // The regression: this rejected, and `assemora db:generate initial` died on it
    // before writing the migration that creates the very table it could not read.
    const app = await build()

    expect(app.registry.section('resources')).toEqual([])
    expect(registeredResources()).toEqual([])
  })

  it('says so, and names the command that fixes it', async () => {
    useAdapter(refusing(DEFINITIONS, () => schemaNotApplied(DEFINITIONS)))

    await build()

    const warning = logs.find((record) => record.level === 'warn')

    // Not quiet, in either caller. During `db:generate` it explains why the collection
    // list is empty; during `assemora start` it is the whole diagnosis.
    expect(warning?.message).toContain('their table does not exist yet')
    expect(warning).toMatchObject({ table: DEFINITIONS, remedy: 'assemora db:migrate' })
  })

  it('reports that this module did not start, so readiness can act on it', async () => {
    useAdapter(refusing(DEFINITIONS, () => schemaNotApplied(DEFINITIONS)))

    // Both boots register nothing. Only one of them is a working application, and a
    // caller that cannot tell them apart cannot refuse to serve the broken one — which
    // is exactly what `/api/ready` does with this (SPEC.md §88). The reason and the
    // remedy travel with it, because a probe that only says 503 for ever is owed one.
    expect((await build()).notStarted).toEqual([
      {
        module: 'collections',
        reason: `${DEFINITIONS} does not exist, so no collection this application has stored was registered.`,
        remedy: 'Run assemora db:migrate.',
      },
    ])

    clearCollections()
    clearResourceRegistry()
    useAdapter(createMemoryAdapter())

    expect((await build()).notStarted).toEqual([])
  })

  it('picks the collections up once the migration has run', async () => {
    const adapter = createMemoryAdapter()

    useAdapter(refusing(DEFINITIONS, () => schemaNotApplied(DEFINITIONS)))
    const registry = (await build()).registry

    // What a restart after `assemora db:migrate` does: the same loader, the same
    // registry, a database that now has the table.
    adapter.seed(DEFINITIONS, [
      {
        id: 'a1',
        name: 'notes',
        label: 'Notes',
        schema: { name: 'notes', label: 'Notes', fields: [{ name: 'body', kind: 'text' }] },
        settings: {},
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ])
    useAdapter(adapter)

    expect(
      await loadCollections(
        registry,
        createLogger(() => {}),
      ),
    ).toMatchObject({
      loaded: ['notes'],
      pending: false,
    })
  })
})

describe('every other way a database says no', () => {
  /**
   * The list the fix must not swallow. Each of these is an application that cannot
   * work, and each would otherwise become the same silent empty boot as a schema
   * waiting to be migrated — a running server that has quietly lost its content.
   */
  const fatal: [string, () => unknown][] = [
    [
      'a connection nothing answered',
      () =>
        new AssemoraError('DATABASE_UNREACHABLE', 'The database did not answer.', { status: 503 }),
    ],
    [
      'a database that is not there',
      () => new AssemoraError('DATABASE_NOT_FOUND', 'No such database.', { status: 503 }),
    ],
    [
      'credentials the server refused',
      () => new AssemoraError('DATABASE_UNAUTHORIZED', 'Refused.', { status: 503 }),
    ],
    [
      'a privilege never granted',
      () => new AssemoraError('DATABASE_FORBIDDEN', 'Not allowed.', { status: 503 }),
    ],
    [
      'anything an adapter did not translate at all',
      () => new Error('relation "assemora_resource_definitions" does not exist'),
    ],
  ]

  for (const [what, failure] of fatal) {
    it(`stops the boot on ${what}`, async () => {
      useAdapter(refusing(DEFINITIONS, failure))

      await expect(build()).rejects.toThrow()

      // And never mistaken for the one tolerated state on the way out: the boot that
      // survives a missing table is the boot that names the migration.
      expect(logs.some((record) => record.remedy === 'assemora db:migrate')).toBe(false)
    })
  }

  it('recognises only what the adapter contract calls a missing table', () => {
    // The loader compares the code as a string, because the dependency graph keeps
    // `@assemora/database` out of this package's reach (SPEC.md §8). This is what pins
    // the two ends together: the real constructor, through the real loader, above.
    expect(isSchemaNotApplied(schemaNotApplied(DEFINITIONS))).toBe(true)
    for (const [, failure] of fatal) expect(isSchemaNotApplied(failure())).toBe(false)
  })
})
