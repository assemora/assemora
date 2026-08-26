/**
 * A schema diff turned into PostgreSQL DDL (SPEC.md §34).
 *
 * `assemora db:generate` compares the model registry against the schema already in
 * the database, `diffSchema` in `@assemora/database` says what changed, and this
 * turns that neutral answer into statements. Nothing here reads a descriptor twice or
 * decides on its own what a column looks like in SQL: every statement is assembled
 * from the helpers in `migrations.ts`, so a migration and a fresh `create table` can
 * never disagree about the same column.
 *
 * Four promises hold for everything generated here.
 *
 * Order. The statements apply top to bottom: dependents are dropped before the
 * things they depend on, and tables are created before the foreign keys that point
 * at them. `down` applies top to bottom as well, and is ordered as a migration in its
 * own right rather than by reversing the `up` — the two are not the same thing, and
 * the difference is a `down` that restores a primary key onto a column it has not
 * re-added yet.
 *
 * Reversal. Every `up` statement has a `down` that reverses its *structure*. It
 * never reverses data — a dropped column comes back empty, and the down migration
 * recreates it rather than pretending the rows survived.
 *
 * Honesty. `destructive` carries one sentence per statement that silently changes
 * or destroys stored data: drops, and casts that quietly rewrite values. A statement
 * that merely *fails* on bad data — narrowing a `varchar`, setting `not null` on a
 * column holding nulls, removing a value from an enum — is not listed, because it
 * loses nothing: PostgreSQL rejects it and the transaction rolls back. The list
 * describes `up`; rolling a migration back always discards whatever was written
 * after it, and saying so on every entry would make the warning worthless.
 *
 * Exactly what it says. A generated statement never carries `if exists`,
 * `if not exists` or `cascade` (`SchemaSqlMode` in `migrations.ts` is where that is
 * decided). A migration is written against one known schema, so meeting a different
 * one has to fail rather than quietly do nothing — and `cascade` in particular would
 * drop foreign keys that live on tables the diff never mentioned, which no `down`
 * could rebuild.
 *
 * Where a correct statement cannot be written at all, generation is refused with an
 * error naming the table and the column. A migration that will not generate is an
 * afternoon of work; a cast that quietly corrupts a column is not recoverable.
 */
import { AssemoraError } from '@assemora/core'
import type {
  ColumnDescriptor,
  ColumnType,
  RelationDescriptor,
  SchemaChange,
  TableDescriptor,
} from '@assemora/database'

import {
  addForeignKeySql,
  belongsToRelations,
  checkConstraintName,
  columnSql,
  createIndexSql,
  createTableSql,
  dropIndexSql,
  dropTableSql,
  enumCheckSql,
  foreignKeyName,
  indexedColumns,
  needsIndex,
  primaryKeyName,
  quote,
  sqlType,
  uniqueConstraintName,
} from './migrations.js'
import { toColumnName } from './schema.js'

export type GeneratedMigration = {
  readonly up: readonly string[]
  readonly down: readonly string[]
  /** One sentence per `up` statement that silently changes or destroys data. */
  readonly destructive: readonly string[]
}

/**
 * The order statements apply in.
 *
 * Dependents go first on the way down and last on the way up: a foreign key is
 * dropped before the column it constrains, and added only once every table it can
 * reach exists. A primary key appears twice because it is two statements — the old
 * one has to be off before the column under it can go, and the new one can only be
 * added once the column under it is there.
 */
const PHASES = [
  'drop-foreign-key',
  'drop-primary-key',
  'drop-index',
  'drop-column',
  'drop-table',
  'create-table',
  'add-column',
  'alter-column',
  'add-primary-key',
  'create-index',
  'add-foreign-key',
] as const

type Phase = (typeof PHASES)[number]

