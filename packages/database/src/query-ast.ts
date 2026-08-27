/**
 * Query AST (SPEC.md §30).
 *
 * The query builder never constructs adapter queries directly; it produces this
 * neutral description instead. That keeps one stable contract between Assemora Data,
 * database adapters, the policy layer and the AI query layer — and it is why an
 * agent expresses a selection as structure rather than as SQL (SPEC.md §85).
 */

export type ComparisonOperator =
  | '='
  | '!='
  | '>'
  | '>='
  | '<'
  | '<='
  | 'in'
  | 'not in'
  /** Case-insensitive, in every adapter: it exists to serve search. */
  | 'like'
  | 'between'
  | 'is null'
  | 'is not null'

export type Combinator = 'and' | 'or'

export type Comparison = {
  readonly kind: 'comparison'
  readonly combinator: Combinator
  readonly field: string
  readonly operator: ComparisonOperator
  readonly value?: unknown
}

/** A parenthesised set of conditions, produced by `where(q => ...)`. */
export type ConditionGroup = {
  readonly kind: 'group'
  readonly combinator: Combinator
  readonly conditions: readonly Condition[]
}

/**
 * A condition on a JSON document (SPEC.md §38).
 *
 * `path` addresses a key inside the document; an empty path means the document
 * itself. `contains` asks whether the document includes the given fragment.
 */
export type JsonComparison = {
  readonly kind: 'json'
  readonly combinator: Combinator
  readonly field: string
  readonly path: readonly string[]
  readonly operator: 'equals' | 'contains' | 'like'
  readonly value: unknown
}

export type Condition = Comparison | ConditionGroup | JsonComparison

export type SortDirection = 'asc' | 'desc'

export type Order = {
  readonly field: string
  readonly direction: SortDirection
}

/**
 * A relation to load alongside the row, addressed by its declared name.
 *
 * A load carries no order of its own — `order` above sorts the rows the query
 * selects, not the rows hanging off them. One exception is stated rather than left to
 * the adapter: a `belongsToMany` arrives ordered by the *target's* key, ascending.
 * A join table has no natural order, so without a rule the two adapters answer with
 * the same rows in different orders and a unit test that reads `user.roles[0]` passes
 * against the memory adapter and is wrong against PostgreSQL (ADR-0013).
 */
export type RelationLoad = {
  readonly relation: string
  readonly nested: readonly RelationLoad[]
}

export type QueryOperation = 'select' | 'insert' | 'update' | 'delete' | 'count'

export type QueryAst = {
  readonly model: string
  readonly operation: QueryOperation
  readonly where: readonly Condition[]
  readonly order: readonly Order[]
  readonly with: readonly RelationLoad[]
  readonly limit?: number
  readonly offset?: number
  /** Values for an insert or an update. */
  readonly data?: Readonly<Record<string, unknown>>
}

export const emptyQuery = (model: string, operation: QueryOperation = 'select'): QueryAst => ({
  model,
  operation,
  where: [],
  order: [],
  with: [],
})

const compare = (
  combinator: Combinator,
  field: string,
  operator: ComparisonOperator,
  value?: unknown,
): Comparison => ({
  kind: 'comparison',
  combinator,
  field,
  operator,
  ...(value === undefined ? {} : { value }),
})

export const comparison = (
  field: string,
  operator: ComparisonOperator,
  value?: unknown,
): Comparison => compare('and', field, operator, value)

export const orComparison = (
  field: string,
  operator: ComparisonOperator,
  value?: unknown,
): Comparison => compare('or', field, operator, value)

export const jsonEquals = (
  field: string,
  path: readonly string[],
  value: unknown,
  combinator: Combinator = 'and',
): JsonComparison => ({ kind: 'json', combinator, field, path, operator: 'equals', value })

export const jsonLike = (
  field: string,
  path: readonly string[],
  pattern: string,
  combinator: Combinator = 'and',
): JsonComparison => ({ kind: 'json', combinator, field, path, operator: 'like', value: pattern })

export const jsonContains = (
  field: string,
  value: unknown,
  combinator: Combinator = 'and',
): JsonComparison => ({ kind: 'json', combinator, field, path: [], operator: 'contains', value })

export const group = (
  conditions: readonly Condition[],
  combinator: Combinator = 'and',
): ConditionGroup => ({ kind: 'group', combinator, conditions })
