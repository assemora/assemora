/**
 * In-memory adapter.
 *
 * SPEC.md §109 asks for a memory adapter so the data layer can be built and tested
 * before PostgreSQL exists. It implements the same contract as any other adapter, so
 * a query proven here runs unchanged against `@assemora/database-postgres`.
 *
 * Development and tests only — nothing here is durable.
 */
import { AssemoraError } from '@assemora/core'

import type {
  DatabaseAdapter,
  DatabaseContext,
  DatabaseSchema,
  RelationDescriptor,
  TableDescriptor,
} from './adapter.js'
import type {
  Comparison,
  Condition,
  JsonComparison,
  Order,
  QueryAst,
  RelationLoad,
} from './query-ast.js'

export type Row = Record<string, unknown>

export type MemoryAdapter = DatabaseAdapter & {
  /** The rows a table currently holds, as stored. */
  rows(table: string): readonly Row[]
  seed(table: string, rows: readonly Row[]): void
  reset(): void
}

const compare = (left: unknown, right: unknown): number => {
  if (left === right) return 0
  if (left === null || left === undefined) return -1
  if (right === null || right === undefined) return 1
  if (left instanceof Date && right instanceof Date) return left.getTime() - right.getTime()
  if (typeof left === 'number' && typeof right === 'number') return left - right
  return String(left).localeCompare(String(right))
}

const likeToRegExp = (pattern: string): RegExp =>
  new RegExp(
    `^${pattern
      .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      .replace(/%/g, '.*')
      .replace(/_/g, '.')}$`,
    'i',
  )

const evaluateComparison = (row: Row, condition: Comparison): boolean => {
  const actual = row[condition.field]
  const expected = condition.value

  switch (condition.operator) {
    case '=':
      return compare(actual, expected) === 0
    case '!=':
      return compare(actual, expected) !== 0
    case '>':
      return compare(actual, expected) > 0
    case '>=':
      return compare(actual, expected) >= 0
    case '<':
      return compare(actual, expected) < 0
    case '<=':
      return compare(actual, expected) <= 0
    case 'in':
      return Array.isArray(expected) && expected.some((item) => compare(actual, item) === 0)
    case 'not in':
      return Array.isArray(expected) && !expected.some((item) => compare(actual, item) === 0)
    case 'like':
      return typeof actual === 'string' && likeToRegExp(String(expected)).test(actual)
    case 'between':
      return (
        Array.isArray(expected) &&
        compare(actual, expected[0]) >= 0 &&
        compare(actual, expected[1]) <= 0
      )
    case 'is null':
      return actual === null || actual === undefined
    case 'is not null':
      return actual !== null && actual !== undefined
  }
}

const readPath = (value: unknown, path: readonly string[]): unknown =>
  path.reduce<unknown>(
    (current, key) =>
      typeof current === 'object' && current !== null
        ? (current as Record<string, unknown>)[key]
        : undefined,
    value,
  )

/** A fragment is contained when every leaf it names matches the document. */
const contains = (document: unknown, fragment: unknown): boolean => {
  if (fragment === null || typeof fragment !== 'object') return compare(document, fragment) === 0

  if (Array.isArray(fragment)) {
    return (
      Array.isArray(document) &&
      fragment.every((item) => document.some((candidate) => contains(candidate, item)))
    )
  }

  if (typeof document !== 'object' || document === null) return false

  return Object.entries(fragment).every(([key, value]) =>
    contains((document as Record<string, unknown>)[key], value),
  )
}

/**
 * Structural equality, so a document compares the same way it would in SQL.
 *
 * Comparing through `String()` made `['a','b']` equal to the text `a,b` here and to
 * nothing at all in PostgreSQL — the same Query AST meaning two different things,
 * which is exactly what SPEC.md §30 exists to prevent.
 */
const deepEquals = (left: unknown, right: unknown): boolean => {
  if (left === right) return true
  if (left === null || right === null || left === undefined || right === undefined) return false
  if (typeof left !== 'object' || typeof right !== 'object') return false

  if (Array.isArray(left) || Array.isArray(right)) {
    return (
      Array.isArray(left) &&
      Array.isArray(right) &&
      left.length === right.length &&
      left.every((item, index) => deepEquals(item, right[index]))
    )
  }

  const a = left as Record<string, unknown>
  const b = right as Record<string, unknown>
  const keys = Object.keys(a)

  return keys.length === Object.keys(b).length && keys.every((key) => deepEquals(a[key], b[key]))
}

const evaluateJson = (row: Row, condition: JsonComparison): boolean => {
  const document = row[condition.field]

  if (condition.operator === 'contains') return contains(document, condition.value)

  const value = readPath(document, condition.path)

  if (condition.operator === 'like') {
    return typeof value === 'string' && likeToRegExp(String(condition.value)).test(value)
  }

  return deepEquals(value, condition.value)
}

