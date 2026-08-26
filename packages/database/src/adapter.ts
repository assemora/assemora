/**
 * The database contract (SPEC.md §31).
 *
 * Nothing PostgreSQL-specific appears here. `@assemora/database-postgres` implements
 * these interfaces with Drizzle inside, and no other package ever learns that
 * (SPEC.md §32, §125.1).
 */
import type { AssemoraContext } from '@assemora/core'

import type { QueryAst } from './query-ast.js'

export type ColumnType =
  | 'uuid'
  | 'string'
  | 'text'
  | 'integer'
  | 'bigint'
  | 'number'
  | 'decimal'
  | 'boolean'
  | 'date'
  | 'timestamp'
  | 'json'
  | 'enum'
  | 'binary'

export type ColumnDescriptor = {
  readonly name: string
  readonly type: ColumnType
  readonly isPrimary: boolean
  readonly isNullable: boolean
  readonly isUnique: boolean
  readonly isIndexed: boolean
  readonly hasDefault: boolean
  readonly enumValues?: readonly string[]
}

export type RelationKind = 'belongsTo' | 'hasOne' | 'hasMany' | 'belongsToMany'

export type RelationDescriptor = {
  readonly name: string
  readonly kind: RelationKind
  /** The table on the other side. */
  readonly target: string
  readonly foreignKey: string
  readonly ownerKey: string
  /** Join table, for `belongsToMany` only. */
  readonly through?: string
}

export type TableDescriptor = {
  readonly name: string
  readonly columns: readonly ColumnDescriptor[]
  readonly primaryKey: string
  readonly relations: readonly RelationDescriptor[]
  readonly softDeleteColumn?: string
}

export type DatabaseSchema = {
  readonly tables: readonly TableDescriptor[]
}

export type DatabaseContext = {
  readonly table: TableDescriptor
  /** The ambient application context, for logging and auditing (SPEC.md §12). */
  readonly context?: AssemoraContext
  /** Tables the query loads relations from, keyed by table name. */
  readonly related?: Readonly<Record<string, TableDescriptor>>
}

export type DatabaseAdapter = {
  execute<T>(query: QueryAst, context: DatabaseContext): Promise<T>
  transaction<T>(callback: () => Promise<T>): Promise<T>
  introspect(): Promise<DatabaseSchema>
}
