/**
 * Schema diffing (SPEC.md §34).
 *
 * `assemora db:generate` writes a migration, and a migration is the difference
 * between two schemas rather than a schema. Working that difference out needs no
 * SQL: whether a column can still hold what it held is a property of the types, and
 * the types are the ones every adapter already shares. So the answer lives here, and
 * each dialect turns the same list of changes into its own statements.
 *
 * Three things a descriptor carries are deliberately not compared. `hasDefault` is a
 * data-layer concern that never reaches the DDL (ADR-0011), so it changes neither the
 * statements nor the warning about them; `softDeleteColumn` names an ordinary column,
 * already compared as one; and `isPrimary` is ignored in favour of
 * `TableDescriptor.primaryKey`, because two fields stating one fact would report a
 * moved key twice.
 *
 * What a descriptor cannot express, this cannot see: an index is a flag on a single
 * column, so composite and partial indexes are invisible, and a foreign key exists
 * only where a `belongsTo` relation puts one.
 *
 * Both sides have to be descriptors the framework produced — the snapshot in
 * `.assemora/generated/` against the model registry (ADR-0021). What a database
 * reports is not one: `DatabaseAdapter.introspect()` carries no relations and maps an
 * enum column back to the `text` it is stored as, so diffing a live database against
 * the registry adds every foreign key and re-enums every enum column, on every run.
 * Comparing the two becomes possible when introspection reads constraints, and not
 * before.
 */
import { AssemoraError } from '@assemora/core'

import type {
  ColumnDescriptor,
  ColumnType,
  RelationDescriptor,
  TableDescriptor,
} from './adapter.js'

/**
 * The two ways a change can go wrong, carried by every change so that a caller never
 * has to narrow before it can ask (SPEC.md §34).
 *
 * They are different questions. A destructive change succeeds and takes data with it;
 * one that may fail on existing rows takes nothing, because the database refuses it
 * until somebody fills the empty rows in or removes the duplicates. A change can be
 * both, and a change that is neither is safe to apply to a live table.
 */
export type ChangeRisk = {
  /**
   * Applying it may destroy data no later migration can bring back.
   *
   * A drop answers this for certain. A type change answers it as a possibility: a
   * value that does not fit the new type is either rewritten or refused, and which of
   * the two happens is the engine's decision rather than a property of the types, so
   * an unclassified narrowing raises the warning that costs a person the most to
   * ignore.
   */
  readonly destructive: boolean
  /** Applying it may be refused by a table whose rows do not already comply. */
  readonly mayFailOnExistingRows: boolean
}

/**
 * A new table, whole.
 *
 * Its columns, indexes and foreign keys travel in the descriptor rather than as
 * changes of their own — the generator that creates a table creates all of it.
 */
export type TableAdded = ChangeRisk & {
  readonly kind: 'tableAdded'
  readonly table: string
  readonly after: TableDescriptor
}

export type TableRemoved = ChangeRisk & {
  readonly kind: 'tableRemoved'
  readonly table: string
  readonly before: TableDescriptor
}

/** A new column, with its uniqueness and its index already in the descriptor. */
export type ColumnAdded = ChangeRisk & {
  readonly kind: 'columnAdded'
  readonly table: string
  readonly column: string
  readonly after: ColumnDescriptor
}

export type ColumnRemoved = ChangeRisk & {
  readonly kind: 'columnRemoved'
  readonly table: string
  readonly column: string
  readonly before: ColumnDescriptor
}

export type ColumnTypeChanged = ChangeRisk & {
  readonly kind: 'columnTypeChanged'
  readonly table: string
  readonly column: string
  readonly before: ColumnDescriptor
  readonly after: ColumnDescriptor
}

export type ColumnNullabilityChanged = ChangeRisk & {
  readonly kind: 'columnNullabilityChanged'
  readonly table: string
  readonly column: string
  readonly before: ColumnDescriptor
  readonly after: ColumnDescriptor
}

export type ColumnUniquenessChanged = ChangeRisk & {
  readonly kind: 'columnUniquenessChanged'
  readonly table: string
  readonly column: string
  readonly before: ColumnDescriptor
  readonly after: ColumnDescriptor
}

