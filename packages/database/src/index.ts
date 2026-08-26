/**
 * `@assemora/database` — the neutral contract between the data layer and a database.
 *
 * It owns the Query AST (SPEC.md §30) and the adapter interface (SPEC.md §31), and
 * nothing in it is specific to any engine. `@assemora/database-postgres` implements
 * the contract with Drizzle inside; the in-memory adapter here implements the same
 * contract for tests and for the phases where PostgreSQL does not exist yet.
 */

export type {
  ColumnDescriptor,
  ColumnType,
  DatabaseAdapter,
  DatabaseContext,
  DatabaseSchema,
  RelationDescriptor,
  RelationKind,
  TableDescriptor,
} from './adapter.js'
export { createMemoryAdapter, type MemoryAdapter, type Row } from './memory.js'
export {
  type Combinator,
  type Comparison,
  type ComparisonOperator,
  type Condition,
  type ConditionGroup,
  comparison,
  emptyQuery,
  group,
  type JsonComparison,
  jsonContains,
  jsonEquals,
  jsonLike,
  type Order,
  orComparison,
  type QueryAst,
  type QueryOperation,
  type RelationLoad,
  type SortDirection,
} from './query-ast.js'