/**
 * Where a step's `down` statements belong.
 *
 * A `down` is a migration too, and has to be ordered like one. Reading the `up` order
 * backwards is not the same thing: that only works if every phase's opposite sits at
 * the mirrored index, and it does not. Reversing the list puts the undo of
 * `drop-column` last of all — after the undo of `add-primary-key`, which then names a
 * column that is not back yet.
 */
const INVERSE: Readonly<Record<Phase, Phase>> = {
  'drop-foreign-key': 'add-foreign-key',
  'drop-primary-key': 'add-primary-key',
  'drop-index': 'create-index',
  'drop-column': 'add-column',
  'drop-table': 'create-table',
  'create-table': 'drop-table',
  'add-column': 'drop-column',
  'alter-column': 'alter-column',
  'add-primary-key': 'drop-primary-key',
  'create-index': 'drop-index',
  'add-foreign-key': 'drop-foreign-key',
}

const phaseOrder = (phase: Phase): number => PHASES.indexOf(phase)

type Step = {
  readonly phase: Phase
  readonly up: readonly string[]
  readonly down: readonly string[]
  readonly destructive: readonly string[]
}

const step = (
  phase: Phase,
  parts: {
    readonly up?: readonly string[]
    readonly down?: readonly string[]
    readonly destructive?: readonly string[]
  },
): Step => ({
  phase,
  up: parts.up ?? [],
  down: parts.down ?? [],
  destructive: parts.destructive ?? [],
})

const unsupported = (message: string, details: Record<string, string>): AssemoraError =>
  new AssemoraError('UNSUPPORTED_MIGRATION', message, { details })

const columnRef = (table: string, column: string): string =>
  `${quote(table)}.${quote(toColumnName(column))}`

/** What kind of cast, if any, `alter column ... type` needs to reach the new type. */
type Cast = 'none' | 'direct' | 'using' | 'unsupported'

type Family = 'text' | 'numeric' | 'boolean' | 'temporal' | 'uuid' | 'json' | 'binary'

const FAMILY: Readonly<Record<ColumnType, Family>> = {
  uuid: 'uuid',
  string: 'text',
  text: 'text',
  enum: 'text',
  integer: 'numeric',
  bigint: 'numeric',
  number: 'numeric',
  decimal: 'numeric',
  boolean: 'boolean',
  date: 'temporal',
  timestamp: 'temporal',
  json: 'json',
  binary: 'binary',
}

/**
 * Numeric conversions that cannot change a value, and therefore need no `using`.
 *
 * `bigint -> number` is the pair that looks like a widening and is not: past 2^53 a
 * `double precision` has no bit left for the units, so 9007199254740993 is stored as
 * 9007199254740992 and PostgreSQL says nothing. `decimal` and `number` contain each
 * other in neither direction — `numeric` cannot hold every float and
 * `double precision` cannot hold every decimal exactly — so moving between them is a
 * real conversion.
 */
const NUMERIC_WIDENINGS: Partial<Record<ColumnType, readonly ColumnType[]>> = {
  integer: ['bigint', 'number', 'decimal'],
  bigint: ['decimal'],
  number: ['decimal'],
  decimal: [],
}

/**
 * PostgreSQL applies an *assignment* cast when a column changes type, and refuses
 * the change when no such cast exists. `direct` means one exists and cannot alter a
 * value that fits; `using` means the conversion has to be spelled out.
 *
 * The relation is symmetric — a pair is either castable both ways or neither — so a
 * change that generates an `up` always generates a `down`.
 */