/**
 * The allowed values of an enum column moved.
 *
 * `added` and `removed` are computed once here: which values went is what decides
 * both the warning and whether the change can be applied at all, and every caller
 * would otherwise take the same two set differences.
 */
export type ColumnEnumChanged = ChangeRisk & {
  readonly kind: 'columnEnumChanged'
  readonly table: string
  readonly column: string
  readonly before: ColumnDescriptor
  readonly after: ColumnDescriptor
  readonly added: readonly string[]
  readonly removed: readonly string[]
}

export type PrimaryKeyMoved = ChangeRisk & {
  readonly kind: 'primaryKeyMoved'
  readonly table: string
  readonly before: string
  readonly after: string
}

export type IndexAdded = ChangeRisk & {
  readonly kind: 'indexAdded'
  readonly table: string
  readonly column: string
  readonly after: ColumnDescriptor
}

export type IndexRemoved = ChangeRisk & {
  readonly kind: 'indexRemoved'
  readonly table: string
  readonly column: string
  readonly before: ColumnDescriptor
}

/** `column` is the local column the constraint sits on, not the relation's name. */
export type ForeignKeyAdded = ChangeRisk & {
  readonly kind: 'foreignKeyAdded'
  readonly table: string
  readonly column: string
  readonly after: RelationDescriptor
}

export type ForeignKeyRemoved = ChangeRisk & {
  readonly kind: 'foreignKeyRemoved'
  readonly table: string
  readonly column: string
  readonly before: RelationDescriptor
}

/**
 * One difference between two schemas.
 *
 * `before` is always the state going away and `after` the state arriving, so an
 * addition has only an `after` and a removal only a `before`. A generator switches on
 * `kind` and writes both directions from what the change carries; it never has to
 * find the descriptors again. Adding a member here is a compile error in every
 * generator that exhausts the union, which is the point of it being one.
 */
export type SchemaChange =
  | TableAdded
  | TableRemoved
  | ColumnAdded
  | ColumnRemoved
  | ColumnTypeChanged
  | ColumnNullabilityChanged
  | ColumnUniquenessChanged
  | ColumnEnumChanged
  | PrimaryKeyMoved
  | IndexAdded
  | IndexRemoved
  | ForeignKeyAdded
  | ForeignKeyRemoved

export type SchemaDiff = {
  /** In the order they must be applied. Empty when the two schemas agree. */
  readonly changes: readonly SchemaChange[]
}

/**
 * Type changes that hold every value the old type could.
 *
 * The list is short on purpose. Calling a safe change destructive costs somebody a
 * warning they can read and dismiss; calling a destructive one safe costs them the
 * column, so a pair that is not listed here counts as a narrowing.
 */
const WIDENINGS: Partial<Record<ColumnType, readonly ColumnType[]>> = {
  uuid: ['string', 'text'],
  string: ['text'],
  integer: ['bigint', 'number', 'decimal'],
  bigint: ['decimal'],
  number: ['decimal'],
  date: ['timestamp'],
  enum: ['text'],
}

const widens = (from: ColumnType, to: ColumnType): boolean => (WIDENINGS[from] ?? []).includes(to)

/**
 * Conversions that rewrite every value, including the ones that fit.
 *
 * These are the type changes whose risk is certain in both directions: no row can
 * refuse them, and what the column used to hold is gone. Every other narrowing is
 * decided by the rows — see `riskOfTypeChange`.
 */
const REWRITINGS: Partial<Record<ColumnType, readonly ColumnType[]>> = {
  decimal: ['integer', 'bigint', 'number'],
  number: ['integer', 'bigint'],
  timestamp: ['date'],
  integer: ['boolean'],
}

const rewrites = (from: ColumnType, to: ColumnType): boolean =>
  (REWRITINGS[from] ?? []).includes(to)

/**
 * What a change of type risks (SPEC.md §34).
 *
 * A widening keeps every value, so neither question applies. A rewriting loses the
 * values it converts and refuses nothing. Everything else narrows: some stored value
 * may not fit, and whether the engine cuts it down or refuses the statement is the
 * engine's choice, not the type pair's — PostgreSQL refuses `text -> string` with
 * "value too long" and `text -> enum` with a check violation, where a lax engine
 * would truncate. So an unclassified narrowing raises both warnings rather than
 * guessing which one arrives, and neither is silently answered "no".
 */
