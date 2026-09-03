/**
 * `resource()` (SPEC.md §35, §36, §43).
 *
 * A resource is how a model appears as content: which fields are shown, what may be
 * filtered, searched and sorted, and which CRUD endpoints exist. The model keeps
 * owning the data.
 */
import { ConfigurationError, currentContext, ValidationError } from '@assemora/core'
import type {
  ComputedValues,
  Fields as DataFields,
  FieldName,
  InferRecord,
  Instance,
  Model,
  Page,
} from '@assemora/data'
import type { Issue } from '@assemora/schema'
import { readableByActor } from './agent-fields.js'
import { type ApiExposure, describeField, humanize, type ResourceDescriptor } from './descriptor.js'
import type { AnyField } from './fields.js'
import { listingOrder, parseSort } from './ordering.js'
import { validateAgainstFields } from './validation.js'

/** Only the CRUD commands may reach the persistence side of a resource. */
export const PERSISTENCE: unique symbol = Symbol('assemora.resource.persistence')

export type ResourceOptions = {
  /** Defaults to the model's table name. */
  readonly name?: string
  readonly label?: string
  readonly api?: Partial<ApiExposure>
  /** `title` or `-createdAt`. */
  readonly defaultSort?: string
  /**
   * Which field names an entry, where one line of text has to stand for the whole row.
   *
   * ```ts
   * resource(Dish, { name: text(), articleNumber: text() }, { titleField: 'name' })
   * ```
   *
   * A relation control, a link picker and a list all have to call an entry something.
   * Unsaid, they take the first declared field holding text — an answer that depends
   * on the order the fields were written in, which is not something a declaration
   * meant to say. It has to name a declared field that is not hidden: a title nobody
   * may read is not a title (SPEC.md §35, §58).
   */
  readonly titleField?: string
  /**
   * The heading Studio files this resource under — `'Блог'`, `'Shop'`, `'Menu'`.
   *
   * ```ts
   * resource(Article, { … }, { label: 'Статті', group: 'Блог' })
   * ```
   *
   * Resources with the same group are listed together, in the order they were
   * registered, and the groups themselves in the order they first appear — which is the
   * order the modules are listed in, and therefore a decision somebody already made.
   * Unsaid, the resource stays under the general heading with everything else.
   */
  readonly group?: string
  /**
   * What Studio draws this resource as, in the sidebar and wherever else it is listed.
   *
   * ```ts
   * resource(Dish, { … }, { label: 'Страви', group: 'Меню', icon: 'utensils' })
   * ```
   *
   * A name from the set the client ships, kebab-case, and never a picture — an icon set
   * belongs to whatever is drawing. Unsaid, and for a name Studio has never heard of, a
   * resource is drawn as a document, which is how all of them were drawn before.
   */
  readonly icon?: string
  readonly perPage?: number
  readonly maxPerPage?: number
}

export type ListQuery = {
  readonly filters?: Readonly<Record<string, unknown>>
  readonly search?: string
  readonly sort?: string
  readonly page?: number
  readonly perPage?: number
}

export type Persistence = {
  /** Whether the model behind this resource holds one row per language (SPEC.md §131). */
  readonly translatable: boolean
  /**
   * The row translating `original` into `locale`, or null where none exists yet.
   *
   * Here rather than expressed as a `list()` filter, because `translationOf` is not one
   * of the resource's declared fields and must never become one: it is how the rows of
   * one entry are tied together, not something an editor fills in.
   */
  translation(original: unknown, locale: string): Promise<{ readonly id: unknown } | null>
  /**
   * Every row of the entry `id` belongs to, in every language (SPEC.md §131).
   *
   * The whole entry rather than one row, because the question it answers is about the
   * entry: which languages this is written in, which are missing, and which were written
   * before the original last changed. `updatedAt` is `null` on a model that stamps no
   * time, and then staleness is simply not answerable — which is the truth, and better
   * than a guess drawn from a column that is not there.
   */
  translations(id: unknown): Promise<
    readonly {
      readonly id: unknown
      readonly locale: string
      readonly isOriginal: boolean
      readonly updatedAt: string | null
    }[]
  >
  /** The stored entry, for a record-level policy check before anything is written. */
  load(id: unknown): Promise<Record<string, unknown>>
  create(values: Record<string, unknown>): Promise<{ id: unknown; after: Record<string, unknown> }>
  update(
    id: unknown,
    values: Record<string, unknown>,
  ): Promise<{ before: Record<string, unknown>; after: Record<string, unknown> }>
  remove(id: unknown): Promise<{ before: Record<string, unknown> }>
}

