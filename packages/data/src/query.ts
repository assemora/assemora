/**
 * Query builder (SPEC.md §19, §20, §30).
 *
 * Every call returns a new builder, so a query is safe to share and to derive from.
 * The builder produces a Query AST and never touches an adapter's own query API.
 */
import { AssemoraError } from '@assemora/core'
import type {
  ComparisonOperator,
  Condition,
  Order,
  QueryAst,
  RelationLoad,
  SortDirection,
  TableDescriptor,
} from '@assemora/database'
import {
  comparison,
  group,
  jsonContains,
  jsonEquals,
  jsonLike,
  orComparison,
} from '@assemora/database'

import type { AnyColumn, ColumnValue } from './columns.js'
import type { Relation } from './relations.js'
import { execute } from './runtime.js'

export type Fields = Readonly<Record<string, AnyColumn | Relation>>

type ColumnFields<F extends Fields> = {
  [K in keyof F as F[K] extends { readonly node: 'column' } ? K : never]: F[K]
}

type RelationFields<F extends Fields> = {
  [K in keyof F as F[K] extends { readonly node: 'relation' } ? K : never]: F[K]
}

/** The names a `where` may address. */
export type FieldName<F extends Fields> = keyof ColumnFields<F> & string

/** The names a `with` may load. */
export type RelationName<F extends Fields> = keyof RelationFields<F> & string

export type FieldValue<F extends Fields, K extends FieldName<F>> = ColumnValue<ColumnFields<F>[K]>

/** The names a pattern match may address: `like` is meaningless off a string. */
export type TextFieldName<F extends Fields> = keyof {
  [K in keyof ColumnFields<F> as ColumnFields<F>[K] extends {
    readonly schema: { parse(value: unknown): { ok: true; value: string } | { ok: false } }
  }
    ? K
    : never]: true
} &
  string

/** The names a JSON operator may address (SPEC.md §38). */
export type JsonFieldName<F extends Fields> = keyof {
  [K in keyof ColumnFields<F> as ColumnFields<F>[K] extends { readonly isJson: true }
    ? K
    : never]: true
} &
  string

/** The record a model produces (SPEC.md §18). */
export type InferRecord<F extends Fields> = {
  [K in keyof ColumnFields<F>]: ColumnValue<ColumnFields<F>[K]>
}

/** A relation to load: a declared name, optionally followed by a nested path. */
export type RelationPath<F extends Fields> = RelationName<F> | `${RelationName<F>}.${string}`

export type Cursor<T> = {
  readonly data: readonly T[]
  /** Pass back as `after` to fetch the next page; `null` at the end. */
  readonly nextCursor: unknown
}

export type Page<T> = {
  readonly data: readonly T[]
  readonly total: number
  readonly page: number
  readonly perPage: number
  readonly lastPage: number
}

export type QueryState = {
  /**
   * Resolved lazily: two models may reference each other, so a relation's target
   * must not be touched while the models are still being declared.
   */
  readonly table: () => TableDescriptor
  readonly where: readonly Condition[]
  readonly order: readonly Order[]
  readonly load: readonly RelationLoad[]
  readonly limit: number | undefined
  readonly offset: number | undefined
  readonly trashed: 'without' | 'with' | 'only'
}

export type QueryRuntime<Row> = {
  readonly related: () => Readonly<Record<string, TableDescriptor>>
  readonly hydrate: (row: Record<string, unknown>) => Row
  readonly scopes: Readonly<Record<string, (query: never) => unknown>>
}