const riskOfTypeChange = (from: ColumnType, to: ColumnType): ChangeRisk => {
  if (widens(from, to)) return { destructive: false, mayFailOnExistingRows: false }
  if (rewrites(from, to)) return { destructive: true, mayFailOnExistingRows: false }

  return { destructive: true, mayFailOnExistingRows: true }
}

/**
 * Where each kind of change sits in a migration.
 *
 * Constraints come off first, so nothing holds on to the columns underneath them;
 * structure is created before anything can reference it; and the two changes that
 * take data with them come last, so a migration that is going to fail fails while
 * everything is still there.
 */
const RANK: Readonly<Record<SchemaChange['kind'], number>> = {
  foreignKeyRemoved: 0,
  indexRemoved: 1,
  tableAdded: 2,
  columnAdded: 3,
  columnTypeChanged: 4,
  columnEnumChanged: 5,
  columnNullabilityChanged: 6,
  columnUniquenessChanged: 7,
  primaryKeyMoved: 8,
  indexAdded: 9,
  foreignKeyAdded: 10,
  columnRemoved: 11,
  tableRemoved: 12,
}

/**
 * Keeping one of two objects that share a name would generate a migration for a
 * shape nobody declared, and the mistake would only surface as SQL.
 */
const byName = <T>(
  items: readonly T[],
  nameOf: (item: T) => string,
  what: string,
): Map<string, T> => {
  const found = new Map<string, T>()

  for (const item of items) {
    const name = nameOf(item)

    if (found.has(name)) {
      throw new AssemoraError('DUPLICATE_DESCRIPTOR', `Two ${what} are both named "${name}"`, {
        status: 500,
      })
    }

    found.set(name, item)
  }

  return found
}

const columnsOf = (table: TableDescriptor): Map<string, ColumnDescriptor> =>
  byName(table.columns, (column) => column.name, `columns of "${table.name}"`)

/**
 * The duplicate-column guard, for a table that never reaches the comparison.
 *
 * A table on one side alone is added or dropped whole, so its columns are paired with
 * nothing — and a repeated name is likeliest in a table somebody has just written.
 * The `create table` it produces is refused by PostgreSQL with 42701, long after the
 * declaration that caused it was read.
 */
const assertColumnNamesAreDistinct = (table: TableDescriptor): void => {
  columnsOf(table)
}

const namesOf = (
  before: ReadonlyMap<string, unknown>,
  after: ReadonlyMap<string, unknown>,
): string[] => [...new Set([...before.keys(), ...after.keys()])].sort()

/**
 * A foreign key identified by what it constrains, not by the relation's name.
 *
 * Renaming `author` to `writer` changes no constraint and must produce no migration;
 * pointing it at another table changes one. Two relations that describe the identical
 * constraint are one constraint.
 */
const foreignKeysOf = (table: TableDescriptor): Map<string, RelationDescriptor> => {
  const keys = new Map<string, RelationDescriptor>()

  for (const relation of table.relations) {
    if (relation.kind !== 'belongsTo') continue

    keys.set(`${relation.foreignKey} -> ${relation.target}.${relation.ownerKey}`, relation)
  }

  return keys
}

const columnAdded = (table: string, column: string, after: ColumnDescriptor): ColumnAdded => ({
  kind: 'columnAdded',
  table,
  column,
  after,
  destructive: false,
  // A required column with nothing to put in the rows that already exist is refused
  // rather than filled with a guess. Nothing is lost; the migration is.
  //
  // `hasDefault` cannot excuse it: a model default is applied by the data layer on
  // insert and never reaches the DDL (ADR-0011), so `add column ... not null` meets
  // the existing rows with nothing either way. Reading it here once told somebody
  // that `enumOf('draft', 'published').default('draft')` was safe to add to a table
  // that already held rows, and PostgreSQL answered with 23502.
  mayFailOnExistingRows: !after.isNullable,
})

const columnRemoved = (table: string, column: string, before: ColumnDescriptor): ColumnRemoved => ({
  kind: 'columnRemoved',
  table,
  column,
  before,
  destructive: true,
  mayFailOnExistingRows: false,
})

