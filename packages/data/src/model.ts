/**
 * `model()` (SPEC.md §9, §17, §21, §25, §29).
 *
 * One declaration produces the record type, the column metadata the database needs,
 * the query entry point and the model's scopes.
 */
import { ValidationError } from '@assemora/core'
import type { ColumnDescriptor, RelationDescriptor, TableDescriptor } from '@assemora/database'
import { comparison, emptyQuery } from '@assemora/database'

import type { AnyColumn } from './columns.js'
import {
  type ComputedFunctions,
  type ComputedValues,
  createInstance,
  type Instance,
  type InstanceContext,
  type NoComputed,
} from './instance.js'
import {
  createQuery,
  type Fields,
  type InferRecord,
  type Query,
  type QueryState,
  type ScopedQuery,
} from './query.js'
import { isRelation, type Relation } from './relations.js'
import { execute } from './runtime.js'

export type ScopeMap<F extends Fields> = Readonly<Record<string, (query: Query<F>) => Query<F>>>

export type NoScopes = Readonly<Record<never, never>>

/**
 * Scopes and computed fields are declared through mapped types so that TypeScript
 * types the callback arguments from `fields` alone, and infers the scope names and
 * the computed value types from the object literal.
 */
export type ModelOptions<F extends Fields, S, C extends ComputedValues> = {
  readonly scopes?: { readonly [K in keyof S]: (query: Query<F>) => Query<F> }
  readonly computed?: { readonly [K in keyof C]: (record: InferRecord<F>) => C[K] }
  /** Marks the model soft-deleting and names the column (SPEC.md §29). */
  readonly softDeletes?: boolean | string
}

export type Model<
  F extends Fields,
  SN extends string = never,
  C extends ComputedValues = NoComputed,
> = ScopedQuery<F, SN, Instance<F, C>> & {
  readonly table: string
  readonly primaryKey: string
  readonly fields: F
  readonly descriptor: TableDescriptor
  /** The record type this model produces. A type-level marker (SPEC.md §18). */
  readonly $infer: InferRecord<F>
  find(id: unknown): Promise<Instance<F, C> | null>
  findOrFail(id: unknown): Promise<Instance<F, C>>
  all(): Promise<Instance<F, C>[]>
  create(values: Partial<InferRecord<F>>): Promise<Instance<F, C>>
}

const registry = new Map<string, { readonly descriptor: TableDescriptor }>()

/** Every declared model, for resolving the other side of a relation. */
export const registeredModels = (): Readonly<Record<string, TableDescriptor>> => {
  const descriptors: Record<string, TableDescriptor> = {}

  for (const [table, model] of registry) descriptors[table] = model.descriptor

  return descriptors
}

export const clearModelRegistry = (): void => {
  registry.clear()
}

/** `users` → `userId`. Crude on purpose; pass `foreignKey` when it does not fit. */
const foreignKeyFor = (table: string): string =>
  `${table.endsWith('s') ? table.slice(0, -1) : table}Id`

const describeColumn = (name: string, column: AnyColumn): ColumnDescriptor => ({
  name,
  type: column.type,
  isPrimary: column.isPrimary,
  isNullable: column.isNullable,
  isUnique: column.isUnique,
  isIndexed: column.isIndexed,
  hasDefault: column.hasDefault,
  ...(column.enumValues === undefined ? {} : { enumValues: column.enumValues }),
})

const describeRelation = (
  name: string,
  relation: Relation,
  owner: { table: string; primaryKey: string },
): RelationDescriptor => {
  const target = relation.target()

  return {
    name,
    kind: relation.kind,
    target: target.table,
    foreignKey:
      relation.foreignKey ??
      (relation.kind === 'belongsTo' ? `${name}Id` : foreignKeyFor(owner.table)),
    ownerKey:
      relation.ownerKey ?? (relation.kind === 'belongsTo' ? target.primaryKey : owner.primaryKey),
    // Carried rather than resolved: what a join table is called and which of its
    // columns points where is derived once, in `@assemora/database`, so the DDL, the
    // diff and the pivot verbs cannot form three opinions about the same table.
    ...(relation.through === undefined ? {} : { through: relation.through }),
    ...(relation.foreignPivotKey === undefined
      ? {}
      : { foreignPivotKey: relation.foreignPivotKey }),
    ...(relation.relatedPivotKey === undefined
      ? {}
      : { relatedPivotKey: relation.relatedPivotKey }),
  }
}

export const model = <
  F extends Fields,
  S extends Readonly<Record<string, unknown>> = NoScopes,
  C extends ComputedValues = NoComputed,
