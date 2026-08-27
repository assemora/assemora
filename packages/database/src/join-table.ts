/**
 * Join tables (SPEC.md §23, §24).
 *
 * `belongsToMany` is the one relation that stores nothing on either table it links:
 * the pairs live in a third table no model declares. Three subsystems need that
 * table — the data layer writes the pivot verbs to it, the DDL creates it, the diff
 * notices it arriving — and deriving it three times is how they come to disagree. So
 * it is derived once, here, as an ordinary `TableDescriptor`. Everything that already
 * knows what to do with a table knows what to do with this one, and a pivot write is
 * an ordinary insert through the Query AST rather than an operation of its own
 * (ADR-0001, ADR-0013).
 *
 * The derivation is symmetric on purpose. Both sides of a mutual `belongsToMany`
 * derive the same name, the same two columns in the same order and the same foreign
 * keys, so a schema holding `users.roles` and `roles.users` holds one join table
 * rather than two that disagree.
 */
import { AssemoraError } from '@assemora/core'

import type {
  ColumnDescriptor,
  ColumnType,
  RelationDescriptor,
  TableDescriptor,
} from './adapter.js'

/**
 * `users` → `userId`. Crude on purpose, and the same rule a `hasMany` foreign key
 * follows, so a join column is named the way every other reference to that table is.
 * `foreignPivotKey` and `relatedPivotKey` are there for where it does not fit.
 */
const pivotColumnFor = (table: string): string =>
  `${table.endsWith('s') ? table.slice(0, -1) : table}Id`

/**
 * What a key column holds when the descriptor holding it is not to hand.
 *
 * `model()` names `id` as the primary key of a table that marks no column primary,
 * and a primary key nobody typed is a `uuid` in every starter (SPEC.md §17).
 */
const DEFAULT_KEY = 'id'
const DEFAULT_KEY_TYPE: ColumnType = 'uuid'

/** One end of the link: a table, the column in the join table that points at it. */
type Side = {
  readonly table: string
  /** The join table column holding this table's key. */
  readonly column: string
  /** The column on `table` that key is copied from. */
  readonly key: string
  readonly type: ColumnType
}

const typeOfKey = (table: TableDescriptor | undefined, key: string): ColumnType =>
  table?.columns.find((column) => column.name === key)?.type ?? DEFAULT_KEY_TYPE

const assertBelongsToMany = (owner: TableDescriptor, relation: RelationDescriptor): void => {
  if (relation.kind === 'belongsToMany') return

  throw new AssemoraError(
    'NOT_A_JOIN_TABLE',
    `"${owner.name}.${relation.name}" is a ${relation.kind} relation, and only belongsToMany is stored in a join table`,
    { status: 500 },
  )
}

/**
 * The two ends of the link, in the order they were declared in.
 *
 * `ownerKey` means here what it means for every other kind — the column on the owner
 * that the reference points at — so the only thing `belongsToMany` needs of its own is
 * a name for each of the two join columns.
 *
 * `target` is optional because a relation names the other table but does not carry it.
 * Passing it is what makes the related column take the type of the key it holds;
 * `withJoinTables` always does, and a caller with one table in its hand gets the
 * default rather than an error.
 */
const sidesOf = (
  owner: TableDescriptor,
  relation: RelationDescriptor,
  target?: TableDescriptor,
): { readonly owner: Side; readonly related: Side } => {
  assertBelongsToMany(owner, relation)

  const relatedKey = target?.primaryKey ?? DEFAULT_KEY

  const sides = {
    owner: {
      table: owner.name,
      column: relation.foreignPivotKey ?? pivotColumnFor(owner.name),
      key: relation.ownerKey,
      type: typeOfKey(owner, relation.ownerKey),
    },
    related: {
      table: relation.target,
      column: relation.relatedPivotKey ?? pivotColumnFor(relation.target),
      key: relatedKey,
      type: typeOfKey(target, relatedKey),
    },
  }

  if (sides.owner.column === sides.related.column) {
    throw new AssemoraError(
      'INVALID_JOIN_TABLE',
      `The join table for "${owner.name}.${relation.name}" would hold two columns named "${sides.owner.column}", ` +
        'so the two sides of the link cannot be told apart. Name them with `foreignPivotKey` and ' +
        '`relatedPivotKey` — a relation whose target is its own table always has to.',
      { status: 500 },
    )
  }

  return sides
}

/**
 * The two ends in a canonical order, which is what makes the derivation symmetric.
 *
 * Sorted by table name, and by column name where one table links to itself: both
 * declarations of a mutual relation then produce the identical descriptor, down to the
 * order of the columns, so `withJoinTables` can recognise them as one table instead of
 * reporting two.
 *
 * Compared by code point rather than by `localeCompare`, because the name this decides
 * is written into a migration and read back on another machine. A locale is not a
 * shared fact, and one that orders two tables the other way round would rename a table
 * that nobody touched.
 */
