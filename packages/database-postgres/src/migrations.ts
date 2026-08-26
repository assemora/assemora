/**
 * Schema generation and migrations (SPEC.md §34, §110).
 *
 * DDL is derived from the model registry, never hand-written, and never edited by a
 * user. Diff generation between two schema versions belongs to the CLI in phase 10;
 * what lives here is the full schema for a fresh database and a runner that applies
 * and rolls back ordered migrations.
 */
import type { ColumnDescriptor, TableDescriptor } from '@assemora/database'

import { type PostgresAdapter, poolOf } from './adapter.js'
import { toAssemoraError } from './errors.js'
import { toColumnName } from './schema.js'

const MIGRATIONS_TABLE = 'assemora_migrations'

/**
 * An arbitrary but stable key for the advisory lock migrations take.
 *
 * Two deploys starting at once would otherwise both see the same pending list and
 * both try to apply it.
 */
const MIGRATION_LOCK = 4_021_954_017

const quote = (identifier: string): string => `"${identifier.replace(/"/g, '""')}"`

const literal = (value: string): string => `'${value.replace(/'/g, "''")}'`

const sqlType = (column: ColumnDescriptor): string => {
  switch (column.type) {
    case 'uuid':
      return 'uuid'
    case 'string':
      return 'varchar(255)'
    case 'text':
    case 'enum':
      return 'text'
    case 'integer':
      return 'integer'
    case 'bigint':
      return 'bigint'
    case 'number':
      return 'double precision'
    case 'decimal':
      return 'numeric'
    case 'boolean':
      return 'boolean'
    case 'date':
      return 'date'
    case 'timestamp':
      return 'timestamptz'
    case 'json':
      return 'jsonb'
    case 'binary':
      return 'bytea'
  }
}

const columnSql = (column: ColumnDescriptor): string => {
  const parts = [quote(toColumnName(column.name)), sqlType(column)]

  if (column.isPrimary) parts.push('primary key')
  else if (!column.isNullable) parts.push('not null')

  if (column.isUnique && !column.isPrimary) parts.push('unique')

  if (column.type === 'enum' && column.enumValues !== undefined) {
    const allowed = column.enumValues.map(literal).join(', ')
    parts.push(`check (${quote(toColumnName(column.name))} in (${allowed}))`)
  }

  return parts.join(' ')
}

/** `create table` for one model, without foreign keys. */
export const createTableSql = (table: TableDescriptor): string => {
  const columns = table.columns.map(columnSql).join(',\n  ')

  return `create table if not exists ${quote(table.name)} (\n  ${columns}\n)`
}

const foreignKeySql = (table: TableDescriptor): string[] =>
  table.relations
    .filter((relation) => relation.kind === 'belongsTo')
    .map((relation) => {
      const constraint = `${table.name}_${toColumnName(relation.foreignKey)}_fkey`

      return `alter table ${quote(table.name)} add constraint ${quote(constraint)} foreign key (${quote(
        toColumnName(relation.foreignKey),
      )}) references ${quote(relation.target)} (${quote(toColumnName(relation.ownerKey))}) on delete cascade`
    })

const indexSql = (table: TableDescriptor): string[] => {
  const indexed = table.columns
    .filter((column) => column.isIndexed && !column.isPrimary && !column.isUnique)
    .map(
      (column) =>
        `create index if not exists ${quote(`${table.name}_${toColumnName(column.name)}_idx`)} on ${quote(
          table.name,
        )} (${quote(toColumnName(column.name))})`,
    )

  const foreignKeys = table.relations
    .filter((relation) => relation.kind === 'belongsTo')
    .map(
      (relation) =>
        `create index if not exists ${quote(
          `${table.name}_${toColumnName(relation.foreignKey)}_idx`,
        )} on ${quote(table.name)} (${quote(toColumnName(relation.foreignKey))})`,
    )

  return [...indexed, ...foreignKeys]
}

/** Every statement needed to build a fresh schema, in the order they must run. */
export const createSchemaSql = (tables: readonly TableDescriptor[]): string[] => [
  ...tables.map(createTableSql),
  ...tables.flatMap(foreignKeySql),
  ...tables.flatMap(indexSql),
]