/** Everything that moved on a column both schemas have. */
const diffColumn = (
  table: string,
  column: string,
  before: ColumnDescriptor,
  after: ColumnDescriptor,
): SchemaChange[] => {
  const changes: SchemaChange[] = []

  if (before.type !== after.type) {
    changes.push({
      kind: 'columnTypeChanged',
      table,
      column,
      before,
      after,
      ...riskOfTypeChange(before.type, after.type),
    })
  } else if (after.type === 'enum') {
    // Only when both sides are enums. Becoming one, or ceasing to be one, is a type
    // change, and the values travel in its descriptors.
    const was = before.enumValues ?? []
    const is = after.enumValues ?? []
    const added = is.filter((value) => !was.includes(value))
    const removed = was.filter((value) => !is.includes(value))

    if (added.length > 0 || removed.length > 0) {
      changes.push({
        kind: 'columnEnumChanged',
        table,
        column,
        before,
        after,
        added,
        removed,
        destructive: false,
        // The new set is what a row is measured against, so the warning belongs to
        // the side that arrives: a column that declared no values constrained
        // nothing, and every row in it may be holding something the set it gains
        // does not allow. Losing the last value is the mirror case — the constraint
        // goes away entirely, and nothing can refuse that.
        mayFailOnExistingRows:
          after.enumValues !== undefined && (removed.length > 0 || before.enumValues === undefined),
      })
    }
  }

  if (before.isNullable !== after.isNullable) {
    changes.push({
      kind: 'columnNullabilityChanged',
      table,
      column,
      before,
      after,
      destructive: false,
      mayFailOnExistingRows: !after.isNullable,
    })
  }

  if (before.isUnique !== after.isUnique) {
    changes.push({
      kind: 'columnUniquenessChanged',
      table,
      column,
      before,
      after,
      destructive: false,
      mayFailOnExistingRows: after.isUnique,
    })
  }

  if (before.isIndexed !== after.isIndexed) {
    changes.push(
      after.isIndexed
        ? {
            kind: 'indexAdded',
            table,
            column,
            after,
            destructive: false,
            mayFailOnExistingRows: false,
          }
        : {
            kind: 'indexRemoved',
            table,
            column,
            before,
            destructive: false,
            mayFailOnExistingRows: false,
          },
    )
  }

  return changes
}

const diffColumns = (
  table: string,
  before: ReadonlyMap<string, ColumnDescriptor>,
  after: ReadonlyMap<string, ColumnDescriptor>,
): SchemaChange[] => {
  const changes: SchemaChange[] = []

  for (const column of namesOf(before, after)) {
    const was = before.get(column)
    const is = after.get(column)

    if (was !== undefined && is !== undefined) changes.push(...diffColumn(table, column, was, is))
    else if (is !== undefined) changes.push(columnAdded(table, column, is))
    else if (was !== undefined) changes.push(columnRemoved(table, column, was))
  }

  return changes
}

const diffTable = (before: TableDescriptor, after: TableDescriptor): SchemaChange[] => {
  const table = after.name
  const changes = diffColumns(table, columnsOf(before), columnsOf(after))

  if (before.primaryKey !== after.primaryKey) {
    changes.push({
      kind: 'primaryKeyMoved',
      table,
      before: before.primaryKey,
      after: after.primaryKey,
      destructive: false,
      // The rows have to be complete and unique on the new column before the database
      // accepts it as a key.
      mayFailOnExistingRows: true,
    })
  }

  const wasKeys = foreignKeysOf(before)
  const isKeys = foreignKeysOf(after)

  for (const key of namesOf(wasKeys, isKeys)) {
    const was = wasKeys.get(key)
    const is = isKeys.get(key)

    if (was !== undefined && is === undefined) {
      changes.push({
        kind: 'foreignKeyRemoved',
        table,
        column: was.foreignKey,
        before: was,
        destructive: false,
        mayFailOnExistingRows: false,
      })
    } else if (was === undefined && is !== undefined) {
      changes.push({
        kind: 'foreignKeyAdded',
        table,
        column: is.foreignKey,
        after: is,
        destructive: false,
        // A row already pointing at something that is not there refuses the
        // constraint.
        mayFailOnExistingRows: true,
      })
    }
  }

  return changes
}

/**
 * What has to happen for `before` to become `after` (SPEC.md §34).
 *
 * Pure, and dialect-neutral by construction: it produces a list of changes, and a
 * generator turns each one into the statements its engine needs.
 */
