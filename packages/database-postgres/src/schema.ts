/**
 * Assemora table descriptors turned into Drizzle tables (SPEC.md §32, §34).
 *
 * This is the only place in the repository that knows Drizzle's column builders.
 * They are threaded dynamically, which their generic types do not express, so they
 * are handled through one narrow structural view declared here rather than through
 * `any` (SPEC.md §90). The view names only the three modifiers this module calls;
 * naming more would force a cast at every builder, which is what an earlier version
 * did before a review measured it.
 */
import { AssemoraError } from '@assemora/core'
import type { ColumnDescriptor, TableDescriptor } from '@assemora/database'
import { getTableColumns } from 'drizzle-orm'
import {
  bigint,
  boolean,
  customType,
  date,
  doublePrecision,
  integer,
  jsonb,
  numeric,
  type PgColumn,
  type PgTable,
  pgTable,
  text,
  timestamp,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core'

/** `createdAt` → `created_at`. The database keeps its own conventions. */
export const toColumnName = (field: string): string =>
  field.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase()

/** `created_at` → `createdAt`. The inverse of `toColumnName`, for introspection. */
export const toFieldName = (column: string): string =>
  column.replace(/_([a-z0-9])/g, (_, character: string) => character.toUpperCase())

/** What `information_schema` calls a type, in the vocabulary a descriptor uses. */
export const toColumnKind = (dataType: string): ColumnDescriptor['type'] => {
  switch (dataType) {
    case 'uuid':
      return 'uuid'
    case 'character varying':
      return 'string'
    case 'text':
      return 'text'
    case 'integer':
    case 'smallint':
      return 'integer'
    case 'bigint':
      return 'bigint'
    case 'double precision':
    case 'real':
      return 'number'
    case 'numeric':
      return 'decimal'
    case 'boolean':
      return 'boolean'
    case 'date':
      return 'date'
    case 'timestamp with time zone':
    case 'timestamp without time zone':
      return 'timestamp'
    case 'jsonb':
    case 'json':
      return 'json'
    case 'bytea':
      return 'binary'
    default:
      return 'text'
  }
}

const bytea = customType<{ data: Uint8Array; driverData: Buffer }>({
  dataType: () => 'bytea',
  toDriver: (value) => Buffer.from(value),
  fromDriver: (value) => new Uint8Array(value),
})

/**
 * The subset of a Drizzle column builder this module drives.
 *
 * Every Drizzle builder satisfies it structurally, so no cast is needed to obtain
 * one. Adding a modifier here that the module does not call would break that.
 */
type ColumnBuilderLike = {
  primaryKey(): ColumnBuilderLike
  notNull(): ColumnBuilderLike
  unique(): ColumnBuilderLike
}

const baseColumn = (column: ColumnDescriptor): ColumnBuilderLike => {
  const name = toColumnName(column.name)

  switch (column.type) {
    case 'uuid':
      return uuid(name)
    case 'string':
      return varchar(name, { length: 255 })
    case 'text':
    case 'enum':
      return text(name)
    case 'integer':
      return integer(name)
    case 'bigint':
      return bigint(name, { mode: 'bigint' })
    case 'number':
      return doublePrecision(name)
    case 'decimal':
      return numeric(name)
    case 'boolean':
      return boolean(name)
    case 'date':
      return date(name, { mode: 'date' })
    case 'timestamp':
      return timestamp(name, { withTimezone: true, mode: 'date' })
    case 'json':
      return jsonb(name)
    case 'binary':
      return bytea(name)
  }
}

const buildColumn = (column: ColumnDescriptor): ColumnBuilderLike => {
  let built = baseColumn(column)

  if (column.isPrimary) built = built.primaryKey()
  else if (!column.isNullable) built = built.notNull()

  if (column.isUnique && !column.isPrimary) built = built.unique()

  return built
}

/**
 * Keyed by the descriptor itself, not by its name.
 *
 * Keying by name returned whichever table happened to be built first, so two
 * descriptors that share a name — a test fixture and a real model, say — silently
 * resolved to the wrong columns.
 */
const tables = new WeakMap<TableDescriptor, PgTable>()
const builtNames = new Map<string, TableDescriptor>()

/** Builds — and remembers — the Drizzle table for a descriptor. */
export const drizzleTable = (descriptor: TableDescriptor): PgTable => {
  const existing = tables.get(descriptor)
  if (existing !== undefined) return existing

  const clashing = builtNames.get(descriptor.name)

  if (clashing !== undefined && clashing !== descriptor) {
    throw new AssemoraError(
      'DUPLICATE_TABLE',
      `Two different descriptors both describe the table "${descriptor.name}"`,
      { status: 500 },
    )
  }

  const columns: Record<string, ColumnBuilderLike> = {}

  for (const column of descriptor.columns) {
    columns[column.name] = buildColumn(column)
  }

  // The one unavoidable cast in this file. `pgTable` is generic over a literal
  // column map so that it can type the resulting table; a map built at runtime from
  // descriptors has no literal type to give it (SPEC.md §90: local and documented).
  const built = pgTable(
    descriptor.name,
    columns as unknown as Parameters<typeof pgTable>[1],
  ) as PgTable

  tables.set(descriptor, built)
  builtNames.set(descriptor.name, descriptor)

  return built
}

export const clearTableCache = (): void => {
  builtNames.clear()
}

/** The table's columns keyed by Assemora field name, which the AST addresses. */
export const columnsOf = (table: PgTable): Record<string, PgColumn> =>
  getTableColumns(table) as Record<string, PgColumn>
