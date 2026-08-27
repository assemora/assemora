/**
 * Slow query logging (SPEC.md §88).
 *
 * The claims under test are the two that matter: a query that was slow is written
 * down with enough shape to act on, and nothing a caller passed in is ever written
 * down at all. The second is asserted against the whole serialized record rather than
 * against the fields this file happens to know about — a value that leaks through a
 * field added later is exactly the failure this is here to catch.
 */
import { ConfigurationError, createLogger, type LogRecord } from '@assemora/core'
import {
  createMemoryAdapter,
  type DatabaseAdapter,
  type DatabaseContext,
  type MemoryAdapter,
  type QueryAst,
} from '@assemora/database'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { boolean, json, string, timestamp, uuid } from './columns.js'
import { model } from './model.js'
import { belongsTo, hasMany } from './relations.js'
import { currentAdapter, useAdapter } from './runtime.js'
import { clearSlowQueryLog, useSlowQueryLog } from './slow-queries.js'

const Reader = model('readers', {
  id: uuid().primary().defaultRandom(),
  email: string(),
  tokenDigest: string().hidden(),
  active: boolean().default(true),
  createdAt: timestamp().created(),
  articles: hasMany(() => Article, { foreignKey: 'readerId' }),
})

const Article = model('articles', {
  id: uuid().primary().defaultRandom(),
  readerId: uuid(),
  title: string(),
  metadata: json<{ readonly importedFrom?: string }>(),
  reader: belongsTo(() => Reader),
})

const EMAIL = 'ada@assemora.dev'
const DIGEST = '5f4dcc3b5aa765d61d8327deb882cf99'

let adapter: MemoryAdapter
let written: LogRecord[]

const logger = createLogger((record) => {
  written.push(record)
})

/** The one line a slow query writes, or a failure naming what was written instead. */
const line = (): LogRecord => {
  const slow = written.filter(
    (record) => record.message === 'A query was slower than the threshold',
  )

  if (slow.length !== 1) {
    throw new Error(`expected one slow query line, got ${slow.length}: ${JSON.stringify(written)}`)
  }

  return slow[0] as LogRecord
}

/** An adapter that takes a known amount of real time, so the timing is what is tested. */
const slowedBy = (inner: MemoryAdapter, ms: number): DatabaseAdapter => ({
  execute<T>(query: QueryAst, context: DatabaseContext): Promise<T> {
    return new Promise((resolve) => setTimeout(resolve, ms)).then(() =>
      inner.execute<T>(query, context),
    )
  },
  transaction: (callback) => inner.transaction(callback),
  introspect: () => inner.introspect(),
})

beforeEach(() => {
  adapter = createMemoryAdapter({
    readers: [
      { id: 'r1', email: EMAIL, tokenDigest: DIGEST, active: true, createdAt: new Date(0) },
      {
        id: 'r2',
        email: 'grace@assemora.dev',
        tokenDigest: 'x',
        active: false,
        createdAt: new Date(0),
      },
    ],
    articles: [{ id: 'a1', readerId: 'r1', title: 'Notes on the analytical engine' }],
  })

  useAdapter(adapter)
  written = []
})

afterEach(() => {
  clearSlowQueryLog()
})

describe('the threshold decides what is written down', () => {
  it('writes nothing at all until a logger is registered', async () => {
    await Reader.where('active', true).get()

    expect(written).toEqual([])
  })

  it('says nothing about a query that beat the threshold', async () => {
    useSlowQueryLog(logger)

    await Reader.where('active', true).get()
    await Reader.find('r1')
    await Reader.where('active', true).count()

    // The default is 200ms, and an in-memory query is microseconds. An application
    // that configures nothing has a log that stays quiet while it is healthy.
    expect(written).toEqual([])
  })

  it('writes down a query that took longer than the threshold', async () => {
    useAdapter(slowedBy(adapter, 25))
    useSlowQueryLog(logger, { slowerThanMs: 10 })

    await Reader.where('active', true).get()

    expect(line().message).toBe('A query was slower than the threshold')
    expect(line().model).toBe('readers')
    expect(line().operation).toBe('select')
    expect(line().durationMs as number).toBeGreaterThanOrEqual(10)
    expect(line().level).toBe('warn')
  })

  it('refuses a threshold that is not a number of milliseconds', () => {
    expect(() => useSlowQueryLog(logger, { slowerThanMs: -1 })).toThrow(ConfigurationError)
    expect(() => useSlowQueryLog(logger, { slowerThanMs: Number.NaN })).toThrow(/not negative/)
  })

  it('logs every query at a threshold of zero', async () => {
    useSlowQueryLog(logger, { slowerThanMs: 0 })

    await Reader.where('active', true).get()

    expect(written).toHaveLength(1)
  })
})

