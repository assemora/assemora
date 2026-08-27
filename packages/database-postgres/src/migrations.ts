/**
 * Schema generation and migrations (SPEC.md §34, §110).
 *
 * DDL is derived from the model registry, never hand-written, and never edited by a
 * user. What lives here is the full schema for a fresh database and a runner that
 * applies and rolls back ordered migrations; `migration-sql.ts` turns a diff between
 * two schema versions into the same DDL, and reuses the pieces exported here rather
 * than forming a second opinion about how a column becomes SQL.
 */
import {
  type ColumnDescriptor,
  type RelationDescriptor,
  type TableDescriptor,
  withJoinTables,
} from '@assemora/database'

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

/**
 * The index that backs a foreign key, which is never the column's own index.
 *
 * A column can be indexed for two independent reasons: it declared `.index()`, and a
 * `belongsTo` relation put a foreign key on it. A schema diff reports those reasons
 * separately — `indexAdded` carries a column, `foreignKeyAdded` carries a relation,
 * and neither says anything about the other — so one shared name leaves every
 * migration guessing. Dropping the relation could not tell whether the index it was
 * about to drop was the column's own, and removing `.index()` from a foreign key
 * column dropped the index the relation still needs. Two names give every index
 * exactly one owner, and each owner arrives and leaves with its own.
 */
export const foreignKeyIndexName = (table: string, relation: RelationDescriptor): string =>
  `${foreignKeyName(table, relation)}_idx`

const createIndexNamed = (
  name: string,
  table: string,
  column: string,
  mode: SchemaSqlMode,
): string =>
  `create index${ifNotExists(mode)} ${quote(name)} on ${quote(table)} (${quote(
    toColumnName(column),
  )})`

export const createIndexSql = (
  table: string,
  column: string,
  mode: SchemaSqlMode = 'bootstrap',
): string => createIndexNamed(indexName(table, column), table, column, mode)

export const dropIndexSql = (
  table: string,
  column: string,
  mode: SchemaSqlMode = 'bootstrap',
): string => `drop index${ifExists(mode)} ${quote(indexName(table, column))}`

export const createForeignKeyIndexSql = (
  table: string,
  relation: RelationDescriptor,
  mode: SchemaSqlMode = 'bootstrap',
): string =>
  createIndexNamed(foreignKeyIndexName(table, relation), table, relation.foreignKey, mode)

export const dropForeignKeyIndexSql = (
  table: string,
  relation: RelationDescriptor,
  mode: SchemaSqlMode = 'bootstrap',
): string => `drop index${ifExists(mode)} ${quote(foreignKeyIndexName(table, relation))}`

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
 * only cost writes. `tableIndexSql` and the migration that adds a single column both
 * ask this question, and they have to answer it the same way or a migrated database
 * ends up with an index a fresh one does not have.
 *
 * It says nothing about the foreign keys on the column: those are the relation's, and
 * `foreignKeyIndexName` says why the two are kept apart.
 */
export const needsIndex = (column: ColumnDescriptor): boolean =>
  column.isIndexed && !column.isPrimary && !column.isUnique

/**
 * Every index the table has: one per column that asked for one, and one per foreign
 * key.
 *
 * PostgreSQL indexes the *referenced* side of a foreign key and never the referencing
 * one, so the child's key is unindexed unless something creates the index — and then
 * every batched relation load and every `on delete cascade` scans the child table.
 *
 * A fresh `createSchemaSql` build and a migration that creates the same table both
 * call this, and the migration that merely *adds a relation* to a table that already
 * exists emits the same statement beside the constraint (`migration-sql.ts`). That is
 * what keeps a migrated database and a built one the same shape.
 */
export const tableIndexSql = (
  table: TableDescriptor,
  mode: SchemaSqlMode = 'bootstrap',
): string[] => [
  ...table.columns
    .filter(needsIndex)
    .map((column) => createIndexSql(table.name, column.name, mode)),
  ...belongsToRelations(table).map((relation) =>
    createForeignKeyIndexSql(table.name, relation, mode),
  ),
]

/** The same set, dropped. What the reversal of `tableIndexSql` has to say. */
export const dropTableIndexSql = (
  table: TableDescriptor,
  mode: SchemaSqlMode = 'bootstrap',
): string[] => [
  ...table.columns.filter(needsIndex).map((column) => dropIndexSql(table.name, column.name, mode)),
  ...belongsToRelations(table).map((relation) =>
    dropForeignKeyIndexSql(table.name, relation, mode),
  ),
]

/**
 * `unique (a, b)` — the one claim `ColumnDescriptor.isUnique` cannot make.
 *
 * A join table's two keys each repeat freely and only the pair may not: a user holds
 * many roles and a role many users, and attaching the same role twice has to be
 * refused by the table rather than by whoever remembered to check first (SPEC.md §24).
 *
 * Written inline and unnamed, like the constraints `columnSql` writes. Nothing drops
 * one yet, because a composite unique cannot move on a table that stays — the diff
 * carries `uniqueTogether` whole, inside `tableAdded` and `tableRemoved`. Should that
 * change, PostgreSQL names this `<table>_<a>_<b>_key`, which is `uniqueConstraintName`
 * with every column of the group in it.
 */
const uniqueTogetherSql = (columns: readonly string[]): string =>
  `unique (${columns.map((column) => quote(toColumnName(column))).join(', ')})`

/** `create table` for one model, without foreign keys. */
export const createTableSql = (
  table: TableDescriptor,
  mode: SchemaSqlMode = 'bootstrap',
): string => {
  const definitions = [
    ...table.columns.map((column) => columnSql(column)),
    ...(table.uniqueTogether ?? [])
      .filter((columns) => columns.length > 0)
      .map((columns) => uniqueTogetherSql(columns)),
  ].join(',\n  ')

  return `create table${ifNotExists(mode)} ${quote(table.name)} (\n  ${definitions}\n)`
}

const foreignKeySql = (table: TableDescriptor): string[] =>
  belongsToRelations(table).map((relation) => addForeignKeySql(table.name, relation))

/**
 * Every statement needed to build a fresh schema, in the order they must run.
 *
 * The tables are expanded first: a `belongsToMany` stores its pairs in a table no
 * model declares, so a schema built from the registry alone would leave `.with('roles')`
 * reading a table that does not exist. `withJoinTables` is the same expansion
 * `diffSchema` performs, so a database built here and one migrated into existence hold
 * the same tables — and it is idempotent, so a caller that already expanded loses
 * nothing by passing the result (SPEC.md §23, §34).
 */
export const createSchemaSql = (tables: readonly TableDescriptor[]): string[] => {
  const all = withJoinTables(tables)

  return [
    ...all.map((table) => createTableSql(table)),
    ...all.flatMap(foreignKeySql),
    ...all.flatMap((table) => tableIndexSql(table)),
  ]
}

export const dropTableSql = (table: TableDescriptor, mode: SchemaSqlMode = 'bootstrap'): string =>
  `drop table${ifExists(mode)} ${quote(table.name)}${mode === 'bootstrap' ? ' cascade' : ''}`

/** The reversal, join tables included — whatever `createSchemaSql` made, this removes. */
export const dropSchemaSql = (tables: readonly TableDescriptor[]): string[] =>
  withJoinTables(tables).map((table) => dropTableSql(table))

export type Migration = {
  readonly name: string
  readonly up: readonly string[]
  readonly down?: readonly string[]
}

/**
 * Creates every table, foreign key and index the models describe, plus the join table
 * behind every `belongsToMany` they declare (SPEC.md §34).
 */
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
