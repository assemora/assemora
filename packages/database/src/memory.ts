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
import { pivotAddress } from './join-table.js'
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
  /**
   * Counters the tests read; not part of ordinary use.
   *
   * `scanCount()` is what `statementCount()` is on the PostgreSQL adapter: one pass
   * over one table. A relation loaded in a batch costs a fixed number of passes
   * however many rows it is loaded for, and one loaded row by row costs a pass per
   * row — which is how SPEC.md §89 asks for an N+1 to be caught.
   */
  readonly diagnostics: {
    scanCount(): number
    reset(): void
  }
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

/**
 * Whether a value can identify a row at all.
 *
 * A null key joins to nothing in SQL — `null = null` is unknown — so a row holding one
 * has no related rows, rather than every row that also holds none.
 */
const isKey = (value: unknown): boolean => value !== null && value !== undefined

/**
 * The bucket a key falls in.
 *
 * Two keys share a bucket exactly when `compare` calls them equal, so relations
 * matched in one pass through an index match the same rows a comparison per row did.
 */
const bucketOf = (value: unknown): string =>
  value instanceof Date ? String(value.getTime()) : String(value)

/**
 * Whether a key value falls in one of the buckets already indexed.
 *
 * A `Map` and a `Set` are both asked this, and a value that is no key at all answers
 * no — otherwise a stored `null` would land in the bucket the text `"null"` occupies.
 */
const isOneOf = (buckets: { has(bucket: string): boolean }, value: unknown): boolean =>
  isKey(value) && buckets.has(bucketOf(value))

const groupByKey = (rows: readonly Row[], key: string): Map<string, Row[]> => {
  const grouped = new Map<string, Row[]>()

  for (const row of rows) {
    const value = row[key]
    if (!isKey(value)) continue

    const bucket = bucketOf(value)
    const existing = grouped.get(bucket)

    if (existing === undefined) grouped.set(bucket, [row])
    else existing.push(row)
  }

  return grouped
}

/**
 * The column on the far table that a join column copies, as the join table declares it.
 *
 * Read back off the derived descriptor rather than worked out again here: which column
 * a pivot points at is decided in one place (`joinTableDescriptor`), and a second
 * opinion is how a load comes to look where no write ever put a row.
 */
