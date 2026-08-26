/**
 * `resource()` (SPEC.md §35, §36, §43).
 *
 * A resource is how a model appears as content: which fields are shown, what may be
 * filtered, searched and sorted, and which CRUD endpoints exist. The model keeps
 * owning the data.
 */
import { ValidationError } from '@assemora/core'
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

import {
  type ApiExposure,
  describeField,
  humanize,
  type ResourceDescriptor,
  slugify,
} from './descriptor.js'
import type { AnyField } from './fields.js'

/** Only the CRUD commands may reach the persistence side of a resource. */
export const PERSISTENCE: unique symbol = Symbol('assemora.resource.persistence')

export type ResourceOptions = {
  /** Defaults to the model's table name. */
  readonly name?: string
  readonly label?: string
  readonly api?: Partial<ApiExposure>
  /** `title` or `-createdAt`. */
  readonly defaultSort?: string
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

type SortStep = { readonly field: string; readonly direction: 'asc' | 'desc' }

const parseSort = (sort: string): SortStep => ({
  field: sort.startsWith('-') ? sort.slice(1) : sort,
  direction: sort.startsWith('-') ? 'desc' : 'asc',
})

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

  const descriptor: ResourceDescriptor = {
    name,
    label,
    kind: 'static',
    model: model.table,
    primaryKey: model.primaryKey,
    fields: entries.map(([fieldName, field]) => describeField(fieldName, field)),
    api: { ...DEFAULT_API, ...options.api },
    ...(options.defaultSort === undefined ? {} : { defaultSort: options.defaultSort }),
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

    if (sort !== undefined) {
      const step = parseSort(sort)

      if (!sortable.has(step.field)) {
        issues.push({
          path: ['sort'],
          code: 'not_sortable',
          message: `"${step.field}" cannot be sorted on`,
        })
      } else {
        built = built.orderBy(step.field, step.direction)
      }
    }

    if (issues.length > 0) throw new ValidationError(issues)

    return built
  }

  const validate = (values: unknown, mode: 'create' | 'update'): Record<string, unknown> => {
    if (typeof values !== 'object' || values === null || Array.isArray(values)) {
      throw new ValidationError([{ path: [], code: 'type', message: 'Expected an object' }])
    }

    const source = values as Record<string, unknown>
    const issues: Issue[] = []
    const checked: Record<string, unknown> = {}

    for (const key of Object.keys(source)) {
      if (!fieldByName.has(key)) {
        issues.push({
          path: [key],
          code: 'unknown_field',
          message: `"${key}" is not a field of ${name}`,
        })
      }
    }

    for (const [fieldName, field] of entries) {
      const provided = fieldName in source

      if (provided && field.isReadOnly) {
        issues.push({
          path: [fieldName],
          code: 'read_only',
          message: `"${fieldName}" cannot be written`,
        })
        continue
      }

      if (!provided) {
        if (mode === 'create' && field.isRequired) {
          issues.push({ path: [fieldName], code: 'required', message: 'This field is required' })
        }
        continue
      }

      const value = source[fieldName]

      // Clearing a field is a normal edit: Studio's empty input, an agent's explicit
      // `null`. It is accepted exactly where the column can hold it, so a required
      // field and a `not null` column both still refuse (SPEC.md §36).
      if (value === null && !field.isRequired && nullable.has(fieldName)) {
        checked[fieldName] = null
        continue
      }

      const result = field.schema.parse(value)

      if (result.ok) checked[fieldName] = result.value
      else
        issues.push(
          ...result.issues.map((issue) => ({ ...issue, path: [fieldName, ...issue.path] })),
        )
    }

    // `slug('title')` says where the slug comes from, so a caller that did not send
    // one gets it derived. Only on create: a published URL does not change because
    // someone corrected a headline (SPEC.md §39).
    if (mode === 'create') {
      for (const [fieldName, field] of entries) {
        if (field.kind !== 'slug' || field.source === undefined) continue
        if (fieldName in checked || fieldName in source) continue

        const from = checked[field.source] ?? source[field.source]

        if (typeof from !== 'string') continue

        // The derived value goes through the field's own schema like any other. A
        // title that leaves nothing behind fails here rather than reaching the row.
        const result = field.schema.parse(slugify(from))

        if (result.ok) checked[fieldName] = result.value
        else
          issues.push(
            ...result.issues.map((issue) => ({ ...issue, path: [fieldName, ...issue.path] })),
          )
      }
    }

    if (issues.length > 0) throw new ValidationError(issues)

    return checked
  }

  const snapshot = (instance: Instance<F, C>): Record<string, unknown> =>
    instance.toJSON() as Record<string, unknown>

  /** Projects a model row down to what the resource actually declares. */
  const project = (instance: Instance<F, C>): ResourceRecord<F, RF> => {
    const row = snapshot(instance)
    const projected: Record<string, unknown> = {
      id: String((instance as unknown as Record<string, unknown>)[model.primaryKey]),
    }

    for (const [fieldName, field] of entries) {
      if (field.isHidden) continue
      if (fieldName in row) projected[fieldName] = row[fieldName]
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