const castFor = (before: ColumnDescriptor, after: ColumnDescriptor): Cast => {
  if (sqlType(before) === sqlType(after)) return 'none'

  const from = FAMILY[before.type]
  const to = FAMILY[after.type]

  if (from === 'binary' || to === 'binary') return 'unsupported'

  if (from === to) {
    switch (from) {
      case 'numeric':
        return (NUMERIC_WIDENINGS[before.type] ?? []).includes(after.type) ? 'direct' : 'using'
      // `varchar(255)` and `text` are the same storage in PostgreSQL; growing is
      // free, and shrinking is left to the assignment cast so a value that does not
      // fit is rejected rather than cut (see `usingType`).
      case 'text':
        return 'direct'
      case 'temporal':
        return after.type === 'timestamp' ? 'direct' : 'using'
      default:
        return 'using'
    }
  }

  // Every type has a text representation and PostgreSQL knows how to read one back.
  if (from === 'text' || to === 'text') return 'using'

  // Booleans convert to integers and back, and to nothing else numeric.
  if (from === 'boolean' || to === 'boolean') {
    return before.type === 'integer' || after.type === 'integer' ? 'using' : 'unsupported'
  }

  return 'unsupported'
}

/**
 * What a `using` expression converts to, which is not always the column's new type.
 *
 * An *explicit* cast to `varchar(n)` truncates silently; the assignment cast
 * PostgreSQL applies to the result of a `using` raises "value too long" instead. So
 * every route into `string` — `json`, `decimal`, `uuid`, `timestamp`, all of them —
 * spells the expression out as `text` and leaves the length to the assignment.
 * Writing `using "payload"::varchar(255)` is how a 412-character JSON document
 * becomes 255 characters with no error and no warning.
 */
const usingType = (after: ColumnDescriptor): string =>
  after.type === 'string' ? 'text' : sqlType(after)

/**
 * Why a cast rewrites values that already fit, if it does.
 *
 * A conversion that merely *fails* on some rows is absent on purpose: it destroys
 * nothing, because PostgreSQL rejects the whole statement.
 */
const silentLoss = (before: ColumnDescriptor, after: ColumnDescriptor): string | undefined => {
  const rounds =
    (before.type === 'decimal' || before.type === 'number') &&
    (after.type === 'integer' || after.type === 'bigint')

  if (rounds) return 'every value is rounded to a whole number'

  if (before.type === 'decimal' && after.type === 'number') {
    return 'exact decimals become the nearest double precision value'
  }

  if (before.type === 'bigint' && after.type === 'number') {
    return 'a whole number past 2^53 becomes the nearest double precision value'
  }

  if (before.type === 'timestamp' && after.type === 'date') return 'the time of day is discarded'

  if (before.type === 'integer' && after.type === 'boolean') {
    return 'only whether a value was zero survives'
  }

  return undefined
}

const alterTypeSql = (
  table: string,
  before: ColumnDescriptor,
  after: ColumnDescriptor,
): readonly string[] => {
  const cast = castFor(before, after)

  if (cast === 'none') return []

  if (cast === 'unsupported') {
    throw unsupported(
      `Cannot change ${columnRef(table, after.name)} from ${sqlType(before)} to ${sqlType(
        after,
      )}: PostgreSQL has no cast between them that is safe to apply to existing rows. Move the data through a new column in a migration written by hand.`,
      { table, column: toColumnName(after.name) },
    )
  }

  const column = quote(toColumnName(after.name))
  const using = cast === 'using' ? ` using ${column}::${usingType(after)}` : ''

  return [`alter table ${quote(table)} alter column ${column} type ${sqlType(after)}${using}`]
}

const nullabilitySql = (table: string, column: ColumnDescriptor, nullable: boolean): string =>
  `alter table ${quote(table)} alter column ${quote(toColumnName(column.name))} ${
    nullable ? 'drop not null' : 'set not null'
  }`

const addUniqueSql = (table: string, column: ColumnDescriptor): string =>
  `alter table ${quote(table)} add constraint ${quote(
    uniqueConstraintName(table, column.name),
  )} unique (${quote(toColumnName(column.name))})`

const dropUniqueSql = (table: string, column: ColumnDescriptor): string =>
  `alter table ${quote(table)} drop constraint ${quote(uniqueConstraintName(table, column.name))}`