>(
  table: string,
  fields: F,
  options: ModelOptions<F, S, C> = {},
): Model<F, keyof S & string, C> => {
  const columns: Record<string, AnyColumn> = {}
  const relations: Record<string, Relation> = {}

  for (const [name, field] of Object.entries(fields)) {
    if (isRelation(field)) relations[name] = field
    else columns[name] = field as AnyColumn
  }

  const primaryKey = Object.entries(columns).find(([, column]) => column.isPrimary)?.[0] ?? 'id'

  const softDeleteColumn =
    options.softDeletes === true
      ? 'deletedAt'
      : typeof options.softDeletes === 'string'
        ? options.softDeletes
        : undefined

  let cached: TableDescriptor | undefined

  const descriptor = (): TableDescriptor => {
    if (cached !== undefined) return cached

    cached = {
      name: table,
      primaryKey,
      columns: Object.entries(columns).map(([name, column]) => describeColumn(name, column)),
      relations: Object.entries(relations).map(([name, relation]) =>
        describeRelation(name, relation, { table, primaryKey }),
      ),
      ...(softDeleteColumn === undefined ? {} : { softDeleteColumn }),
    }

    return cached
  }

  const instanceContext: InstanceContext<F> = {
    get table() {
      return descriptor()
    },
    columns,
    computed: (options.computed ?? {}) as ComputedFunctions<F>,
    related: registeredModels,
  }

  /** A row that came out of storage already exists there. */
  const hydrate = (row: Record<string, unknown>): Instance<F, C> =>
    createInstance<F, C>(instanceContext, row, { persisted: true })

  const baseState = (): QueryState => ({
    table: descriptor,
    where: [],
    order: [],
    load: [],
    limit: undefined,
    offset: undefined,
    trashed: 'without',
  })

  const query = (): ScopedQuery<F, keyof S & string, Instance<F, C>> =>
    createQuery<F, keyof S & string, Instance<F, C>>(baseState(), {
      related: registeredModels,
      hydrate,
      scopes: (options.scopes ?? {}) as Readonly<Record<string, (query: never) => unknown>>,
    })

  /** Validates a value against the column that will hold it. */
  const validate = (values: Partial<InferRecord<F>>): Record<string, unknown> => {
    const checked: Record<string, unknown> = {}
    const issues = []

    for (const [name, column] of Object.entries(columns)) {
      const raw = (values as Record<string, unknown>)[name]

      if (raw === undefined) {
        if (!column.hasDefault && !column.isNullable && column.timestampRole === undefined) {
          issues.push({ path: [name], code: 'required', message: 'This field is required' })
        }
        continue
      }

      const result = column.schema.parse(raw)

      if (result.ok) {
        const transform = column.transform as ((value: unknown) => unknown) | undefined
        checked[name] = transform === undefined ? result.value : transform(result.value)
      } else {
        issues.push(...result.issues.map((issue) => ({ ...issue, path: [name, ...issue.path] })))
      }
    }

    if (issues.length > 0) throw new ValidationError(issues)

    return checked
  }

  const statics = {
    table,
    primaryKey,
    fields,

    // A type-level marker: the value is never read, the type is the point.
    $infer: undefined as unknown as InferRecord<F>,

    async find(id: unknown) {
      const rows = await execute<Record<string, unknown>[]>(
        {
          ...emptyQuery(table),
          where: [
            comparison(primaryKey, '=', id),
            ...(softDeleteColumn === undefined ? [] : [comparison(softDeleteColumn, 'is null')]),
          ],
          limit: 1,
        },
        { table: descriptor() },
      )

      const row = rows[0]

      return row === undefined ? null : hydrate(row)
    },

    async findOrFail(id: unknown) {
      const found = await statics.find(id)

      if (found === null) {
        const { NotFoundError } = await import('@assemora/core')
        throw new NotFoundError(table, String(id))
      }

      return found
    },

    all() {
      return query().get()
    },

    async create(values: Partial<InferRecord<F>>) {
      // Not `hydrate`: this row does not exist yet, whether or not it was handed a
      // primary key of its own.
      const instance = createInstance<F, C>(instanceContext, validate(values), {
        persisted: false,
      })

      await instance.save()

      return instance
    },
  }

  const built = Object.assign(query(), statics) as Model<F, keyof S & string, C>

  // A getter, not a value: Object.assign would resolve it, and resolving a relation
  // while the models are still being declared reaches a target that does not exist yet.
  Object.defineProperty(built, 'descriptor', { enumerable: true, get: descriptor })

  registry.set(table, {
    get descriptor() {
      return descriptor()
    },
  })

  return built
}