export type Resource<
  F extends DataFields,
  SN extends string,
  C extends ComputedValues,
  RF extends Readonly<Record<string, AnyField | undefined>>,
> = {
  readonly node: 'resource'
  readonly name: string
  readonly label: string
  readonly model: Model<F, SN, C>
  readonly fields: RF
  readonly descriptor: ResourceDescriptor
  /** The fields by name, for the checks the command path runs (SPEC.md §52). */
  readonly writableFields: ReadonlyMap<string, AnyField>
  /** A page of entries. Never the whole dataset (SPEC.md §89). */
  list(query?: ListQuery): Promise<Page<ResourceRecord<F, RF>>>
  find(id: unknown): Promise<ResourceRecord<F, RF> | null>
  /** Checks input against the fields. Used by the CRUD commands (SPEC.md §111). */
  validate(values: unknown, mode: 'create' | 'update'): Record<string, unknown>
  readonly [PERSISTENCE]: Persistence
}

/** A resource of any shape, for the registry, the commands and MCP. */
export type AnyResource = {
  readonly node: 'resource'
  readonly name: string
  readonly label: string
  readonly descriptor: ResourceDescriptor
  readonly writableFields: ReadonlyMap<string, AnyField>
  list(query?: ListQuery): Promise<Page<unknown>>
  find(id: unknown): Promise<unknown>
  validate(values: unknown, mode: 'create' | 'update'): Record<string, unknown>
  readonly [PERSISTENCE]: Persistence
}

/** Field names must exist on the model: a resource shows columns, not inventions. */
export type ResourceFieldMap<F extends DataFields> = Partial<Record<FieldName<F>, AnyField>>

/**
 * What a resource hands back for one entry.
 *
 * Only the fields it declared, and never one marked `hidden()`. Returning the model
 * row instead would expose columns the resource never mentioned — a password hash
 * lives one careless serializer away (SPEC.md §28, §35).
 */
export type ResourceRecord<
  F extends DataFields,
  RF extends Readonly<Record<string, AnyField | undefined>>,
> = {
  readonly id: string
} & {
  readonly [K in keyof RF as RF[K] extends { readonly isHidden: true }
    ? never
    : K]: K extends keyof InferRecord<F> ? InferRecord<F>[K] : never
}

const DEFAULT_API: ApiExposure = { create: true, read: true, update: true, delete: true }

export const resource = <
  F extends DataFields,
  SN extends string,
  C extends ComputedValues,
  RF extends ResourceFieldMap<F>,