const ordered = (first: Side, second: Side): readonly [Side, Side] => {
  const inOrder =
    first.table === second.table ? first.column <= second.column : first.table < second.table

  return inOrder ? [first, second] : [second, first]
}

const pivotColumn = (side: Side): ColumnDescriptor => ({
  name: side.column,
  type: side.type,
  isPrimary: false,
  isNullable: false,
  // Neither key is unique on its own — a user holds many roles and a role many users.
  // Only the pair is, and `uniqueTogether` on the table is what says so.
  isUnique: false,
  // The foreign key below brings the index with it: a generator indexes the
  // referencing side of every relation it creates, and a second index on the same
  // column would only cost writes.
  isIndexed: false,
  hasDefault: false,
})

/**
 * A `belongsTo` per side, so the join table is created with real foreign keys.
 *
 * Without them a deleted role leaves its pivot rows behind, and the next load of
 * `user.roles` returns ids pointing at nothing. It also means every generator that
 * already turns a `belongsTo` into a constraint and an index needs nothing new.
 *
 * The relation is named after its column rather than after the table it points at: a
 * table linked to itself has two sides with the same target, and a descriptor holding
 * two relations of one name is one that nothing can address.
 */
const pivotRelation = (side: Side): RelationDescriptor => ({
  name: side.column,
  kind: 'belongsTo',
  target: side.table,
  foreignKey: side.column,
  ownerKey: side.key,
})

const describeJoinTable = (
  sides: { readonly owner: Side; readonly related: Side },
  through: string | undefined,
): TableDescriptor => {
  const [first, second] = ordered(sides.owner, sides.related)

  return {
    name: through ?? `${first.table}_${second.table}`,
    // A join table has no key of its own: the pair is its identity, and `primaryKey`
    // names a single column. Naming half the pair would tell a generator to make one
    // side unique, which is the opposite of what a link table is for.
    primaryKey: '',
    columns: [pivotColumn(first), pivotColumn(second)],
    relations: [pivotRelation(first), pivotRelation(second)],
    uniqueTogether: [[first.column, second.column]],
  }
}

/**
 * The join table a `belongsToMany` is stored in (SPEC.md §23).
 *
 * Named by `through` when the relation declares one, and by the two table names
 * otherwise — sorted, so both sides of a mutual relation name the same table.
 *
 * ```ts
 * joinTableDescriptor(User.descriptor, rolesRelation, Role.descriptor)
 * // { name: 'roles_users', columns: [roleId, userId], uniqueTogether: [['roleId', 'userId']] }
 * ```
 */
export const joinTableDescriptor = (
  owner: TableDescriptor,
  relation: RelationDescriptor,
  target?: TableDescriptor,
): TableDescriptor => describeJoinTable(sidesOf(owner, relation, target), relation.through)

/**
 * Where one row's links live, and what identifies them.
 *
 * Everything the pivot verbs of SPEC.md §24 need, and nothing an adapter has to learn:
 * `attach` is an insert of the two columns, `detach` a delete of the two conditions,
 * `sync` both inside one transaction — all of it ordinary Query AST.
 */
export type PivotAddress = {
  /** The join table, ready to be handed to `DatabaseContext.table`. */
  readonly table: TableDescriptor
  /** The column holding the owner's key. */
  readonly ownerColumn: string
  /** The column holding the related row's key. */
  readonly relatedColumn: string
  /** What the owner's row stores in the key the link points at. */
  readonly ownerValue: unknown
}

/**
 * Addresses the join table for one row (SPEC.md §24).
 *
 * ```ts
 * const pivot = pivotAddress(User.descriptor, roles, user.toJSON(), Role.descriptor)
 *
 * await adapter.execute(
 *   {
 *     ...emptyQuery(pivot.table.name, 'insert'),
 *     data: { [pivot.ownerColumn]: pivot.ownerValue, [pivot.relatedColumn]: roleId },
 *   },
 *   { table: pivot.table },
 * )
 * ```
 */
export const pivotAddress = (
  owner: TableDescriptor,
  relation: RelationDescriptor,
  row: Readonly<Record<string, unknown>>,
  target?: TableDescriptor,
): PivotAddress => {
  const sides = sidesOf(owner, relation, target)
  const ownerValue = row[sides.owner.key]

  // A link to a row that was never stored points at nothing, and inserting it writes a
  // pivot row no read can ever join. Refusing here catches it once for every caller.
  if (ownerValue === undefined || ownerValue === null) {
    throw new AssemoraError(
      'UNSAVED_RECORD',
      `Cannot address "${owner.name}.${relation.name}": the row has no ${sides.owner.key}. Save it first.`,
      { status: 409 },
    )
  }

  return {
    table: describeJoinTable(sides, relation.through),
    ownerColumn: sides.owner.column,
    relatedColumn: sides.related.column,
    ownerValue,
  }
}

