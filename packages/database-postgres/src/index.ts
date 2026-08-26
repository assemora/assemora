/**
 * `@assemora/database-postgres` — the PostgreSQL adapter.
 *
 * Drizzle and `pg` live here and nowhere else in the repository (SPEC.md §6, §32,
 * §125.1); `pnpm boundaries` enforces that. Everything above this package speaks
 * Query AST and the adapter contract of `@assemora/database`.
 */

export {
  type PostgresAdapter,
  type PostgresAdapterOptions,
  postgres,
  type RawResult,
} from './adapter.js'
export { isDriverError, toAssemoraError } from './errors.js'
// `SchemaChange` is not re-exported: `@assemora/database` owns the diff vocabulary
// and every generator reads it from there, so there is exactly one definition of what
// a change is (ADR-0021).
export { type GeneratedMigration, migrationSql } from './migration-sql.js'
export {
  applyMigrations,
  applySchema,
  createSchemaSql,
  createTableSql,
  dropSchema,
  dropSchemaSql,
  type Migration,
  type MigrationState,
  migrationStatus,
  rollbackLastMigration,
} from './migrations.js'
// `toColumnName` is the only symbol from the translation layer that leaves this
// package: it is a pure `string => string` and the CLI needs it to name columns.
// Everything else there speaks in Drizzle types, and Drizzle never appears in an
// Assemora signature (SPEC.md §10, §32, §125.1).
export { toColumnName } from './schema.js'
