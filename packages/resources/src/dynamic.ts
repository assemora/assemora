/**
 * Dynamic resources (SPEC.md §37, §38, §86).
 *
 * A collection created through Studio or by an agent stores its schema in the
 * database and its entries as JSONB. The definition is untrusted data: it is parsed
 * against a declarative schema, its field kinds must be registered, and nothing in
 * it is ever executed.
 */
import { AssemoraError, ValidationError } from '@assemora/core'
import type { Page } from '@assemora/data'
import type { Issue } from '@assemora/schema'

import { describeField, humanize, type ResourceDescriptor } from './descriptor.js'
import { definitionSchema, type FieldSpec, fieldFromSpec } from './field-registry.js'
import type { AnyField } from './fields.js'
import { type AnyResource, type ListQuery, PERSISTENCE } from './resource.js'
import { ResourceEntryModel } from './system-models.js'

export type DynamicDefinition = {
  readonly name: string
  readonly label?: string
  readonly fields: readonly FieldSpec[]
}

export type DynamicEntry = {
  readonly id: string
  readonly status: string
  readonly version: number
  readonly createdAt: Date
  readonly updatedAt: Date
} & Record<string, unknown>

/**
 * Turns stored JSON into a definition, or refuses it.
 *
 * Everything a definition may say is declarative. There is no place for a function,
 * an expression or a code string, and an unknown field kind is rejected rather than
 * ignored (SPEC.md §86).
 */
export const parseDynamicDefinition = (input: unknown): DynamicDefinition => {
  const parsed = definitionSchema.parse(input)

  if (!parsed.ok) throw new ValidationError(parsed.issues)

  const names = new Set<string>()
  const issues: Issue[] = []

  for (const [index, spec] of parsed.value.fields.entries()) {
    if (names.has(spec.name)) {
      issues.push({
        path: ['fields', index, 'name'],
        code: 'duplicate',
        message: `"${spec.name}" is declared twice`,
      })
    }

    names.add(spec.name)

    try {
      fieldFromSpec(spec as FieldSpec)
    } catch (error) {
      const reported = error instanceof ValidationError ? error.issues : []

      issues.push(
        ...reported.map((issue) => ({ ...issue, path: ['fields', index, ...issue.path] })),
      )
    }
  }

  if (issues.length > 0) throw new ValidationError(issues)

  return parsed.value as DynamicDefinition
}

const ENTRY_SORT_FIELDS = new Set(['createdAt', 'updatedAt', 'publishedAt', 'status'])

const toEntry = (row: Record<string, unknown>): DynamicEntry => {
  const data = (row.data ?? {}) as Record<string, unknown>

  return {
    ...data,
    id: String(row.id),
    status: String(row.status),
    version: Number(row.version ?? 1),
    createdAt: row.createdAt as Date,
    updatedAt: row.updatedAt as Date,
  }
}

export type DynamicResourceOptions = {
  /** The row in `assemora_resource_definitions` these entries belong to. */
  readonly id: string
  readonly perPage?: number
  readonly maxPerPage?: number
}