/** What two derivations of one join table have to agree on, as one sentence. */
const signatureOf = (table: TableDescriptor): string =>
  table.relations
    .map((relation) => `${relation.foreignKey} -> ${relation.target}.${relation.ownerKey}`)
    .join(', ')

/**
 * Everything about a table that is not its name, written down in a fixed order.
 *
 * Two descriptors that agree on this describe the identical table. Used to recognise
 * a derived join table handed back to `withJoinTables` — the expansion is idempotent,
 * so the join table it added last time arrives among the declared ones and must not be
 * mistaken for a model of it.
 */
const shapeOf = (table: TableDescriptor): string =>
  [
    table.primaryKey,
    table.softDeleteColumn ?? '',
    table.columns
      .map(
        (column) =>
          `${column.name}:${column.type}:${column.isPrimary}:${column.isNullable}:` +
          `${column.isUnique}:${column.isIndexed}:${column.hasDefault}`,
      )
      .join(','),
    table.relations
      .map(
        (relation) =>
          `${relation.name}:${relation.kind}:${relation.target}:${relation.foreignKey}:${relation.ownerKey}`,
      )
      .join(','),
    (table.uniqueTogether ?? []).map((group) => group.join('+')).join(','),
  ].join(' | ')

/**
 * The tables a schema really has: the declared ones, plus a join table per
 * `belongsToMany` (SPEC.md §23, §34).
 *
 * Idempotent, and that is what makes it safe to call anywhere. A join table declares
 * no `belongsToMany` of its own, so expanding an expanded schema adds nothing — a
 * snapshot that already holds the join table compares clean against a registry that
 * derives it.
 *
 * A model declared for a table a relation derives is refused, rather than allowed to
 * win. Only the DDL would ever read it: the pivot verbs of SPEC.md §24 write the two
 * derived columns and nothing else, so a declared pivot carrying a surrogate key or a
 * `joinedAt` is a table `attach` cannot fill, and one carrying exactly the two keys is
 * a second descriptor for a name the adapter already builds. Keeping the declaration
 * for the DDL and deriving the writes is the disagreement this whole file exists to
 * prevent — a pivot with columns of its own is a model like any other, and it is
 * declared with two `belongsTo` relations rather than with `through`.
 */
export const withJoinTables = (tables: readonly TableDescriptor[]): readonly TableDescriptor[] => {
  const declared = new Map(tables.map((table) => [table.name, table]))
  const derived = new Map<string, { readonly table: TableDescriptor; readonly from: string }>()

  for (const owner of tables) {
    for (const relation of owner.relations) {
      if (relation.kind !== 'belongsToMany') continue

      const from = `${owner.name}.${relation.name}`
      const table = joinTableDescriptor(owner, relation, declared.get(relation.target))
      const model = declared.get(table.name)

      if (model !== undefined) {
        // The expansion is idempotent, so the join table added by an earlier call
        // arrives here among the declared tables. It is this derivation, not a model
        // of it, and it is skipped exactly as it was before there was a rule.
        if (shapeOf(model) === shapeOf(table)) continue

        throw new AssemoraError(
          'DECLARED_JOIN_TABLE',
          `"${from}" derives the join table "${table.name}", and a model declares it too. ` +
            'A derived pivot holds the two key columns and nothing else, which is all `attach`, ' +
            '`detach` and `sync` write — so a model of it is a table those verbs cannot fill. ' +
            'Either drop the model and let the relation derive the table, or keep the model, ' +
            'give it two `belongsTo` relations and address it as an ordinary table instead of ' +
            'through `belongsToMany`.',
          { status: 500 },
        )
      }

      const existing = derived.get(table.name)

      if (existing === undefined) {
        derived.set(table.name, { table, from })
        continue
      }

      // Both sides of a mutual relation derive the same table from the same two model
      // names, so a disagreement is always an override stated on one side only. Left
      // alone it reaches the schema diff as two tables with one name, and is reported
      // there as a duplicate descriptor rather than as the declaration that caused it.
      if (signatureOf(existing.table) !== signatureOf(table)) {
        throw new AssemoraError(
          'CONFLICTING_JOIN_TABLE',
          `"${existing.from}" and "${from}" describe the join table "${table.name}" differently: ` +
            `(${signatureOf(existing.table)}) against (${signatureOf(table)}). ` +
            'Mirror `through`, `foreignPivotKey`, `relatedPivotKey` and `ownerKey` on both sides, ' +
            'or declare a model for the join table.',
          { status: 500 },
        )
      }
    }
  }

  if (derived.size === 0) return tables

  return [...tables, ...[...derived.values()].map((entry) => entry.table)]
}