const addCheckSql = (table: string, column: ColumnDescriptor): readonly string[] => {
  const check = enumCheckSql(column)

  if (check === undefined) return []

  return [
    `alter table ${quote(table)} add constraint ${quote(
      checkConstraintName(table, column.name),
    )} ${check}`,
  ]
}

const dropCheckSql = (table: string, column: ColumnDescriptor): readonly string[] =>
  enumCheckSql(column) === undefined
    ? []
    : [
        `alter table ${quote(table)} drop constraint ${quote(
          checkConstraintName(table, column.name),
        )}`,
      ]

const dropPrimaryKeySql = (table: string): string =>
  `alter table ${quote(table)} drop constraint ${quote(primaryKeyName(table))}`

const addPrimaryKeySql = (table: string, column: string): string =>
  `alter table ${quote(table)} add constraint ${quote(
    primaryKeyName(table),
  )} primary key (${quote(toColumnName(column))})`

const dropForeignKeySql = (table: string, relation: RelationDescriptor): string =>
  `alter table ${quote(table)} drop constraint ${quote(foreignKeyName(table, relation))}`

const addColumnSql = (table: string, column: ColumnDescriptor): string =>
  `alter table ${quote(table)} add column ${columnSql(column, 'add-column')}`

const dropColumnSql = (table: string, column: ColumnDescriptor): string =>
  `alter table ${quote(table)} drop column ${quote(toColumnName(column.name))}`

/**
 * A type change, and the enum check that travels with it.
 *
 * `enum` and `text` are the same SQL type, so becoming an enum or ceasing to be one
 * moves no data and may emit no `alter column ... type` at all — the check constraint
 * *is* the change. The diff reports it as a type change rather than an enum change,
 * because `columnEnumChanged` needs an enum on both sides, so this is the only place
 * that constraint can be written. Without it `enum -> text` generated an empty
 * migration that reported success while the old values stayed enforced.
 */
const typeChangeStep = (table: string, before: ColumnDescriptor, after: ColumnDescriptor): Step => {
  const loss = silentLoss(before, after)

  return step('alter-column', {
    up: [
      ...dropCheckSql(table, before),
      ...alterTypeSql(table, before, after),
      ...addCheckSql(table, after),
    ],
    down: [
      ...dropCheckSql(table, after),
      ...alterTypeSql(table, after, before),
      ...addCheckSql(table, before),
    ],
    destructive:
      loss === undefined
        ? []
        : [
            `Changing ${columnRef(table, after.name)} from ${sqlType(before)} to ${sqlType(
              after,
            )} rewrites the stored data — ${loss} — and the down migration cannot bring it back.`,
          ],
  })
}

/**
 * A column that cannot be null needs a value for every row that already exists, and
 * a descriptor carries no value: model defaults are applied by the data layer on
 * insert, never written into the DDL (ADR-0011). Guessing one — an empty string, a
 * zero — would put data in the table that nobody asked for. `hasDefault` makes no
 * difference for exactly that reason, and `schema-diff.ts` reads it the same way.
 */
const addColumnSteps = (table: string, column: ColumnDescriptor): readonly Step[] => {
  if (!column.isNullable) {
    throw unsupported(
      `Cannot add ${columnRef(table, column.name)} as not null: there is no database default, so the statement fails on the first existing row. Add the column as nullable, backfill it, and make it required in a migration of its own.`,
      { table, column: toColumnName(column.name) },
    )
  }

  return [
    step('add-column', {
      up: [addColumnSql(table, column)],
      down: [dropColumnSql(table, column)],
    }),
    // `columnSql` writes the uniqueness and the enum check inline, but never the
    // index: on a fresh table `createSchemaSql` emits that as a statement of its own.
    // Emitting it here too is what keeps a migrated database identical to one built
    // from the same registry.
    ...(needsIndex(column)
      ? [
          step('create-index', {
            up: [createIndexSql(table, column.name, 'migration')],
            down: [dropIndexSql(table, column.name, 'migration')],
          }),
        ]
      : []),
  ]
}