export interface Query<F extends Fields, SN extends string = never, Row = InferRecord<F>>
  extends PromiseLike<Row[]> {
  where<K extends FieldName<F>>(field: K, value: FieldValue<F, K>): ScopedQuery<F, SN, Row>
  where<K extends FieldName<F>>(
    field: K,
    operator: ComparisonOperator,
    value: FieldValue<F, K>,
  ): ScopedQuery<F, SN, Row>
  where(filters: Partial<InferRecord<F>>): ScopedQuery<F, SN, Row>
  where(build: (query: ScopedQuery<F, SN, Row>) => ScopedQuery<F, SN, Row>): ScopedQuery<F, SN, Row>

  orWhere<K extends FieldName<F>>(field: K, value: FieldValue<F, K>): ScopedQuery<F, SN, Row>
  orWhere<K extends FieldName<F>>(
    field: K,
    operator: ComparisonOperator,
    value: FieldValue<F, K>,
  ): ScopedQuery<F, SN, Row>
  orWhere(
    build: (query: ScopedQuery<F, SN, Row>) => ScopedQuery<F, SN, Row>,
  ): ScopedQuery<F, SN, Row>

  whereIn<K extends FieldName<F>>(
    field: K,
    values: readonly FieldValue<F, K>[],
  ): ScopedQuery<F, SN, Row>
  whereNotIn<K extends FieldName<F>>(
    field: K,
    values: readonly FieldValue<F, K>[],
  ): ScopedQuery<F, SN, Row>
  whereNull<K extends FieldName<F>>(field: K): ScopedQuery<F, SN, Row>
  whereNotNull<K extends FieldName<F>>(field: K): ScopedQuery<F, SN, Row>
  whereBetween<K extends FieldName<F>>(
    field: K,
    range: readonly [FieldValue<F, K>, FieldValue<F, K>],
  ): ScopedQuery<F, SN, Row>
  whereLike(field: TextFieldName<F>, pattern: string): ScopedQuery<F, SN, Row>

  /**
   * Compares a key inside a JSON document: `whereJson('metadata', 'source', 'import')`.
   *
   * A dotted path reaches deeper — `'origin.system'`. An empty path compares the
   * whole document, which is occasionally what you want and is why it is spelled out
   * here rather than left to be discovered.
   */
  whereJson(field: JsonFieldName<F>, path: string, value: unknown): ScopedQuery<F, SN, Row>
  /** Asks whether a JSON document includes the given fragment. */
  whereJsonContains(field: JsonFieldName<F>, fragment: unknown): ScopedQuery<F, SN, Row>
  /** Pattern-matches a key inside a JSON document, which is how search reaches it. */
  whereJsonLike(field: JsonFieldName<F>, path: string, pattern: string): ScopedQuery<F, SN, Row>
  orWhereJsonLike(field: JsonFieldName<F>, path: string, pattern: string): ScopedQuery<F, SN, Row>

  orderBy<K extends FieldName<F>>(field: K, direction?: SortDirection): ScopedQuery<F, SN, Row>
  /**
   * Newest first, by `createdAt` unless another column is named — the Eloquent
   * shorthand SPEC.md §19 and §128 ask for. A model without `createdAt` has to name
   * one, and says so.
   */
  latest(field?: FieldName<F>): ScopedQuery<F, SN, Row>
  oldest(field?: FieldName<F>): ScopedQuery<F, SN, Row>

  limit(count: number): ScopedQuery<F, SN, Row>
  offset(count: number): ScopedQuery<F, SN, Row>
  take(count: number): ScopedQuery<F, SN, Row>

  with(...relations: RelationPath<F>[]): ScopedQuery<F, SN, Row>

  withTrashed(): ScopedQuery<F, SN, Row>
  onlyTrashed(): ScopedQuery<F, SN, Row>

  get(): Promise<Row[]>
  first(): Promise<Row | null>
  firstOrFail(): Promise<Row>
  count(): Promise<number>
  exists(): Promise<boolean>
  paginate(page?: number, perPage?: number): Promise<Page<Row>>
  /** Keyset pagination over the primary key — stable while rows are inserted. */
  cursorPaginate(perPage?: number, after?: unknown): Promise<Cursor<Row>>

  /** The query as data. The stable contract of SPEC.md §30. */
  toAst(): QueryAst
}

export type ScopeMethods<F extends Fields, SN extends string, Row> = {
  [K in SN]: () => ScopedQuery<F, SN, Row>
}

export type ScopedQuery<F extends Fields, SN extends string = never, Row = InferRecord<F>> = Query<
  F,
  SN,
  Row
> &
  ScopeMethods<F, SN, Row>

/**
 * A pattern match needs a key to match against: matching a whole document as text is
 * meaningless, and the adapters would disagree about what it even means.
 */
const jsonPath = (field: string, path: string): string[] => {
  if (path === '') {
    throw new AssemoraError(
      'INVALID_QUERY',
      `A pattern match on "${field}" needs a key inside the document`,
      { status: 400 },
    )
  }

  return path.split('.')
}

/**
 * A row count has to be a whole number that is not negative.
 *
 * Passed through unchecked, a `NaN` reaches the adapter, which drops the clause
 * entirely — the query then returns every row instead of the page that was asked for.
 */
