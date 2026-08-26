/**
 * The PostgreSQL adapter (SPEC.md §32).
 *
 * It implements the contract of `@assemora/database` and keeps Drizzle and `pg`
 * entirely inside this package.
 */
import { AsyncLocalStorage } from 'node:async_hooks'

import { AssemoraError } from '@assemora/core'
import type {
  ColumnDescriptor,
  DatabaseAdapter,
  DatabaseContext,
  DatabaseSchema,
  QueryAst,
  RelationDescriptor,
  RelationLoad,
  TableDescriptor,
} from '@assemora/database'
import { count, inArray } from 'drizzle-orm'
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres'
import type { PgTable } from 'drizzle-orm/pg-core'
import { Pool, type PoolConfig } from 'pg'

import { isDriverError, toAssemoraError } from './errors.js'
import { columnsOf, drizzleTable, toColumnKind, toFieldName } from './schema.js'
import { buildOrder, buildWhere } from './translate.js'

type Executor = NodePgDatabase<Record<string, never>>

/** Connection settings, described without naming the driver (SPEC.md §10). */
export type PostgresAdapterOptions = {
  readonly url?: string
  /**
   * The schema every statement resolves in. Pinned on the connection, so a stray
   * `search_path` in the role or the database cannot silently point the same
   * unqualified table name somewhere else.
   */
  readonly schema?: string
  readonly pool?: {
    readonly max?: number
    readonly idleTimeoutMs?: number
    readonly connectionTimeoutMs?: number
  }
}

export type RawResult = {
  readonly rows: readonly Record<string, unknown>[]
  readonly rowCount: number
}

export type PostgresAdapter = DatabaseAdapter & {
  /**
   * Advanced: runs a statement exactly as written. Ordinary work goes through the
   * Query AST; this exists for DDL and for the rare thing the AST cannot express
   * (SPEC.md §10).
   */
  raw(statement: string, params?: readonly unknown[]): Promise<RawResult>
  /** Counters the tests read; not part of ordinary use (SPEC.md §88). */
  readonly diagnostics: {
    statementCount(): number
    /** The most recent failure the pool reported outside a query, if any. */
    lastPoolError(): AssemoraError | undefined
    reset(): void
  }
  close(): Promise<void>
}

/**
 * The pool a given adapter owns.
 *
 * Kept in a side table rather than on the adapter type, so no `pg` type appears in
 * a public signature at all (SPEC.md §10, §125.1). Only this package may read it.
 */
const pools = new WeakMap<DatabaseAdapter, Pool>()

export const poolOf = (adapter: DatabaseAdapter): Pool => {
  const pool = pools.get(adapter)

  if (pool === undefined) {
    throw new AssemoraError('CONFIGURATION_ERROR', 'This adapter owns no connection pool', {
      status: 500,
    })
  }

  return pool
}

type Row = Record<string, unknown>

/**
 * The PostgreSQL adapter, named as SPEC.md §9 spells it in an application config:
 *
 * ```ts
 * export default assemora({ database: postgres() })
 * ```
 */