const dropColumnSteps = (table: string, column: ColumnDescriptor): readonly Step[] => {
  const empty = `Dropping ${columnRef(table, column.name)} destroys its data; the down migration recreates the column, but empty`

  return [
    step('drop-column', {
      up: [dropColumnSql(table, column)],
      down: [addColumnSql(table, column)],
      destructive: [
        column.isNullable
          ? `${empty}.`
          : `${empty}, and cannot run while the table holds rows because the column is not null.`,
      ],
    }),
    // Dropping the column takes its index with it, so only the reversal needs one —
    // and the reversal has to put the column back first, which is why this sits in
    // the phase it does rather than beside the `add column`.
    ...(needsIndex(column)
      ? [step('drop-index', { down: [createIndexSql(table, column.name, 'migration')] })]
      : []),
  ]
}

/**
 * A dropped table takes its indexes with it, so only the reversal needs those.
 *
 * Its own foreign keys are dropped by name first, and that is what lets the
 * `drop table` do without `cascade`: nothing the diff knows about still points at it.
 * A constraint on a table that *survives* then refuses the drop instead of vanishing
 * into it — which is the honest outcome, because the diff reports nothing about a
 * relation that did not change, and no `down` here could rebuild it.
 */
const dropTableSteps = (descriptor: TableDescriptor): readonly Step[] => [
  step('drop-foreign-key', {
    up: belongsToRelations(descriptor).map((relation) =>
      dropForeignKeySql(descriptor.name, relation),
    ),
    down: belongsToRelations(descriptor).map((relation) =>
      addForeignKeySql(descriptor.name, relation),
    ),
  }),
  step('drop-index', {
    down: indexedColumns(descriptor).map((column) =>
      createIndexSql(descriptor.name, column, 'migration'),
    ),
  }),
  step('drop-table', {
    up: [dropTableSql(descriptor, 'migration')],
    down: [createTableSql(descriptor, 'migration')],
    destructive: [
      `Dropping table ${quote(descriptor.name)} destroys every row in it; the down migration recreates the table, but empty.`,
    ],
  }),
]

const createTableSteps = (descriptor: TableDescriptor): readonly Step[] => [
  step('create-table', {
    up: [createTableSql(descriptor, 'migration')],
    down: [dropTableSql(descriptor, 'migration')],
  }),
  step('create-index', {
    up: indexedColumns(descriptor).map((column) =>
      createIndexSql(descriptor.name, column, 'migration'),
    ),
    down: indexedColumns(descriptor).map((column) =>
      dropIndexSql(descriptor.name, column, 'migration'),
    ),
  }),
  step('add-foreign-key', {
    up: belongsToRelations(descriptor).map((relation) =>
      addForeignKeySql(descriptor.name, relation),
    ),
    down: belongsToRelations(descriptor).map((relation) =>
      dropForeignKeySql(descriptor.name, relation),
    ),
  }),
]