const countable = (method: string, count: number): number => {
  if (!Number.isInteger(count) || count < 0) {
    throw new AssemoraError('INVALID_QUERY', `${method}() needs a whole number of rows`, {
      status: 400,
    })
  }

  return count
}

const parsePath = (path: string): RelationLoad => {
  const [head, ...rest] = path.split('.')

  return {
    relation: head ?? path,
    nested: rest.length > 0 ? [parsePath(rest.join('.'))] : [],
  }
}

const mergeLoads = (existing: readonly RelationLoad[], addition: RelationLoad): RelationLoad[] => {
  const found = existing.find((load) => load.relation === addition.relation)

  if (found === undefined) return [...existing, addition]

  return existing.map((load) =>
    load.relation === addition.relation
      ? {
          relation: load.relation,
          nested: addition.nested.reduce(mergeLoads, load.nested),
        }
      : load,
  )
}

export const createQuery = <F extends Fields, SN extends string, Row>(
  state: QueryState,
  runtime: QueryRuntime<Row>,
): ScopedQuery<F, SN, Row> => {
  const derive = (next: Partial<QueryState>): ScopedQuery<F, SN, Row> =>
    createQuery({ ...state, ...next }, runtime)

  const withCondition = (condition: Condition) => derive({ where: [...state.where, condition] })

  const softDeleteCondition = (): readonly Condition[] => {
    const column = state.table().softDeleteColumn

    if (column === undefined || state.trashed === 'with') return []
    if (state.trashed === 'only') return [comparison(column, 'is not null')]

    return [comparison(column, 'is null')]
  }

  /**
   * The shorthand's default column, or a message that names the problem.
   *
   * Without this the query reached the adapter and came back as "No column is mapped
   * for createdAt", which says nothing about `latest()` having filled it in.
   */
  const timeColumn = (field: string | undefined): string => {
    if (field !== undefined) return field

    const table = state.table()

    if (!table.columns.some((column) => column.name === 'createdAt')) {
      throw new AssemoraError(
        'INVALID_QUERY',
        `"${table.name}" has no createdAt column, so latest() and oldest() need one named: latest('publishedAt')`,
        { status: 400 },
      )
    }

    return 'createdAt'
  }

  const toAst = (): QueryAst => ({
    model: state.table().name,
    operation: 'select',
    where: [...softDeleteCondition(), ...state.where],
    order: state.order,
    with: state.load,
    ...(state.limit === undefined ? {} : { limit: state.limit }),
    ...(state.offset === undefined ? {} : { offset: state.offset }),
  })

  const run = async (): Promise<Row[]> => {
    const rows = await execute<Record<string, unknown>[]>(toAst(), {
      table: state.table(),
      related: runtime.related(),
    })

    return rows.map(runtime.hydrate)
  }

  const query = {
    where(first: unknown, second?: unknown, third?: unknown) {
      if (typeof first === 'function') {
        const nested = (first as (query: ScopedQuery<F, SN, Row>) => ScopedQuery<F, SN, Row>)(
          createQuery<F, SN, Row>({ ...state, where: [] }, runtime),
        )
        return withCondition(group(nested.toAst().where))
      }

      if (typeof first === 'object' && first !== null) {
        return Object.entries(first as Record<string, unknown>).reduce<ScopedQuery<F, SN, Row>>(
          (accumulated, [field, value]) =>
            (
              accumulated as { where(field: string, value: unknown): ScopedQuery<F, SN, Row> }
            ).where(field, value),
          createQuery<F, SN, Row>(state, runtime),
        )
      }

      return third === undefined
        ? withCondition(comparison(String(first), '=', second))
        : withCondition(comparison(String(first), second as ComparisonOperator, third))
    },

    orWhere(first: unknown, second?: unknown, third?: unknown) {
      if (typeof first === 'function') {
        const nested = (first as (query: ScopedQuery<F, SN, Row>) => ScopedQuery<F, SN, Row>)(
          createQuery<F, SN, Row>({ ...state, where: [] }, runtime),
        )
        return withCondition(group(nested.toAst().where, 'or'))
      }

      return third === undefined
        ? withCondition(orComparison(String(first), '=', second))
        : withCondition(orComparison(String(first), second as ComparisonOperator, third))
    },

    whereIn: (field: string, values: readonly unknown[]) =>
      withCondition(comparison(field, 'in', values)),
    whereNotIn: (field: string, values: readonly unknown[]) =>
      withCondition(comparison(field, 'not in', values)),
    whereNull: (field: string) => withCondition(comparison(field, 'is null')),
    whereNotNull: (field: string) => withCondition(comparison(field, 'is not null')),
    whereBetween: (field: string, range: readonly [unknown, unknown]) =>
      withCondition(comparison(field, 'between', range)),
    whereLike: (field: string, pattern: string) =>
      withCondition(comparison(field, 'like', pattern)),

    whereJson: (field: string, path: string, value: unknown) =>
      withCondition(jsonEquals(field, path === '' ? [] : path.split('.'), value)),

    whereJsonContains: (field: string, fragment: unknown) =>
      withCondition(jsonContains(field, fragment)),

    whereJsonLike: (field: string, path: string, pattern: string) =>
      withCondition(jsonLike(field, jsonPath(field, path), pattern)),

    orWhereJsonLike: (field: string, path: string, pattern: string) =>
      withCondition(jsonLike(field, jsonPath(field, path), pattern, 'or')),

    orderBy: (field: string, direction: SortDirection = 'asc') =>
      derive({ order: [...state.order, { field, direction }] }),

    latest: (field?: string) =>
      derive({ order: [...state.order, { field: timeColumn(field), direction: 'desc' }] }),

    oldest: (field?: string) =>
      derive({ order: [...state.order, { field: timeColumn(field), direction: 'asc' }] }),

    limit: (count: number) => derive({ limit: countable('limit', count) }),
    offset: (count: number) => derive({ offset: countable('offset', count) }),
    take: (count: number) => derive({ limit: countable('take', count) }),

    with: (...relations: string[]) =>
      derive({ load: relations.map(parsePath).reduce(mergeLoads, state.load) }),

    withTrashed: () => derive({ trashed: 'with' }),
    onlyTrashed: () => derive({ trashed: 'only' }),

    get: run,

    async first() {
      const rows = await createQuery<F, SN, Row>({ ...state, limit: 1 }, runtime).get()
      return rows[0] ?? null
    },

    async firstOrFail() {
      const row = await query.first()

      if (row === null) {
        const { NotFoundError } = await import('@assemora/core')
        throw new NotFoundError(state.table().name)
      }

      return row
    },

    async count() {
      return execute<number>(
        { ...toAst(), operation: 'count', order: [], with: [] },
        { table: state.table() },
      )
    },

    async exists() {
      return (await query.count()) > 0
    },

    async paginate(page: number = 1, perPage: number = 20) {
      const total = await query.count()
      const data = await createQuery<F, SN, Row>(
        { ...state, limit: perPage, offset: (page - 1) * perPage },
        runtime,
      ).get()

      return { data, total, page, perPage, lastPage: Math.max(1, Math.ceil(total / perPage)) }
    },

    async cursorPaginate(perPage: number = 20, after?: unknown) {
      const key = state.table().primaryKey

      const page = createQuery<F, SN, Row>(
        {
          ...state,
          where: after === undefined ? state.where : [...state.where, comparison(key, '>', after)],
          order: [{ field: key, direction: 'asc' }],
          limit: perPage + 1,
        },
        runtime,
      )

      const rows = await page.get()
      const data = rows.slice(0, perPage)
      const last = data.at(-1) as Record<string, unknown> | undefined

      return {
        data,
        nextCursor: rows.length > perPage && last !== undefined ? last[key] : null,
      }
    },

    toAst,

    // biome-ignore lint/suspicious/noThenProperty: SPEC.md §20 asks a query to be awaitable without a terminal method — that is what PromiseLike means
    then<Fulfilled = Row[], Rejected = never>(
      onFulfilled?: ((value: Row[]) => Fulfilled | PromiseLike<Fulfilled>) | null,
      onRejected?: ((reason: unknown) => Rejected | PromiseLike<Rejected>) | null,
    ): PromiseLike<Fulfilled | Rejected> {
      return run().then(onFulfilled, onRejected)
    },
  } as ScopedQuery<F, SN, Row>

  for (const [name, scope] of Object.entries(runtime.scopes)) {
    Object.defineProperty(query, name, {
      enumerable: false,
      value: () => scope(query as never),
    })
  }

  return query
}
