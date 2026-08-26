/**
 * Schema generation and migrations (SPEC.md §34, §110).
 *
 * DDL is derived from the model registry, never hand-written, and never edited by a
 * user. What lives here is the full schema for a fresh database and a runner that
 * applies and rolls back ordered migrations; `migration-sql.ts` turns a diff between
 * two schema versions into the same DDL, and reuses the pieces exported here rather
 * than forming a second opinion about how a column becomes SQL.
 */
import type { ColumnDescriptor, RelationDescriptor, TableDescriptor } from '@assemora/database'

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

export const quote = (identifier: string): string => `"${identifier.replace(/"/g, '""')}"`

export const literal = (value: string): string => `'${value.replace(/'/g, "''")}'`

export const sqlType = (column: ColumnDescriptor): string => {
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

/**
 * Who is asking for the statement, which decides what it tolerates.
 *
 * `bootstrap` is `applySchema` and `dropSchema`: they build or tear down a whole
 * database that may already be half there, so they say `if not exists`, `if exists`
 * and `cascade` and carry on.
 *
 * `migration` is `migration-sql.ts`, and it tolerates nothing. A
 * `create table if not exists` that finds the table already built does nothing while
 * the runner records the migration as applied, and a later rollback then drops a
 * table this migration never created. A `drop table ... cascade` silently takes the
 * foreign keys of *other* tables with it, and no `down` can rebuild what the diff
 * never mentioned. Both fail loudly instead.
 */
export type SchemaSqlMode = 'bootstrap' | 'migration'

const ifNotExists = (mode: SchemaSqlMode): string => (mode === 'bootstrap' ? ' if not exists' : '')

const ifExists = (mode: SchemaSqlMode): string => (mode === 'bootstrap' ? ' if exists' : '')

/** The `check` that keeps an enum column inside its declared set, or nothing. */
export const enumCheckSql = (column: ColumnDescriptor): string | undefined => {
  if (column.type !== 'enum' || column.enumValues === undefined) return undefined

  const allowed = column.enumValues.map(literal).join(', ')

  return `check (${quote(toColumnName(column.name))} in (${allowed}))`
}

/**
 * Where a column definition is going, which decides exactly one thing about it.
 *
 * `create table` writes the whole column, primary key included.
 * `alter table ... add column` leaves the key out: a diff that re-adds a primary
 * column always carries the moved key as a change of its own — the table it left has
 * to name some other column as its key — and two statements claiming the same key
 * give the table two primary keys. `not null` still holds, because a key implies it.
 */
export type ColumnPlacement = 'create-table' | 'add-column'

export const columnSql = (
  column: ColumnDescriptor,
  placement: ColumnPlacement = 'create-table',
): string => {
  const parts = [quote(toColumnName(column.name)), sqlType(column)]
  const inlineKey = column.isPrimary && placement === 'create-table'

  if (inlineKey) parts.push('primary key')
  else if (!column.isNullable) parts.push('not null')

  if (column.isUnique && !column.isPrimary) parts.push('unique')

  const check = enumCheckSql(column)
  if (check !== undefined) parts.push(check)

  return parts.join(' ')
}

/**
 * The names PostgreSQL gives the constraints `columnSql` writes inline.
 *
 * `create table` does not name them, so a later migration that has to drop one has
 * to reproduce what the server chose. These four functions are that reproduction,
 * and they live beside `columnSql` so the two cannot drift apart.
 */
export const primaryKeyName = (table: string): string => `${table}_pkey`

export const uniqueConstraintName = (table: string, column: string): string =>
  `${table}_${toColumnName(column)}_key`

export const checkConstraintName = (table: string, column: string): string =>
  `${table}_${toColumnName(column)}_check`

export const foreignKeyName = (table: string, relation: RelationDescriptor): string =>
  `${table}_${toColumnName(relation.foreignKey)}_fkey`

export const indexName = (table: string, column: string): string =>
  `${table}_${toColumnName(column)}_idx`

export const createIndexSql = (
  table: string,
  column: string,
  mode: SchemaSqlMode = 'bootstrap',
): string =>
  `create index${ifNotExists(mode)} ${quote(indexName(table, column))} on ${quote(
    table,
  )} (${quote(toColumnName(column))})`

export const dropIndexSql = (
  table: string,
  column: string,
  mode: SchemaSqlMode = 'bootstrap',
): string => `drop index${ifExists(mode)} ${quote(indexName(table, column))}`

export const addForeignKeySql = (table: string, relation: RelationDescriptor): string =>
  `alter table ${quote(table)} add constraint ${quote(
    foreignKeyName(table, relation),
  )} foreign key (${quote(toColumnName(relation.foreignKey))}) references ${quote(
    relation.target,
  )} (${quote(toColumnName(relation.ownerKey))}) on delete cascade`

/** The relations a table stores a key for, and therefore the ones that become DDL. */
export const belongsToRelations = (table: TableDescriptor): readonly RelationDescriptor[] =>
  table.relations.filter((relation) => relation.kind === 'belongsTo')

/**
 * Whether a column of its own asks for an index.
 *
 * A primary key and a unique column already have one, so asking for a second would
 * only cost writes. `indexedColumns` and the migration that adds a single column
 * both ask this question, and they have to answer it the same way or a migrated
 * database ends up with an index a fresh one does not have.
 */
export const needsIndex = (column: ColumnDescriptor): boolean =>
  column.isIndexed && !column.isPrimary && !column.isUnique

/** Every column the table wants an index on, foreign keys included. */
export const indexedColumns = (table: TableDescriptor): readonly string[] => [
  ...table.columns.filter(needsIndex).map((column) => column.name),
  ...belongsToRelations(table).map((relation) => relation.foreignKey),
]

/** `create table` for one model, without foreign keys. */
export const createTableSql = (
  table: TableDescriptor,
  mode: SchemaSqlMode = 'bootstrap',
): string => {
  const columns = table.columns.map((column) => columnSql(column)).join(',\n  ')

  return `create table${ifNotExists(mode)} ${quote(table.name)} (\n  ${columns}\n)`
}

const foreignKeySql = (table: TableDescriptor): string[] =>
  belongsToRelations(table).map((relation) => addForeignKeySql(table.name, relation))

const indexSql = (table: TableDescriptor): string[] =>
  indexedColumns(table).map((column) => createIndexSql(table.name, column))

/** Every statement needed to build a fresh schema, in the order they must run. */
export const createSchemaSql = (tables: readonly TableDescriptor[]): string[] => [
  ...tables.map((table) => createTableSql(table)),
  ...tables.flatMap(foreignKeySql),
  ...tables.flatMap(indexSql),
]

export const dropTableSql = (table: TableDescriptor, mode: SchemaSqlMode = 'bootstrap'): string =>
  `drop table${ifExists(mode)} ${quote(table.name)}${mode === 'bootstrap' ? ' cascade' : ''}`

export const dropSchemaSql = (tables: readonly TableDescriptor[]): string[] =>
  tables.map((table) => dropTableSql(table))

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