export const dynamicResource = (
  definition: DynamicDefinition,
  options: DynamicResourceOptions,
): AnyResource => {
  const fields = new Map<string, AnyField>(
    definition.fields.map((spec) => [spec.name, fieldFromSpec(spec)]),
  )

  const perPage = options.perPage ?? 20
  const maxPerPage = options.maxPerPage ?? 100

  const descriptor: ResourceDescriptor = {
    name: definition.name,
    label: definition.label ?? humanize(definition.name),
    kind: 'dynamic',
    model: ResourceEntryModel.table,
    primaryKey: 'id',
    fields: [...fields].map(([name, field]) => describeField(name, field)),
    api: { create: true, read: true, update: true, delete: true },
    perPage,
  }

  const entriesOf = () => ResourceEntryModel.where('resourceId', options.id)

  const validate = (values: unknown, mode: 'create' | 'update'): Record<string, unknown> => {
    if (typeof values !== 'object' || values === null || Array.isArray(values)) {
      throw new ValidationError([{ path: [], code: 'type', message: 'Expected an object' }])
    }

    const source = values as Record<string, unknown>
    const issues: Issue[] = []
    const checked: Record<string, unknown> = {}

    for (const key of Object.keys(source)) {
      if (!fields.has(key)) {
        issues.push({
          path: [key],
          code: 'unknown_field',
          message: `"${key}" is not a field of ${definition.name}`,
        })
      }
    }

    for (const [name, field] of fields) {
      const provided = name in source

      if (provided && field.isReadOnly) {
        issues.push({ path: [name], code: 'read_only', message: `"${name}" cannot be written` })
        continue
      }

      if (!provided) {
        if (mode === 'create' && field.isRequired) {
          issues.push({ path: [name], code: 'required', message: 'This field is required' })
        }
        continue
      }

      const result = field.schema.parse(source[name])

      if (result.ok) checked[name] = result.value
      else issues.push(...result.issues.map((issue) => ({ ...issue, path: [name, ...issue.path] })))
    }

    if (issues.length > 0) throw new ValidationError(issues)

    return checked
  }

  const load = async (id: unknown) => {
    const found = await entriesOf().where('id', String(id)).first()

    if (found === null) {
      throw new AssemoraError('ENTRY_NOT_FOUND', `Entry ${String(id)} was not found`, {
        status: 404,
      })
    }

    return found
  }

  return {
    node: 'resource',
    name: definition.name,
    label: descriptor.label,
    descriptor,

    async list(query: ListQuery = {}): Promise<Page<unknown>> {
      const issues: Issue[] = []
      let built = entriesOf()

      for (const [name, value] of Object.entries(query.filters ?? {})) {
        const field = fields.get(name)

        if (field === undefined || !field.isFilterable) {
          issues.push({
            path: ['filters', name],
            code: 'not_filterable',
            message: `"${name}" cannot be filtered on`,
          })
          continue
        }

        built = built.whereJson('data', name, value)
      }

      if (query.search !== undefined && query.search !== '') {
        const searchable = [...fields]
          .filter(([, field]) => field.isSearchable)
          .map(([name]) => name)

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
              (accumulated, name, index) =>
                index === 0
                  ? accumulated.whereJsonLike('data', name, pattern)
                  : accumulated.orWhereJsonLike('data', name, pattern),
              group,
            ),
          )
        }
      }

      if (query.sort !== undefined) {
        const descending = query.sort.startsWith('-')
        const field = descending ? query.sort.slice(1) : query.sort

        if (!ENTRY_SORT_FIELDS.has(field)) {
          issues.push({
            path: ['sort'],
            code: 'not_sortable',
            message: `Dynamic entries sort by ${[...ENTRY_SORT_FIELDS].join(', ')} only`,
          })
        } else {
          built = built.orderBy(field as 'createdAt', descending ? 'desc' : 'asc')
        }
      }

      if (issues.length > 0) throw new ValidationError(issues)

      const page = await built.paginate(
        Math.max(1, query.page ?? 1),
        Math.min(Math.max(1, query.perPage ?? perPage), maxPerPage),
      )

      return { ...page, data: page.data.map((row) => toEntry(row.toJSON())) }
    },

    async find(id: unknown) {
      const found = await entriesOf().where('id', String(id)).first()

      return found === null ? null : toEntry(found.toJSON())
    },

    validate,

    [PERSISTENCE]: {
      async load(id) {
        return toEntry((await load(id)).toJSON()) as unknown as Record<string, unknown>
      },

      async create(values) {
        const created = await ResourceEntryModel.create({
          resourceId: options.id,
          data: values,
          status: 'draft',
          version: 1,
        })

        return { id: created.id, after: toEntry(created.toJSON()) }
      },

      async update(id, values) {
        const entry = await load(id)
        const before = toEntry(entry.toJSON())

        await entry.update({
          data: { ...(entry.data as Record<string, unknown>), ...values },
          version: (entry.version ?? 1) + 1,
        })

        return { before, after: toEntry(entry.toJSON()) }
      },

      async remove(id) {
        const entry = await load(id)
        const before = toEntry(entry.toJSON())

        await entry.delete()

        return { before }
      },
    },
  }
}