const evaluate = (row: Row, condition: Condition): boolean => {
  if (condition.kind === 'group') return matches(row, condition.conditions)
  if (condition.kind === 'json') return evaluateJson(row, condition)

  return evaluateComparison(row, condition)
}

const matches = (row: Row, conditions: readonly Condition[]): boolean => {
  let result = true

  for (const [index, condition] of conditions.entries()) {
    const value = evaluate(row, condition)
    if (index === 0) {
      result = value
    } else {
      result = condition.combinator === 'or' ? result || value : result && value
    }
  }

  return result
}

const sort = (rows: Row[], order: readonly Order[]): Row[] =>
  order.length === 0
    ? rows
    : [...rows].sort((left, right) => {
        for (const step of order) {
          const difference = compare(left[step.field], right[step.field])
          if (difference !== 0) return step.direction === 'desc' ? -difference : difference
        }
        return 0
      })

export const createMemoryAdapter = (
  seed: Readonly<Record<string, readonly Row[]>> = {},
): MemoryAdapter => {
  const tables = new Map<string, Row[]>()

  for (const [table, rows] of Object.entries(seed)) {
    tables.set(
      table,
      rows.map((row) => ({ ...row })),
    )
  }

  const store = (table: string): Row[] => {
    const existing = tables.get(table)
    if (existing !== undefined) return existing

    const created: Row[] = []
    tables.set(table, created)
    return created
  }

  const relationOf = (table: TableDescriptor, name: string): RelationDescriptor => {
    const relation = table.relations.find((candidate) => candidate.name === name)

    if (relation === undefined) {
      throw new AssemoraError(
        'UNKNOWN_RELATION',
        `Table "${table.name}" has no relation "${name}"`,
        { status: 500 },
      )
    }

    return relation
  }

  const loadRelations = (
    rows: readonly Row[],
    table: TableDescriptor,
    loads: readonly RelationLoad[],
    related: Readonly<Record<string, TableDescriptor>>,
  ): Row[] =>
    rows.map((row) => {
      const enriched: Row = { ...row }

      for (const load of loads) {
        const relation = relationOf(table, load.relation)

        if (relation.kind === 'belongsToMany') {
          throw new AssemoraError(
            'UNSUPPORTED_RELATION',
            'The memory adapter does not load belongsToMany relations yet',
            { status: 501 },
          )
        }

        const targetTable = related[relation.target]
        const candidates = store(relation.target).filter((candidate) =>
          relation.kind === 'belongsTo'
            ? compare(candidate[relation.ownerKey], row[relation.foreignKey]) === 0
            : compare(candidate[relation.foreignKey], row[relation.ownerKey]) === 0,
        )

        const nested =
          load.nested.length > 0 && targetTable !== undefined
            ? loadRelations(candidates, targetTable, load.nested, related)
            : candidates.map((candidate) => ({ ...candidate }))

        enriched[relation.name] = relation.kind === 'hasMany' ? nested : (nested[0] ?? null)
      }

      return enriched
    })

  const adapter: MemoryAdapter = {
    async execute<T>(query: QueryAst, context: DatabaseContext): Promise<T> {
      const rows = store(query.model)
      const related = context.related ?? {}

      if (query.operation === 'insert') {
        const inserted = { ...(query.data ?? {}) }
        rows.push(inserted)
        return { ...inserted } as T
      }

      const selected = rows.filter((row) => matches(row, query.where))

      if (query.operation === 'count') return selected.length as T

      if (query.operation === 'delete') {
        for (const row of selected) {
          const index = rows.indexOf(row)
          if (index >= 0) rows.splice(index, 1)
        }
        return selected.length as T
      }

      if (query.operation === 'update') {
        for (const row of selected) Object.assign(row, query.data ?? {})
        return selected.length as T
      }

      const ordered = sort(selected, query.order)
      const offset = query.offset ?? 0
      const limited =
        query.limit === undefined
          ? ordered.slice(offset)
          : ordered.slice(offset, offset + query.limit)

      const materialised = limited.map((row) => ({ ...row }))

      return (
        query.with.length > 0
          ? loadRelations(materialised, context.table, query.with, related)
          : materialised
      ) as T
    },

    async transaction<T>(callback: () => Promise<T>): Promise<T> {
      const snapshot = new Map<string, Row[]>()
      for (const [table, rows] of tables)
        snapshot.set(
          table,
          rows.map((row) => ({ ...row })),
        )

      try {
        return await callback()
      } catch (error) {
        // A failed transaction leaves nothing behind, exactly as a real one would.
        tables.clear()
        for (const [table, rows] of snapshot) tables.set(table, rows)
        throw error
      }
    },

    introspect(): Promise<DatabaseSchema> {
      return Promise.resolve({ tables: [] })
    },

    rows(table) {
      return store(table).map((row) => ({ ...row }))
    },

    seed(table, rows) {
      tables.set(
        table,
        rows.map((row) => ({ ...row })),
      )
    },

    reset() {
      tables.clear()
    },
  }

  return adapter
}