export const dropSchemaSql = (tables: readonly TableDescriptor[]): string[] =>
  tables.map((table) => `drop table if exists ${quote(table.name)} cascade`)

export type Migration = {
  readonly name: string
  readonly up: readonly string[]
  readonly down?: readonly string[]
}

/** Creates every table, foreign key and index the models describe (SPEC.md §34). */
export const applySchema = async (
  adapter: PostgresAdapter,
  tables: readonly TableDescriptor[],
): Promise<void> => {
  for (const statement of createSchemaSql(tables)) await adapter.raw(statement)
}

/** Drops them again. Meant for tests and for a disposable database. */
export const dropSchema = async (
  adapter: PostgresAdapter,
  tables: readonly TableDescriptor[],
): Promise<void> => {
  for (const statement of dropSchemaSql(tables)) await adapter.raw(statement)
}

export type MigrationState = {
  readonly name: string
  readonly applied: boolean
  readonly appliedAt?: Date
}

const ensureTable = async (adapter: PostgresAdapter): Promise<void> => {
  await adapter.raw(
    `create table if not exists ${quote(MIGRATIONS_TABLE)} (
      name text primary key,
      applied_at timestamptz not null default now()
    )`,
  )
}

const appliedNames = async (adapter: PostgresAdapter): Promise<Map<string, Date>> => {
  const result = await adapter.raw(
    `select name, applied_at from ${quote(MIGRATIONS_TABLE)} order by name`,
  )

  return new Map(result.rows.map((row) => [String(row.name), row.applied_at as Date] as const))
}

/** Applies every migration that has not run yet, each one in its own transaction. */
export const applyMigrations = async (
  adapter: PostgresAdapter,
  migrations: readonly Migration[],
): Promise<string[]> => {
  await ensureTable(adapter)

  const lock = await poolOf(adapter).connect()

  try {
    // Held for the whole run: two deploys starting together would otherwise read the
    // same pending list and both apply it.
    await lock.query('select pg_advisory_lock($1)', [MIGRATION_LOCK])

    const applied = await appliedNames(adapter)
    const ran: string[] = []

    for (const migration of migrations) {
      if (applied.has(migration.name)) continue

      const client = await poolOf(adapter).connect()

      try {
        await client.query('begin')
        for (const statement of migration.up) await client.query(statement)
        await client.query(`insert into ${quote(MIGRATIONS_TABLE)} (name) values ($1)`, [
          migration.name,
        ])
        await client.query('commit')
        ran.push(migration.name)
      } catch (error) {
        // The rollback is best effort. If it fails too, the failure that actually
        // matters is still the one that got us here (SPEC.md §83).
        await client.query('rollback').catch(() => undefined)

        throw toAssemoraError(error)
      } finally {
        client.release()
      }
    }

    return ran
  } finally {
    await lock.query('select pg_advisory_unlock($1)', [MIGRATION_LOCK]).catch(() => undefined)
    lock.release()
  }
}

/** Rolls the most recent migration back, if it declares how. */
export const rollbackLastMigration = async (
  adapter: PostgresAdapter,
  migrations: readonly Migration[],
): Promise<string | null> => {
  await ensureTable(adapter)

  const applied = await appliedNames(adapter)
  const last = [...migrations].reverse().find((migration) => applied.has(migration.name))

  if (last === undefined) return null

  if (last.down === undefined) {
    throw new Error(`Migration "${last.name}" declares no down statements`)
  }

  const client = await poolOf(adapter).connect()

  try {
    await client.query('begin')
    for (const statement of last.down) await client.query(statement)
    await client.query(`delete from ${quote(MIGRATIONS_TABLE)} where name = $1`, [last.name])
    await client.query('commit')
  } catch (error) {
    await client.query('rollback').catch(() => undefined)

    throw toAssemoraError(error)
  } finally {
    client.release()
  }

  return last.name
}

export const migrationStatus = async (
  adapter: PostgresAdapter,
  migrations: readonly Migration[],
): Promise<MigrationState[]> => {
  await ensureTable(adapter)

  const applied = await appliedNames(adapter)

  return migrations.map((migration) => {
    const appliedAt = applied.get(migration.name)

    return {
      name: migration.name,
      applied: appliedAt !== undefined,
      ...(appliedAt === undefined ? {} : { appliedAt }),
    }
  })
}