const stepsFor = (change: SchemaChange): readonly Step[] => {
  switch (change.kind) {
    case 'tableAdded':
      return createTableSteps(change.after)
    case 'tableRemoved':
      return dropTableSteps(change.before)
    case 'columnAdded':
      return addColumnSteps(change.table, change.after)
    case 'columnRemoved':
      return dropColumnSteps(change.table, change.before)
    case 'columnTypeChanged':
      return [typeChangeStep(change.table, change.before, change.after)]
    case 'columnNullabilityChanged':
      return [
        step('alter-column', {
          up: [nullabilitySql(change.table, change.after, change.after.isNullable)],
          down: [nullabilitySql(change.table, change.before, change.before.isNullable)],
        }),
      ]
    case 'columnUniquenessChanged':
      return [
        step('alter-column', {
          up: [
            change.after.isUnique
              ? addUniqueSql(change.table, change.after)
              : dropUniqueSql(change.table, change.after),
          ],
          down: [
            change.before.isUnique
              ? addUniqueSql(change.table, change.before)
              : dropUniqueSql(change.table, change.before),
          ],
        }),
      ]
    case 'columnEnumChanged':
      // The column's SQL type does not change with its allowed values — an enum is
      // stored as text — so only the check constraint moves.
      return [
        step('alter-column', {
          up: [
            ...dropCheckSql(change.table, change.before),
            ...addCheckSql(change.table, change.after),
          ],
          down: [
            ...dropCheckSql(change.table, change.after),
            ...addCheckSql(change.table, change.before),
          ],
        }),
      ]
    case 'primaryKeyMoved':
      // Two steps rather than one, because the two halves belong at opposite ends of
      // the migration: the old key has to be off before the column under it can be
      // dropped, and the new one can only be added once its column is there.
      return [
        step('drop-primary-key', {
          up: [dropPrimaryKeySql(change.table)],
          down: [addPrimaryKeySql(change.table, change.before)],
        }),
        step('add-primary-key', {
          up: [addPrimaryKeySql(change.table, change.after)],
          down: [dropPrimaryKeySql(change.table)],
        }),
      ]
    case 'indexAdded':
      return [
        step('create-index', {
          up: [createIndexSql(change.table, change.column, 'migration')],
          down: [dropIndexSql(change.table, change.column, 'migration')],
        }),
      ]
    case 'indexRemoved':
      return [
        step('drop-index', {
          up: [dropIndexSql(change.table, change.column, 'migration')],
          down: [createIndexSql(change.table, change.column, 'migration')],
        }),
      ]
    case 'foreignKeyAdded':
      return [
        step('add-foreign-key', {
          up: [addForeignKeySql(change.table, change.after)],
          down: [dropForeignKeySql(change.table, change.after)],
        }),
      ]
    case 'foreignKeyRemoved':
      return [
        step('drop-foreign-key', {
          up: [dropForeignKeySql(change.table, change.before)],
          down: [addForeignKeySql(change.table, change.before)],
        }),
      ]
  }
}

const distinct = (statements: readonly string[]): readonly string[] => [...new Set(statements)]

/**
 * Everything a table gains or loses when the table itself is created or dropped is
 * already in the `create table` or the `drop table`. A diff that also reports those
 * columns and keys separately would otherwise produce a migration that adds a column
 * the same statement just created.
 */
const isCoveredByItsTable = (change: SchemaChange, wholeTables: ReadonlySet<string>): boolean =>
  change.kind !== 'tableAdded' && change.kind !== 'tableRemoved' && wholeTables.has(change.table)

/** Sorted by phase, stably, so equal phases keep the order the diff produced them in. */
const inOrder = (steps: readonly Step[], phaseOf: (step: Step) => Phase): readonly Step[] =>
  [...steps].sort((left, right) => phaseOrder(phaseOf(left)) - phaseOrder(phaseOf(right)))

/**
 * Turns a schema diff into a migration.
 *
 * ```ts
 * const { up, down, destructive } = migrationSql(diffSchema(before, after).changes)
 * ```
 *
 * Throws when a correct statement cannot be written — a cast PostgreSQL cannot
 * perform, or a required column added to a table that already holds rows.
 */
export const migrationSql = (changes: readonly SchemaChange[]): GeneratedMigration => {
  const wholeTables = new Set(
    changes
      .filter((change) => change.kind === 'tableAdded' || change.kind === 'tableRemoved')
      .map((change) => change.table),
  )

  const steps = changes
    .filter((change) => !isCoveredByItsTable(change, wholeTables))
    .flatMap(stepsFor)

  return {
    up: distinct(inOrder(steps, (entry) => entry.phase).flatMap((entry) => entry.up)),
    down: distinct(inOrder(steps, (entry) => INVERSE[entry.phase]).flatMap((entry) => entry.down)),
    destructive: distinct(
      inOrder(steps, (entry) => entry.phase).flatMap((entry) => entry.destructive),
    ),
  }
}