>(
  model: Model<F, SN, C>,
  fields: RF,
  options: ResourceOptions = {},
): Resource<F, SN, C, RF> => {
  const name = options.name ?? model.table
  const label = options.label ?? humanize(name)
  const perPage = options.perPage ?? 20
  const maxPerPage = options.maxPerPage ?? 100
  const entries = Object.entries(fields) as [string, AnyField][]

  if (options.titleField !== undefined) {
    const chosen = entries.find(([fieldName]) => fieldName === options.titleField)?.[1]
    const offered = entries
      .filter(([, field]) => !field.isHidden)
      .map(([fieldName]) => fieldName)
      .join(', ')

    // Refused where it was written rather than shrugged at in Studio: a title that
    // names nothing is a resource whose every list reads as a uuid, and the person
    // who would see that is not the person who wrote this line.
    if (chosen === undefined || chosen.isHidden) {
      throw new ConfigurationError(
        `"${name}" declares titleField: "${options.titleField}", which is ${chosen === undefined ? 'not one of its fields' : 'hidden, and a title nobody may read is not a title'}. Name one of: ${offered === '' ? 'nothing this resource declares' : offered}.`,
      )
    }
  }

  const descriptor: ResourceDescriptor = {
    name,
    label,
    kind: 'static',
    model: model.table,
    primaryKey: model.primaryKey,
    fields: entries.map(([fieldName, field]) => describeField(fieldName, field)),
    api: { ...DEFAULT_API, ...options.api },
    ...(options.defaultSort === undefined ? {} : { defaultSort: options.defaultSort }),
    ...(options.titleField === undefined ? {} : { titleField: options.titleField }),
    ...(options.group === undefined ? {} : { group: options.group }),
    ...(options.icon === undefined ? {} : { icon: options.icon }),
    perPage,
  }

  const fieldByName = new Map(entries)

  const nullable = new Set(
    Object.entries(model.fields as Readonly<Record<string, { readonly isNullable?: boolean }>>)
      .filter(([, column]) => column.isNullable === true)
      .map(([columnName]) => columnName),
  )

  const named = (kind: 'filterable' | 'sortable' | 'searchable'): string[] =>
    entries
      .filter(([, field]) =>
        kind === 'filterable'
          ? field.isFilterable
          : kind === 'sortable'
            ? field.isSortable
            : field.isSearchable,
      )
      .map(([fieldName]) => fieldName)

  /**
   * A list query arrives from outside — a URL, an agent, a form. Every field it
   * names is checked against what the resource actually allows, so nothing reaches
   * the query builder that the resource did not declare (SPEC.md §85).
   */
  const buildQuery = (query: ListQuery) => {
    const issues: Issue[] = []
    const filterable = new Set(named('filterable'))
    const sortable = new Set(named('sortable'))
    const searchable = named('searchable')

    let built = model as unknown as {
      where(field: string, value: unknown): typeof built
      where(build: (query: typeof built) => typeof built): typeof built
      orWhere(field: string, operator: string, value: unknown): typeof built
      whereLike(field: string, pattern: string): typeof built
      orderBy(field: string, direction: 'asc' | 'desc'): typeof built
      paginate(page: number, perPage: number): Promise<Page<Instance<F, C>>>
    }

    for (const [field, value] of Object.entries(query.filters ?? {})) {
      if (!filterable.has(field)) {
        issues.push({
          path: ['filters', field],
          code: 'not_filterable',
          message: `"${field}" cannot be filtered on`,
        })
        continue
      }

      const parsed = fieldByName.get(field)?.schema.parse(value)

      if (parsed?.ok === true) built = built.where(field, parsed.value)
      else {
        issues.push({
          path: ['filters', field],
          code: 'invalid',
          message: `"${field}" received a value it cannot hold`,
        })
      }
    }

    if (query.search !== undefined && query.search !== '') {
      if (searchable.length === 0) {
        issues.push({
          path: ['search'],
          code: 'not_searchable',
          message: 'This resource declares no searchable fields',
        })
      } else {
        const pattern = `%${query.search}%`

        built = built.where((group) =>
          searchable.reduce(
            (accumulated, field, index) =>
              index === 0
                ? accumulated.whereLike(field, pattern)
                : accumulated.orWhere(field, 'like', pattern),
            group,
          ),
        )
      }
    }

    const sort = query.sort ?? descriptor.defaultSort
    const asked = sort === undefined ? undefined : parseSort(sort)

    if (asked !== undefined && !sortable.has(asked.field)) {
      issues.push({
        path: ['sort'],
        code: 'not_sortable',
        message: `"${asked.field}" cannot be sorted on`,
      })
    }

    if (issues.length > 0) throw new ValidationError(issues)

    // After the refusal, so an ordering is never built from a field the resource does
    // not allow — and always, so a page is a window onto an ordering rather than onto
    // whatever the heap gave (see `ordering.ts`).
    for (const term of listingOrder({
      sort,
      primaryKey: model.primaryKey,
      hasCreatedAt: Object.hasOwn(model.fields as object, 'createdAt'),
    })) {
      built = built.orderBy(term.field, term.direction)
    }

    return built
  }

  // The one validator both kinds of resource use, so a rule cannot exist for a static
  // resource and be missing from a collection (see `validation.ts`).
  const validate = (values: unknown, mode: 'create' | 'update'): Record<string, unknown> =>
    validateAgainstFields(values, mode, {
      resource: name,
      fields: fieldByName,
      // A column decides. `null` into a `not null` column is a database error, so the
      // resource refuses first and names the field.
      clearable: (fieldName) => nullable.has(fieldName),
    })

  const snapshot = (instance: Instance<F, C>): Record<string, unknown> =>
    instance.toJSON() as Record<string, unknown>

  /** Projects a model row down to what the resource actually declares. */
  /**
   * Projects an instance down to what this reader may see.
   *
   * The actor comes from the ambient context rather than a parameter, so a direct
   * `Resource.list()` is filtered exactly as `entries.list` is — there is no back
   * door that skips it (SPEC.md §12, §52).
   */
  const project = (instance: Instance<F, C>): ResourceRecord<F, RF> => {
    const row = snapshot(instance)
    const actor = currentContext()?.actor
    const projected: Record<string, unknown> = {
      id: String((instance as unknown as Record<string, unknown>)[model.primaryKey]),
      /**
       * Which language this entry is actually written in (SPEC.md §131).
       *
       * Projected like `id`, and for the same reason: it is not one of the resource's
       * declared fields, and a reader that cannot tell a translation from a fallback
       * has been handed the wrong answer without being told. §131 is explicit — a page
       * that silently serves English under a Russian URL with nothing saying so is
       * worse than a 404.
       */
      ...(model.descriptor.translatable === true
        ? {
            locale: row.locale,
            /**
             * Which entry this row is one language of, or null where it is the original.
             *
             * Projected because a *reference* to this entry names the original, always —
             * a Russian dish names the Ukrainian category. Without it a form editing in
             * Russian cannot tell that the category it lists and the category the row
             * points at are the same entry, and picking one would write the Russian
             * row's id into a foreign key that must name the original.
             */
            translationOf: row.translationOf ?? null,
          }
        : {}),
    }

    for (const [fieldName, field] of entries) {
      if (field.isHidden) continue
      if (!readableByActor(field, actor)) continue
      if (Object.hasOwn(row, fieldName)) projected[fieldName] = row[fieldName]
    }

    return projected as ResourceRecord<F, RF>
  }

  const built: Resource<F, SN, C, RF> = {
    node: 'resource',
    name,
    label,
    model,
    fields,
    descriptor,
    writableFields: fieldByName,

    // `async` on purpose: a rejected list query has to arrive as a rejected promise,
    // not as a synchronous throw a `.catch()` would never see.
    async list(query = {}) {
      const requested = query.perPage ?? perPage

      const page = await buildQuery(query).paginate(
        Math.max(1, query.page ?? 1),
        Math.min(Math.max(1, requested), maxPerPage),
      )

      return { ...page, data: page.data.map(project) }
    },

    async find(id) {
      const found = await model.find(id)

      return found === null ? null : project(found)
    },

    validate,

    [PERSISTENCE]: {
      translatable: model.descriptor.translatable === true,

      async translation(original, locale) {
        /**
         * `translationOf` and `locale` are columns of a translatable model and are not
         * fields of `F`, which is what makes this the one place that has to say so.
         * `allLocales()` because the search is for a row in another language than the
         * one being read in — scoping it to the current one would find nothing, always.
         */
        const searching = model.allLocales() as unknown as {
          where(field: string, value: unknown): typeof searching
          first(): Promise<Instance<F, C> | null>
        }

        const found = await searching
          .where('translationOf', original)
          .where('locale', locale)
          .first()

        return found === null
          ? null
          : { id: (found as unknown as Record<string, unknown>)[model.primaryKey] }
      },

      async translations(id) {
        if (model.descriptor.translatable !== true) return []

        const named = await model.find(id)

        if (named === null) return []

        const row = snapshot(named)
        const entry = row.translationOf ?? row[model.primaryKey]
        const stamped = model.descriptor.updatedAtColumn

        const every = model.allLocales() as unknown as {
          get(): Promise<Instance<F, C>[]>
        }

        return (await every.get())
          .map((one) => snapshot(one))
          .filter((one) => (one.translationOf ?? one[model.primaryKey]) === entry)
          .map((one) => ({
            id: one[model.primaryKey],
            locale: String(one.locale),
            isOriginal: one.translationOf === null || one.translationOf === undefined,
            updatedAt:
              stamped === undefined || one[stamped] === undefined || one[stamped] === null
                ? null
                : new Date(one[stamped] as string | number | Date).toISOString(),
          }))
      },

      async load(id) {
        return snapshot(await model.findOrFail(id))
      },

      async create(values) {
        const created = await model.create(values as Partial<InferRecord<F>>)

        return { id: created[model.primaryKey as keyof typeof created], after: snapshot(created) }
      },

      async update(id, values) {
        const instance = await model.findOrFail(id)
        const before = snapshot(instance)

        await instance.update(values as Partial<InferRecord<F>>)

        return { before, after: snapshot(instance) }
      },

      async remove(id) {
        const instance = await model.findOrFail(id)
        const before = snapshot(instance)

        await instance.delete()

        return { before }
      },
    },
  }

  return built
}
