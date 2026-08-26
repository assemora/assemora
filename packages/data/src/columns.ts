/**
 * Column DSL (SPEC.md §17).
 *
 * A column is a schema plus what the database needs to know about it. The schema
 * carries the type, so `typeof Model.$infer` follows from the declaration alone
 * (SPEC.md §18).
 */
import type { ColumnType } from '@assemora/database'
import {
  bigint as bigintSchema,
  binary as binarySchema,
  boolean as booleanSchema,
  enumOf as enumSchema,
  integer as integerSchema,
  json as jsonSchema,
  number as numberSchema,
  type ParseResult,
  type Schema,
  string as stringSchema,
  timestamp as timestampSchema,
  uuid as uuidSchema,
} from '@assemora/schema'

export type ColumnState<T> = {
  readonly type: ColumnType
  readonly schema: Schema<T>
  readonly isPrimary: boolean
  readonly isNullable: boolean
  readonly isUnique: boolean
  readonly isIndexed: boolean
  readonly isHidden: boolean
  readonly hasDefault: boolean
  readonly defaultValue: unknown
  readonly usesRandomDefault: boolean
  readonly timestampRole: 'created' | 'updated' | undefined
  readonly enumValues: readonly string[] | undefined
  readonly transform: ((value: T) => T) | undefined
}

export type Column<T = unknown> = ColumnState<T> & {
  readonly node: 'column'
}

/**
 * Any column, for places that only need the metadata.
 *
 * Written structurally rather than as `Column<never>`: a supertype has to accept
 * `Column<string>` and `Column<Date | null>` alike, which only the widened schema
 * and the contravariant transform allow.
 */
export type AnyColumn = {
  readonly node: 'column'
  readonly type: ColumnType
  readonly schema: Schema<unknown>
  readonly isPrimary: boolean
  readonly isNullable: boolean
  readonly isUnique: boolean
  readonly isIndexed: boolean
  readonly isHidden: boolean
  readonly hasDefault: boolean
  readonly defaultValue: unknown
  readonly usesRandomDefault: boolean
  readonly timestampRole: 'created' | 'updated' | undefined
  readonly enumValues: readonly string[] | undefined
  readonly transform: ((value: never) => unknown) | undefined
}

/** The value a column holds. */
export type ColumnValue<C> = C extends { readonly schema: Schema<infer T> } ? T : never

const nullableSchema = <T>(schema: Schema<T>): Schema<T | null> => ({
  ...schema,
  isNullable: true,
  parse: (value: unknown): ParseResult<T | null> =>
    value === null ? { ok: true, value: null } : schema.parse(value),
  toJsonSchema: () => ({ ...schema.toJsonSchema(), nullable: true }),
})

/** Widening a column to nullable widens its schema and its transform with it. */
const toNullable = <T>(state: ColumnState<T>): ColumnState<T | null> => {
  const transform = state.transform

  return {
    ...state,
    isNullable: true,
    schema: nullableSchema(state.schema),
    transform:
      transform === undefined
        ? undefined
        : (value: T | null) => (value === null ? null : transform(value)),
  }
}

const start = <T>(type: ColumnType, schema: Schema<T>): ColumnState<T> => ({
  type,
  schema,
  isPrimary: false,
  isNullable: false,
  isUnique: false,
  isIndexed: false,
  isHidden: false,
  hasDefault: false,
  defaultValue: undefined,
  usesRandomDefault: false,
  timestampRole: undefined,
  enumValues: undefined,
  transform: undefined,
})

// --- the general builder -----------------------------------------------------

export type ColumnBuilder<T> = Column<T> & {
  primary(): ColumnBuilder<T>
  unique(): ColumnBuilder<T>
  index(): ColumnBuilder<T>
  /** Keeps the column out of serialized output (SPEC.md §28). */
  hidden(): ColumnBuilder<T>
  nullable(): ColumnBuilder<T | null>
  default(value: T): ColumnBuilder<T>
  /** Normalises a value on the way in (SPEC.md §27). */
  set(transform: (value: T) => T): ColumnBuilder<T>
}

const column = <T>(state: ColumnState<T>): ColumnBuilder<T> => ({
  ...state,
  node: 'column',
  primary: () => column({ ...state, isPrimary: true }),
  unique: () => column({ ...state, isUnique: true }),
  index: () => column({ ...state, isIndexed: true }),
  hidden: () => column({ ...state, isHidden: true }),
  nullable: () => column(toNullable(state)),
  default: (value) => column({ ...state, hasDefault: true, defaultValue: value }),
  set: (transform) => column({ ...state, transform }),
})

// --- uuid --------------------------------------------------------------------

export type UuidColumnBuilder = Column<string> & {
  primary(): UuidColumnBuilder
  unique(): UuidColumnBuilder
  index(): UuidColumnBuilder
  hidden(): UuidColumnBuilder
  nullable(): ColumnBuilder<string | null>
  default(value: string): UuidColumnBuilder
  /** Generates a value when none is given. */
  defaultRandom(): UuidColumnBuilder
}