describe('the shape is written down and the values are not', () => {
  beforeEach(() => {
    useSlowQueryLog(logger, { slowerThanMs: 0 })
  })

  it('never writes down what a where was looking for', async () => {
    await Reader.where('email', EMAIL).where('tokenDigest', DIGEST).first()

    const serialized = JSON.stringify(line())

    expect(serialized).not.toContain(EMAIL)
    expect(serialized).not.toContain(DIGEST)
    expect(line().filters).toEqual(['email =', 'tokenDigest ='])
  })

  it('names the columns and the operators, which is what an index is chosen from', async () => {
    await Reader.where('active', true)
      .where('createdAt', '>', new Date(0))
      .whereIn('id', ['r1', 'r2'])
      .get()

    expect(line().filters).toEqual(['active =', 'createdAt >', 'id in'])
  })

  it('flattens a nested group without writing what it compared', async () => {
    await Reader.where((query) => query.where('email', EMAIL).orWhere('id', 'r1')).get()

    expect(line().filters).toEqual(['email =', 'id ='])
    expect(JSON.stringify(line())).not.toContain(EMAIL)
  })

  it('says a JSON condition happened without naming the key inside the document', async () => {
    // A path names a key in a document nothing has a schema for, so it is treated as
    // something the caller passed rather than as part of the shape.
    await Article.whereJson('metadata', 'importedFrom', EMAIL).get()

    expect(line().filters).toEqual(['metadata json equals'])
    expect(JSON.stringify(line())).not.toContain('importedFrom')
    expect(JSON.stringify(line())).not.toContain(EMAIL)
  })

  it('names the relations a query loaded, which is what an N+1 looks like', async () => {
    await Reader.with('articles').get()

    expect(line().relations).toEqual(['articles'])
  })

  it('counts the rows that came back', async () => {
    await Reader.where('active', true).get()

    expect(line().rows).toBe(1)
  })

  it('does not report a count as a row count, because it is an answer', async () => {
    await Reader.where('active', true).count()

    expect(line().operation).toBe('count')
    expect(line().rows).toBeUndefined()
  })

  it('times a write, so no path to the adapter is left unmeasured', async () => {
    await Reader.create({ email: 'hedy@assemora.dev', tokenDigest: 'y' })

    expect(line().operation).toBe('insert')
    expect(JSON.stringify(line())).not.toContain('hedy@assemora.dev')
  })

  it('times a query that failed, because that is the one worth knowing about', async () => {
    useAdapter({
      execute: () => Promise.reject(new Error('the connection went away')),
      transaction: (callback) => callback(),
      introspect: () => adapter.introspect(),
    })

    await expect(Reader.where('active', true).get()).rejects.toThrow('the connection went away')

    expect(line().model).toBe('readers')
    expect(line().rows).toBeUndefined()
  })
})

describe('the timing is a function, not a wrapper around the adapter', () => {
  /**
   * `assemora db:migrate` reads `currentAdapter()` and asks whether it has `raw` — the
   * PostgreSQL-only method the CLI recognises it by (packages/cli/src/commands/db.ts).
   * An adapter wrapped for timing would either lose that method or have to forward it,
   * and forwarding it would be a second definition of the adapter contract.
   */
  it('hands the CLI the adapter the application registered, whole', () => {
    const postgresish = {
      ...adapter,
      raw: () => Promise.resolve([]),
      applySchema: () => Promise.resolve(),
    }

    useAdapter(postgresish)
    useSlowQueryLog(logger, { slowerThanMs: 0 })

    expect(currentAdapter()).toBe(postgresish)
    expect(typeof (currentAdapter() as { raw?: unknown }).raw).toBe('function')
    expect(typeof (currentAdapter() as { applySchema?: unknown }).applySchema).toBe('function')
  })
})