export const diffSchema = (
  before: readonly TableDescriptor[],
  after: readonly TableDescriptor[],
): SchemaDiff => {
  const was = byName(before, (table) => table.name, 'tables')
  const is = byName(after, (table) => table.name, 'tables')
  const changes: SchemaChange[] = []

  // Every table on both sides, not only the ones that end up being compared.
  for (const table of [...before, ...after]) assertColumnNamesAreDistinct(table)

  for (const name of namesOf(was, is)) {
    const previous = was.get(name)
    const current = is.get(name)

    if (previous !== undefined && current !== undefined) {
      changes.push(...diffTable(previous, current))
    } else if (current !== undefined) {
      changes.push({
        kind: 'tableAdded',
        table: name,
        after: current,
        destructive: false,
        mayFailOnExistingRows: false,
      })
    } else if (previous !== undefined) {
      changes.push({
        kind: 'tableRemoved',
        table: name,
        before: previous,
        destructive: true,
        mayFailOnExistingRows: false,
      })
    }
  }

  // Stable, so the order the changes were produced in — table by table and column by
  // column, both by name — survives inside each rank. Two runs are the same migration
  // byte for byte, and reordering the model registry does not rewrite it.
  return { changes: changes.sort((left, right) => RANK[left.kind] - RANK[right.kind]) }
}

/** Whether applying the diff loses data. What SPEC.md §34 asks for a warning about. */
export const isDestructive = (diff: SchemaDiff): boolean =>
  diff.changes.some((change) => change.destructive)

/**
 * Whether applying the diff can be refused by a table that already holds rows.
 *
 * The other half of the warning: these changes lose nothing, they simply do not run
 * until somebody has filled in or cleaned up what is already stored.
 */
export const mayFailOnExistingRows = (diff: SchemaDiff): boolean =>
  diff.changes.some((change) => change.mayFailOnExistingRows)

const quoteValues = (values: readonly string[]): string =>
  values.map((value) => `"${value}"`).join(', ')

/** How a person names a column: the table it is in, then the field. */
const at = (change: { readonly table: string; readonly column: string }): string =>
  `${change.table}.${change.column}`

/**
 * One change as a sentence a person can act on (SPEC.md §34).
 *
 * The switch has no default: a new kind of change has to be given words before it can
 * reach anybody.
 */
export const describeChange = (change: SchemaChange): string => {
  switch (change.kind) {
    case 'tableAdded':
      return `creates table ${change.table}`
    case 'tableRemoved':
      return `drops table ${change.table}`
    case 'columnAdded':
      return change.mayFailOnExistingRows
        ? // "database" is the load-bearing word: the column may well declare a
          // default, and the person reading this has to learn that the schema does
          // not carry it (ADR-0011) before they can act on the warning.
          `adds required column ${at(change)} with no database default`
        : `adds column ${at(change)}`
    case 'columnRemoved':
      return `drops column ${at(change)}`
    case 'columnTypeChanged':
      return `changes ${at(change)} from ${change.before.type} to ${change.after.type}`
    case 'columnNullabilityChanged':
      return change.after.isNullable
        ? `makes ${at(change)} optional`
        : `makes ${at(change)} required`
    case 'columnUniquenessChanged':
      return change.after.isUnique
        ? `makes ${at(change)} unique`
        : `drops the unique constraint on ${at(change)}`
    case 'columnEnumChanged': {
      const parts = [
        ...(change.added.length > 0 ? [`adds ${quoteValues(change.added)}`] : []),
        ...(change.removed.length > 0 ? [`removes ${quoteValues(change.removed)}`] : []),
      ]

      return `${parts.join(' and ')} on ${at(change)}`
    }
    case 'primaryKeyMoved':
      return `moves the primary key of ${change.table} from ${change.before} to ${change.after}`
    case 'indexAdded':
      return `indexes ${at(change)}`
    case 'indexRemoved':
      return `drops the index on ${at(change)}`
    case 'foreignKeyAdded':
      return `adds a foreign key from ${at(change)} to ${change.after.target}.${change.after.ownerKey}`
    case 'foreignKeyRemoved':
      return `drops the foreign key from ${at(change)} to ${change.before.target}.${change.before.ownerKey}`
  }
}
