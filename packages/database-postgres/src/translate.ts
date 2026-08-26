/**
 * Query AST → Drizzle (SPEC.md §30, §32).
 *
 * The AST is the stable contract; this module is the only translation of it into
 * PostgreSQL. Nothing here leaks back out of the package.
 */
import { AssemoraError } from '@assemora/core'
import type { Comparison, Condition, JsonComparison, Order } from '@assemora/database'
import {
  and,
  asc,
  between,
  desc,
  eq,
  gt,
  gte,
  ilike,
  inArray,
  isNotNull,
  isNull,
  lt,
  lte,
  ne,
  notInArray,
  or,
  type SQL,
  sql,
} from 'drizzle-orm'
import type { PgColumn } from 'drizzle-orm/pg-core'

export type Columns = Readonly<Record<string, PgColumn>>

const columnFor = (columns: Columns, field: string): PgColumn => {
  const column = columns[field]

  if (column === undefined) {
    throw new AssemoraError('UNKNOWN_FIELD', `No column is mapped for "${field}"`, { status: 500 })
  }

  return column
}

const expectArray = (condition: Comparison): readonly unknown[] => {
  if (!Array.isArray(condition.value)) {
    throw new AssemoraError(
      'INVALID_QUERY',
      `Operator "${condition.operator}" needs an array of values`,
      { status: 500 },
    )
  }

  return condition.value
}

const buildComparison = (columns: Columns, condition: Comparison): SQL | undefined => {
  const column = columnFor(columns, condition.field)

  switch (condition.operator) {
    case '=':
      return eq(column, condition.value)
    case '!=':
      return ne(column, condition.value)
    case '>':
      return gt(column, condition.value)
    case '>=':
      return gte(column, condition.value)
    case '<':
      return lt(column, condition.value)
    case '<=':
      return lte(column, condition.value)
    case 'in':
      return inArray(column, [...expectArray(condition)])
    case 'not in':
      return notInArray(column, [...expectArray(condition)])
    case 'like':
      // `ilike`, because the in-memory adapter matches case-insensitively and the
      // same AST has to mean the same thing in both (SPEC.md §30).
      return ilike(column, String(condition.value))
    case 'between': {
      const [from, to] = expectArray(condition)
      return between(column, from, to)
    }
    case 'is null':
      return isNull(column)
    case 'is not null':
      return isNotNull(column)
  }
}

const buildJson = (columns: Columns, condition: JsonComparison): SQL => {
  const column = columnFor(columns, condition.field)
  const document = JSON.stringify(condition.value)

  if (condition.operator === 'contains') {
    return sql`${column} @> ${document}::jsonb`
  }

  if (condition.path.length === 0) {
    return sql`${column} = ${document}::jsonb`
  }

  const path = sql.join(
    condition.path.map((segment) => sql`${segment}`),
    sql`, `,
  )

  // Compared as jsonb, not as text: it is the only way arrays, objects, `null` and
  // scalars all mean here what they mean in the in-memory adapter (SPEC.md §30).
  // `like` stays text-based, because that is what a pattern match is for.
  return condition.operator === 'like'
    ? sql`jsonb_extract_path_text(${column}, ${path}) ilike ${String(condition.value)}`
    : sql`jsonb_extract_path(${column}, ${path}) = ${document}::jsonb`
}

const buildCondition = (columns: Columns, condition: Condition): SQL | undefined => {
  if (condition.kind === 'group') return buildWhere(columns, condition.conditions)
  if (condition.kind === 'json') return buildJson(columns, condition)

  return buildComparison(columns, condition)
}

/**
 * Folds the conditions left to right, exactly as the in-memory adapter does, so the
 * same AST means the same thing in both.
 */
export const buildWhere = (columns: Columns, conditions: readonly Condition[]): SQL | undefined => {
  let combined: SQL | undefined

  for (const condition of conditions) {
    const current = buildCondition(columns, condition)

    if (current === undefined) continue

    combined =
      combined === undefined
        ? current
        : condition.combinator === 'or'
          ? or(combined, current)
          : and(combined, current)
  }

  return combined
}

export const buildOrder = (columns: Columns, order: readonly Order[]): SQL[] =>
  order.map((step) =>
    step.direction === 'desc'
      ? desc(columnFor(columns, step.field))
      : asc(columnFor(columns, step.field)),
  )