const uuidColumn = (state: ColumnState<string>): UuidColumnBuilder => ({
  ...state,
  node: 'column',
  primary: () => uuidColumn({ ...state, isPrimary: true }),
  unique: () => uuidColumn({ ...state, isUnique: true }),
  index: () => uuidColumn({ ...state, isIndexed: true }),
  hidden: () => uuidColumn({ ...state, isHidden: true }),
  nullable: () => column(toNullable(state)),
  default: (value) => uuidColumn({ ...state, hasDefault: true, defaultValue: value }),
  defaultRandom: () => uuidColumn({ ...state, hasDefault: true, usesRandomDefault: true }),
})

// --- timestamp ---------------------------------------------------------------

export type TimestampColumnBuilder = Column<Date> & {
  primary(): TimestampColumnBuilder
  unique(): TimestampColumnBuilder
  index(): TimestampColumnBuilder
  hidden(): TimestampColumnBuilder
  nullable(): ColumnBuilder<Date | null>
  default(value: Date): TimestampColumnBuilder
  /** Filled when the row is created. */
  created(): TimestampColumnBuilder
  /** Refreshed on every write. */
  updated(): TimestampColumnBuilder
}

const timestampColumn = (state: ColumnState<Date>): TimestampColumnBuilder => ({
  ...state,
  node: 'column',
  primary: () => timestampColumn({ ...state, isPrimary: true }),
  unique: () => timestampColumn({ ...state, isUnique: true }),
  index: () => timestampColumn({ ...state, isIndexed: true }),
  hidden: () => timestampColumn({ ...state, isHidden: true }),
  nullable: () => column(toNullable(state)),
  default: (value) => timestampColumn({ ...state, hasDefault: true, defaultValue: value }),
  created: () => timestampColumn({ ...state, timestampRole: 'created', hasDefault: true }),
  updated: () => timestampColumn({ ...state, timestampRole: 'updated', hasDefault: true }),
})

// --- the column vocabulary of SPEC.md §17 ------------------------------------

export const uuid = (): UuidColumnBuilder => uuidColumn(start('uuid', uuidSchema()))

export const string = (): ColumnBuilder<string> => column(start('string', stringSchema()))

export const text = (): ColumnBuilder<string> => column(start('text', stringSchema()))

export const integer = (): ColumnBuilder<number> => column(start('integer', integerSchema()))

export const bigint = (): ColumnBuilder<bigint> => column(start('bigint', bigintSchema()))

export const number = (): ColumnBuilder<number> => column(start('number', numberSchema()))

/**
 * Decimal values are carried as strings so that no rounding happens on the way
 * through JavaScript, and PostgreSQL's `numeric` returns them the same way. SPEC.md
 * §18 shows a `Decimal` value type instead; it has no owner yet, and introducing one
 * is a decision of its own rather than a side effect of the adapter.
 */
export const decimal = (): ColumnBuilder<string> => column(start('decimal', stringSchema()))

export const boolean = (): ColumnBuilder<boolean> => column(start('boolean', booleanSchema()))

export const date = (): ColumnBuilder<Date> => column(start('date', timestampSchema()))

export const timestamp = (): TimestampColumnBuilder =>
  timestampColumn(start('timestamp', timestampSchema()))

/**
 * A JSON document. The marker lets the query builder accept `whereJson` only where
 * a JSON document actually lives.
 */
export type JsonColumnBuilder<T> = Column<T> & {
  readonly isJson: true
  primary(): JsonColumnBuilder<T>
  unique(): JsonColumnBuilder<T>
  index(): JsonColumnBuilder<T>
  hidden(): JsonColumnBuilder<T>
  nullable(): JsonColumnBuilder<T | null>
  default(value: T): JsonColumnBuilder<T>
  set(transform: (value: T) => T): JsonColumnBuilder<T>
}

const jsonColumn = <T>(state: ColumnState<T>): JsonColumnBuilder<T> => ({
  ...state,
  node: 'column',
  isJson: true,
  primary: () => jsonColumn({ ...state, isPrimary: true }),
  unique: () => jsonColumn({ ...state, isUnique: true }),
  index: () => jsonColumn({ ...state, isIndexed: true }),
  hidden: () => jsonColumn({ ...state, isHidden: true }),
  nullable: () => jsonColumn(toNullable(state)),
  default: (value) => jsonColumn({ ...state, hasDefault: true, defaultValue: value }),
  set: (transform) => jsonColumn({ ...state, transform }),
})

export const json = <T = unknown>(): JsonColumnBuilder<T> =>
  jsonColumn(start('json', jsonSchema<T>()))

export const enumOf = <const V extends readonly [string, ...string[]]>(
  ...values: V
): ColumnBuilder<V[number]> =>
  column({ ...start('enum', enumSchema(...values)), enumValues: values })

export const binary = (): ColumnBuilder<Uint8Array> => column(start('binary', binarySchema()))