const linkedKey = (join: TableDescriptor, column: string): string => {
  const link = join.relations.find((relation) => relation.foreignKey === column)

  if (link === undefined) {
    throw new AssemoraError(
      'INVALID_JOIN_TABLE',
      `The join table "${join.name}" declares no foreign key on "${column}"`,
      { status: 500 },
    )
  }

  return link.ownerKey
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
  let scans = 0

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

  /**
   * One pass over one table, and the only way rows are ever selected.
   *
   * Everything that reads goes through here, so `scanCount()` measures what a query
   * costs: a batched relation load adds a fixed number of passes, and one loaded row
   * by row adds a pass per row (SPEC.md §89).
   */
  const scan = (table: string, keep: (row: Row) => boolean): Row[] => {
    scans += 1

    return store(table).filter(keep)
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

  /**
   * The rows a `belongsToMany` links, in two passes: one over the join table, one over
   * the target (SPEC.md §23).
   *
   * The join table is derived rather than looked up in `related`: no model declares it,
   * so nothing registers a descriptor for it, and deriving it from the same function
   * the DDL and the schema diff use is what makes a load look where a write put the
   * rows (SPEC.md §24).
   */
  const loadThroughJoinTable = (
    rows: readonly Row[],
    table: TableDescriptor,
    relation: RelationDescriptor,
    load: RelationLoad,
    related: Readonly<Record<string, TableDescriptor>>,
  ): void => {
    const target = related[relation.target]

    // Which column of the target the join table copies is the target's own business, so
    // its descriptor has to be to hand. PostgreSQL refuses the same load for the same
    // reason, and assuming `id` here would make the two adapters disagree quietly.
    if (target === undefined) {
      throw new AssemoraError(
        'UNKNOWN_RELATION',
        `The descriptor for "${relation.target}" was not provided`,
        { status: 500 },
      )
    }

    for (const row of rows) row[relation.name] = []

    const owners = groupByKey(rows, relation.ownerKey)
    const anchor = rows.find((row) => isKey(row[relation.ownerKey]))

    if (anchor === undefined) return

    // One row is enough to learn where the links live: the address is the same for
    // every row of the table, and only `ownerValue` differs.
    const pivot = pivotAddress(table, relation, anchor, target)

    const links = scan(
      pivot.table.name,
      (link) => isOneOf(owners, link[pivot.ownerColumn]) && isKey(link[pivot.relatedColumn]),
    )

    /** Which owners hold each target, which is all a join table has to say. */
    const heldBy = new Map<string, string[]>()

    for (const link of links) {
      const ownerBucket = bucketOf(link[pivot.ownerColumn])
      const targetBucket = bucketOf(link[pivot.relatedColumn])
      const existing = heldBy.get(targetBucket)

      if (existing === undefined) heldBy.set(targetBucket, [ownerBucket])
      // The pair is unique in the table `joinTableDescriptor` describes, and nothing
      // enforces that here. Counting a duplicate link twice would load the same role
      // twice where PostgreSQL, holding the constraint, could not have stored it.
      else if (!existing.includes(ownerBucket)) existing.push(ownerBucket)
    }

    if (heldBy.size === 0) return

    const targetKey = linkedKey(pivot.table, pivot.relatedColumn)
    const children = scan(relation.target, (candidate) => isOneOf(heldBy, candidate[targetKey]))
    // A join table has no order of its own, so one has to be chosen or the two
    // adapters answer with the same rows in different orders and every unit test that
    // reads `user.roles[0]` proves nothing about production (ADR-0013). The far key is
    // the column both ends of the link already agree on, and it is what PostgreSQL
    // orders the join by. Sorted through the same comparator every other order in this
    // adapter uses, so a pivot load is ordered the way `order` in the AST is.
    const loaded = sort(loadRelations(children, target, load.nested, related), [
      { field: targetKey, direction: 'asc' },
    ])
    const collected = new Map<string, Row[]>()

    for (const child of loaded) {
      for (const ownerBucket of heldBy.get(bucketOf(child[targetKey])) ?? []) {
        const existing = collected.get(ownerBucket)

        if (existing === undefined) collected.set(ownerBucket, [child])
        else existing.push(child)
      }
    }

    for (const [ownerBucket, matched] of owners) {
      const linked = collected.get(ownerBucket) ?? []
      for (const row of matched) row[relation.name] = linked
    }
  }

  /**
   * Loads relations in batches: one pass per relation, never one per row.
   *
   * SPEC.md §89 asks for N+1 to be caught by tests rather than by review, and
   * `diagnostics.scanCount()` is what those tests read.
   */
  const loadRelations = (
    rows: readonly Row[],
    table: TableDescriptor,
    loads: readonly RelationLoad[],
    related: Readonly<Record<string, TableDescriptor>>,
  ): Row[] => {
    const enriched = rows.map((row) => ({ ...row }))

    for (const load of loads) {
      const relation = relationOf(table, load.relation)

      if (relation.kind === 'belongsToMany') {
        loadThroughJoinTable(enriched, table, relation, load, related)
        continue
      }

      const owned = relation.kind === 'belongsTo'
      const localKey = owned ? relation.foreignKey : relation.ownerKey
      const remoteKey = owned ? relation.ownerKey : relation.foreignKey

      const keys = new Set(
        enriched.filter((row) => isKey(row[localKey])).map((row) => bucketOf(row[localKey])),
      )
      const target = related[relation.target]

      const candidates =
        keys.size === 0
          ? []
          : scan(relation.target, (candidate) => isOneOf(keys, candidate[remoteKey]))

      const loaded =
        target === undefined
          ? candidates.map((candidate) => ({ ...candidate }))
          : loadRelations(candidates, target, load.nested, related)

      const grouped = groupByKey(loaded, remoteKey)

      for (const row of enriched) {
        const value = row[localKey]
        const matched = (isKey(value) ? grouped.get(bucketOf(value)) : undefined) ?? []

        row[relation.name] = relation.kind === 'hasMany' ? matched : (matched[0] ?? null)
      }
    }

    return enriched
  }

  const adapter: MemoryAdapter = {
    async execute<T>(query: QueryAst, context: DatabaseContext): Promise<T> {
      const rows = store(query.model)
      const related = context.related ?? {}

      if (query.operation === 'insert') {
        const inserted = { ...(query.data ?? {}) }
        rows.push(inserted)
        return { ...inserted } as T
      }

      const selected = scan(query.model, (row) => matches(row, query.where))

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

    diagnostics: {
      scanCount: () => scans,
      reset: () => {
        scans = 0
      },
    },
  }

  return adapter
}
