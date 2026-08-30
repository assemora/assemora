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
  /**
   * The column holding the reference: on this table for `belongsTo`, on the target's
   * for `hasOne` and `hasMany`. A `belongsToMany` stores no reference on either table
   * — its two columns live in the join table and are named below.
   */
  readonly foreignKey: string
  /** The column the reference points at: the owner's key, except for `belongsTo`. */
  readonly ownerKey: string
  /** Join table, for `belongsToMany` only. Derived from the two table names when omitted. */
  readonly through?: string
  /**
   * The join table column holding this side's key, for `belongsToMany` only.
   * Derived from this table's name when omitted (`joinTableDescriptor`).
   */
  readonly foreignPivotKey?: string
  /** The join table column holding the target's key, for `belongsToMany` only. */
  readonly relatedPivotKey?: string
}

export type TableDescriptor = {
  readonly name: string
  readonly columns: readonly ColumnDescriptor[]
  /**
   * The single column that identifies a row, or empty where nothing does. A join
   * table is identified by its pair of keys, and `uniqueTogether` is what says so.
   */
  readonly primaryKey: string
  readonly relations: readonly RelationDescriptor[]
  readonly softDeleteColumn?: string
  /**
   * Groups of columns unique together, one constraint each.
   *
   * A different claim from `ColumnDescriptor.isUnique`, which says a column is unique
   * on its own: a join table's two keys each repeat freely and only the pair may not
   * (SPEC.md §24).
   */
  readonly uniqueTogether?: readonly (readonly string[])[]
  /**
   * Whether this table holds one row per language (SPEC.md §131).
   *
   * Carried on the descriptor rather than inferred from the presence of a `locale`
   * column, because a column called `locale` is a perfectly ordinary thing for an
   * application to declare — a log of what language somebody chose, say — and a read
   * silently scoped to it would be a filter nobody wrote.
   */
  readonly translatable?: boolean
  /**
   * The column a write stamps with the time, where the model declares one.
   *
   * Carried like `softDeleteColumn`, and for a reader rather than for a writer: the data
   * layer already knows which column `timestamp().updated()` made, and this is how a
   * layer above finds out. It is what makes "this translation is older than the entry it
   * translates" answerable without a column of its own (SPEC.md §131).
   */
  readonly updatedAtColumn?: string
}

/**
 * The two columns a translatable model carries (SPEC.md §131).
 *
 * Named here rather than spelled out in each layer that has to recognise them: the data
 * layer declares them, the schema diff has to know that a table gaining `locale` is a
 * table becoming translatable, and the SQL writer has to know what to backfill it with.
 * Three spellings of one name is how the three come to disagree.
 */
export const LOCALE_COLUMN = 'locale'
export const TRANSLATION_OF_COLUMN = 'translationOf'

/**
 * What `locale` holds on a row written by a deployment that names no languages.
 *
 * A translatable model has to work in an application that serves one language — the
 * framework ships one, `assemora_pages`, and SPEC.md §9 and §124 both write out the
 * whole configuration of an application without a word about locales. So the column
 * cannot demand a code nobody has chosen.
 *
 * The empty string says exactly that: this row is in the deployment's own language,
 * whichever that turns out to be. Which is why a read of the *default* language matches
 * it too — a page written before a site had languages belongs to the language it was
 * written in, and that is the default. Without that rule, configuring locales on an
 * existing project would make every row disappear.
 */
export const UNSPECIFIED_LOCALE = ''

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
  /**
   * Runs a query.
   *
   * One failure is part of the contract rather than left to the engine: a query
   * against a table that has not been created yet must reject with
   * `schemaNotApplied()` from `./errors.js`, distinct from every other refusal. An
   * application has to be able to boot against an unapplied schema — that is what
   * `assemora db:generate` does to read the registry (ADR-0021) — and the boot hook
   * that survives it may not depend on this package, let alone on an engine, to tell
   * a missing table from a database that refused it.
   */
  execute<T>(query: QueryAst, context: DatabaseContext): Promise<T>
  transaction<T>(callback: () => Promise<T>): Promise<T>
  introspect(): Promise<DatabaseSchema>
}