export const postgres = (options: PostgresAdapterOptions = {}): PostgresAdapter => {
  const schema = options.schema ?? 'public'

  const poolConfig: PoolConfig = {
    options: `-c search_path=${schema}`,
    ...(options.url === undefined ? {} : { connectionString: options.url }),
    ...(options.pool?.max === undefined ? {} : { max: options.pool.max }),
    ...(options.pool?.idleTimeoutMs === undefined
      ? {}
      : { idleTimeoutMillis: options.pool.idleTimeoutMs }),
    ...(options.pool?.connectionTimeoutMs === undefined
      ? {}
      : { connectionTimeoutMillis: options.pool.connectionTimeoutMs }),
  }

  const pool = new Pool(poolConfig)
  let lastPoolError: AssemoraError | undefined

  // An idle connection dropped by the server emits an error on the pool. With no
  // listener, Node treats it as unhandled and terminates the process — a database
  // restart would take the application down with it. It is recorded instead, where
  // observability can see it (SPEC.md §88).
  pool.on('error', (error: unknown) => {
    lastPoolError = toAssemoraError(error)
  })

  const root = drizzle(pool) as Executor
  const scoped = new AsyncLocalStorage<Executor>()
  let statements = 0

  const executor = (): Executor => {
    statements += 1
    return scoped.getStore() ?? root
  }

  const relationOf = (table: TableDescriptor, name: string): RelationDescriptor => {
    const relation = table.relations.find((candidate) => candidate.name === name)

    if (relation === undefined) {
      throw new AssemoraError(
        'UNKNOWN_RELATION',
        `Table "${table.name}" has no relation "${name}"`,
        { status: 500 },
      )
    }

    return relation
  }

  /**
   * Loads relations in batches: one statement per relation, never one per row.
   * SPEC.md §89 asks for N+1 to be caught by tests rather than by review, and
   * `statementCount()` is what those tests read.
   */
  const loadRelations = async (
    rows: Row[],
    table: TableDescriptor,
    loads: readonly RelationLoad[],
    related: Readonly<Record<string, TableDescriptor>>,
  ): Promise<Row[]> => {
    for (const load of loads) {
      const relation = relationOf(table, load.relation)

      if (relation.kind === 'belongsToMany') {
        throw new AssemoraError(
          'UNSUPPORTED_RELATION',
          'belongsToMany is declared but not loaded yet',
          { status: 501 },
        )
      }

      const target = related[relation.target]

      if (target === undefined) {
        throw new AssemoraError(
          'UNKNOWN_RELATION',
          `The descriptor for "${relation.target}" was not provided`,
          { status: 500 },
        )
      }

      const owned = relation.kind === 'belongsTo'
      const localKey = owned ? relation.foreignKey : relation.ownerKey
      const remoteKey = owned ? relation.ownerKey : relation.foreignKey

      const keys = [
        ...new Set(
          rows.map((row) => row[localKey]).filter((key) => key !== null && key !== undefined),
        ),
      ]

      if (keys.length === 0) {
        for (const row of rows) row[relation.name] = relation.kind === 'hasMany' ? [] : null
        continue
      }

      const targetTable = drizzleTable(target)
      const targetColumns = columnsOf(targetTable)
      const remoteColumn = targetColumns[remoteKey]

      if (remoteColumn === undefined) {
        throw new AssemoraError(
          'UNKNOWN_FIELD',
          `No column is mapped for "${remoteKey}" on "${target.name}"`,
          { status: 500 },
        )
      }

      const children = (await executor()
        .select()
        .from(targetTable)
        .where(inArray(remoteColumn, keys))) as Row[]

      const nested =
        load.nested.length > 0
          ? await loadRelations(children, target, load.nested, related)
          : children

      const grouped = new Map<unknown, Row[]>()

      for (const child of nested) {
        const key = child[remoteKey]
        const bucket = grouped.get(key)
        if (bucket === undefined) grouped.set(key, [child])
        else bucket.push(child)
      }

      for (const row of rows) {
        const matched = grouped.get(row[localKey]) ?? []
        row[relation.name] = relation.kind === 'hasMany' ? matched : (matched[0] ?? null)
      }
    }

    return rows
  }

  /**
   * Drizzle drops a key it has no column for without a word, so a typo or a stale
   * descriptor turns into data that was never written. Better to refuse loudly.
   */
  const rejectUnknownColumns = (
    columns: Readonly<Record<string, unknown>>,
    data: Readonly<Record<string, unknown>> | undefined,
  ): void => {
    for (const name of Object.keys(data ?? {})) {
      if (!(name in columns)) {
        throw new AssemoraError('UNKNOWN_FIELD', `No column is mapped for "${name}"`, {
          status: 500,
        })
      }
    }
  }

  const introspectionQuery = `
    select
      c.table_name,
      c.column_name,
      c.data_type,
      c.is_nullable,
      c.column_default,
      coalesce(pk.is_primary, false) as is_primary,
      coalesce(uq.is_unique, false) as is_unique,
      coalesce(ix.is_indexed, false) as is_indexed
    from information_schema.columns c
    left join lateral (
      select true as is_primary
      from information_schema.table_constraints tc
      join information_schema.key_column_usage k
        on k.constraint_name = tc.constraint_name and k.table_schema = tc.table_schema
      where tc.constraint_type = 'PRIMARY KEY'
        and tc.table_schema = c.table_schema
        and tc.table_name = c.table_name
        and k.column_name = c.column_name
    ) pk on true
    left join lateral (
      select true as is_unique
      from information_schema.table_constraints tc
      join information_schema.key_column_usage k
        on k.constraint_name = tc.constraint_name and k.table_schema = tc.table_schema
      where tc.constraint_type = 'UNIQUE'
        and tc.table_schema = c.table_schema
        and tc.table_name = c.table_name
        and k.column_name = c.column_name
    ) uq on true
    left join lateral (
      select true as is_indexed
      from pg_indexes i
      where i.schemaname = c.table_schema
        and i.tablename = c.table_name
        and i.indexdef like '%(' || quote_ident(c.column_name) || '%'
    ) ix on true
    where c.table_schema = $1
    order by c.table_name, c.ordinal_position
  `

  const runSelect = async (
    query: QueryAst,
    table: PgTable,
    context: DatabaseContext,
  ): Promise<Row[]> => {
    const columns = columnsOf(table)
    const where = buildWhere(columns, query.where)
    const order = buildOrder(columns, query.order)

    let statement = executor().select().from(table).$dynamic()

    if (where !== undefined) statement = statement.where(where)
    if (order.length > 0) statement = statement.orderBy(...order)
    if (query.limit !== undefined) statement = statement.limit(query.limit)
    if (query.offset !== undefined) statement = statement.offset(query.offset)

    const rows = (await statement) as Row[]

    return query.with.length > 0
      ? loadRelations(rows, context.table, query.with, context.related ?? {})
      : rows
  }

  const run = async <T>(query: QueryAst, context: DatabaseContext): Promise<T> => {
    const table = drizzleTable(context.table)
    const columns = columnsOf(table)

    switch (query.operation) {
      case 'select':
        return (await runSelect(query, table, context)) as T

      case 'count': {
        const where = buildWhere(columns, query.where)
        let statement = executor().select({ value: count() }).from(table).$dynamic()
        if (where !== undefined) statement = statement.where(where)

        const rows = (await statement) as { value: number }[]

        return (rows[0]?.value ?? 0) as T
      }

      case 'insert': {
        rejectUnknownColumns(columns, query.data)

        const inserted = (await executor()
          .insert(table)
          .values(query.data ?? {})
          .returning()) as Row[]

        return (inserted[0] ?? {}) as T
      }

      case 'update': {
        rejectUnknownColumns(columns, query.data)

        const where = buildWhere(columns, query.where)
        let statement = executor()
          .update(table)
          .set(query.data ?? {})
          .$dynamic()
        if (where !== undefined) statement = statement.where(where)

        const updated = (await statement.returning()) as Row[]

        return updated.length as T
      }

      case 'delete': {
        const where = buildWhere(columns, query.where)
        let statement = executor().delete(table).$dynamic()
        if (where !== undefined) statement = statement.where(where)

        const removed = (await statement.returning()) as Row[]

        return removed.length as T
      }
    }
  }

  const adapter: PostgresAdapter = {
    async raw(statement, params = []) {
      statements += 1

      try {
        const result = await pool.query(statement, [...params])

        return { rows: result.rows as Record<string, unknown>[], rowCount: result.rowCount ?? 0 }
      } catch (error) {
        // DDL fails the same way a query does, and it must not leak the statement
        // or its parameters either (SPEC.md §83, §85).
        throw toAssemoraError(error)
      }
    },

    async execute<T>(query: QueryAst, context: DatabaseContext): Promise<T> {
      try {
        return await run<T>(query, context)
      } catch (error) {
        // A driver error carries the statement and every parameter value with it.
        // Nothing of either is allowed past this line (SPEC.md §83, §85).
        throw toAssemoraError(error)
      }
    },

    transaction<T>(callback: () => Promise<T>): Promise<T> {
      // A nested transaction becomes a savepoint on the connection that is already
      // open. Starting a second transaction from the pool instead would let the inner
      // writes commit on their own, and an outer rollback would not undo them — the
      // atomicity SPEC.md §33 promises would be silently gone.
      const owner = scoped.getStore() ?? root

      return owner
        .transaction((tx) =>
          // The transaction handle exposes the same query surface, so everything the
          // callback awaits picks it up from the ambient store (SPEC.md §33).
          scoped.run(tx, callback),
        )
        .catch((error: unknown) => {
          // Only the driver's own failures are translated here. An error the caller
          // threw inside the transaction is theirs, and it must arrive unchanged.
          throw isDriverError(error) ? toAssemoraError(error) : error
        })
    },

    async introspect(): Promise<DatabaseSchema> {
      const result = await adapter.raw(introspectionQuery, [schema])

      const grouped = new Map<string, ColumnDescriptor[]>()
      const primaryKeys = new Map<string, string>()

      for (const row of result.rows) {
        const table = String(row.table_name)
        const column = toFieldName(String(row.column_name))
        const isPrimary = row.is_primary === true

        if (isPrimary) primaryKeys.set(table, column)

        grouped.set(table, [
          ...(grouped.get(table) ?? []),
          {
            // Reported in the same naming domain every other descriptor uses, so an
            // introspected table can be compared with a declared one.
            name: column,
            type: toColumnKind(String(row.data_type)),
            isPrimary,
            isNullable: row.is_nullable === 'YES',
            isUnique: row.is_unique === true,
            isIndexed: row.is_indexed === true,
            hasDefault: row.column_default !== null,
          },
        ])
      }

      return {
        tables: [...grouped].map(([name, columns]) => ({
          name,
          primaryKey: primaryKeys.get(name) ?? 'id',
          columns,
          relations: [],
        })),
      }
    },

    diagnostics: {
      statementCount: () => statements,
      lastPoolError: () => lastPoolError,
      reset: () => {
        statements = 0
        lastPoolError = undefined
      },
    },

    close: () => pool.end(),
  }

  pools.set(adapter, pool)

  return adapter
}
