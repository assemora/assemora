/**
 * `model()` (SPEC.md §9, §17, §21, §25, §29).
 *
 * One declaration produces the record type, the column metadata the database needs,
 * the query entry point and the model's scopes.
 */
import { ValidationError } from '@assemora/core'
import type { ColumnDescriptor, RelationDescriptor, TableDescriptor } from '@assemora/database'
import { comparison, emptyQuery } from '@assemora/database'

import { type AnyColumn, string, uuid } from './columns.js'
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
  /**
   * The row of this entry in the language being read (SPEC.md §131).
   *
   * `find()` answers the row whose id was asked for, in whatever language it happens to
   * be written — which is what a policy check and an edit want. This answers the *entry*
   * that row belongs to, read in the language of the operation, with the same fallback
   * as any other read. It is what a relation needs: a translation's foreign keys point
   * at originals, so following one and showing its name means asking for the entry
   * rather than for the row.
   *
   * Identical to `find()` on a model that is not translatable.
   */
  translated(id: unknown): Promise<Instance<F, C> | null>
  /**
   * One row per language, and the row keeps its own shape (SPEC.md §131).
   *
   * ```ts
   * export const Article = model('articles', {
   *   id: uuid().primary(),
   *   title: string(),
   * }).translatable()
   * ```
   *
   * The model gains `locale` and `translationOf` and nothing else changes: `title` is
   * still a `string`, `Article.$infer` still has the shape it had, and every scope,
   * relation and query written against it still means what it meant. What changes is
   * that a read is scoped to the language of the operation without a caller asking.
   */
  translatable(): Model<F & TranslationFields, SN, C>
}

/**
 * The two columns a translatable model gains (SPEC.md §131).
 *
 * A row per language, and the row keeps its own shape. `title` stays a `string`: the
 * moment a field becomes a map keyed by language, one declaration stops feeding the
 * record type, the column, the form, the OpenAPI schema and the SDK at once, which is
 * §2 and §128 given up for a storage convenience. `Article.where('locale', 'ru')` is an
 * ordinary query and everything already built keeps working.
 *
 * Both are indexed. Every read of a translatable model filters on `locale`, and the
 * fallback groups by `translationOf` — an index each is what the feature is, not a
 * tuning decision somebody makes later.
 */
/**
 * How `translatable()` tells the `model()` call it re-enters what it is doing.
 *
 * A symbol rather than a field on `ModelOptions`, because it is not something an
 * application says: writing `{ translatable: true }` beside `softDeletes` would be a
 * second way to declare it, and the two would eventually be given different answers.
 */
const TRANSLATABLE = Symbol.for('assemora.model.translatable')

export const TRANSLATION_FIELDS = {
  /** The language this row is written in. */
  locale: string().index(),
  /** The row this one translates, or null for the original. */
  translationOf: uuid().nullable().index(),
} as const

export type TranslationFields = typeof TRANSLATION_FIELDS

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

  const translates = (options as Readonly<Record<symbol, unknown>>)[TRANSLATABLE] === true

  const softDeleteColumn =
    options.softDeletes === true
      ? 'deletedAt'
      : typeof options.softDeletes === 'string'
        ? options.softDeletes
        : undefined

  let cached: TableDescriptor | undefined

  const descriptor = (): TableDescriptor => {
    if (cached !== undefined) return cached

    const described = Object.entries(columns).map(([name, column]) => describeColumn(name, column))

    /**
     * On a translatable model, a unique column is unique *within a language*.
     *
     * `slug: string().unique()` on a model with one row per language is a model with no
     * translations: the Russian row would carry the same slug as the Ukrainian one and
     * the constraint would refuse it. Globally unique is never what was meant — two
     * rows sharing a slug *are* the same entry, in two languages, which is exactly what
     * §131 stores.
     *
     * Done here rather than asked of the application, because it is not a choice: an
     * application that had to remember would be one where forgetting is a table that
     * cannot hold a translation, discovered at the first one.
     */
    const perLocale = translates ? described.filter((column) => column.isUnique) : []

    cached = {
      name: table,
      primaryKey,
      columns: described.map((column) =>
        perLocale.includes(column) ? { ...column, isUnique: false } : column,
      ),
      relations: Object.entries(relations).map(([name, relation]) =>
        describeRelation(name, relation, { table, primaryKey }),
      ),
      ...(softDeleteColumn === undefined ? {} : { softDeleteColumn }),
      ...(translates ? { translatable: true } : {}),
      ...(perLocale.length === 0
        ? {}
        : { uniqueTogether: perLocale.map((column) => [column.name, 'locale']) }),
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
    // The language of the operation, and the fallback on: both are what a read means
    // without a caller saying anything (SPEC.md §131).
    locale: 'context',
    fallback: true,
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

    async translated(id: unknown) {
      if (descriptor().translatable !== true) return statics.find(id)

      // The row first, unscoped, because the id may name a translation: asking for the
      // group of `id` without knowing which row it is would miss the original.
      const named = await statics.find(id)

      if (named === null) return null

      const row = named as unknown as Record<string, unknown>
      const entry = row.translationOf ?? row[primaryKey]

      /**
       * `translationOf` is a column of a translatable model and not a member of `F`,
       * which is what makes this the one place that has to say so. Everything else —
       * the language filter, the fallback — is the ordinary read.
       */
      const grouped = query() as unknown as {
        where(build: (nested: unknown) => unknown): { get(): Promise<Instance<F, C>[]> }
      }

      const rows = await grouped
        .where((nested) => {
          const scope = nested as {
            where(field: string, value: unknown): typeof scope
            orWhere(field: string, value: unknown): typeof scope
          }

          return scope.where(primaryKey, entry).orWhere('translationOf', entry)
        })
        .get()

      return rows[0] ?? null
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

  const translatable = (): Model<F & TranslationFields, keyof S & string, C> =>
    // Declared again with the two extra columns rather than patched in place: a model is
    // its fields, and everything derived from them — the record type, the descriptor,
    // the validator, the instance — is built once from that one list. Re-entering here
    // is what keeps a translatable model from being a second kind of model.
    model<F & TranslationFields, S, C>(
      table,
      { ...fields, ...TRANSLATION_FIELDS },
      // The symbol rides along beside the declared options. It is not part of
      // `ModelOptions` and must not become part of it, so it is attached rather than
      // written into the literal.
      Object.assign({ [TRANSLATABLE]: true }, options) as ModelOptions<F & TranslationFields, S, C>,
    )

  const built = Object.assign(query(), statics, { translatable }) as Model<F, keyof S & string, C>

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
