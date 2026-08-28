/**
 * Dynamic resources (SPEC.md §37, §38, §86).
 *
 * A collection created through Studio or by an agent stores its schema in the
 * database and its entries as JSONB. The definition is untrusted data: it is parsed
 * against a declarative schema, its field kinds must be registered, and nothing in
 * it is ever executed.
 */
import { type Actor, AssemoraError, currentContext, ValidationError } from '@assemora/core'
import type { Page } from '@assemora/data'
import type { Issue } from '@assemora/schema'

import { readableByActor } from './agent-fields.js'
import { describeField, humanize, type ResourceDescriptor } from './descriptor.js'
import {
  countFields,
  definitionSchema,
  type FieldSpec,
  fieldFromSpec,
  MAX_FIELDS,
} from './field-registry.js'
import type { AnyField } from './fields.js'
import { type AnyResource, type ListQuery, PERSISTENCE } from './resource.js'
import { ResourceEntryModel } from './system-models.js'
import { validateAgainstFields } from './validation.js'

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
 * The names an entry already answers to, which a field therefore may not take
 * (SPEC.md §38).
 *
 * An entry is its stored `data` plus the row's own identity, and the identity wins:
 * `toEntry` spreads the JSONB and then writes `id`, `status`, `version`, `createdAt`
 * and `updatedAt` over it. So a field of one of those names was accepted, stored,
 * never readable — and destroyed by the next ordinary save, because the form loaded
 * the row's value and wrote it back. A `required` field called `id` could not be
 * satisfied at all.
 *
 * `publishedAt` is here for the other half of the same collision: `ENTRY_SORT_FIELDS`
 * addresses it by name, so `sort=publishedAt` would order by a column that is not the
 * field of that name.
 *
 * It also keeps the generated SDK compiling. The SDK emits the implicit primary key
 * and then the declared fields, so one collection with a field called `id` produces
 * `readonly id: string` twice and makes the whole client uncompilable (SPEC.md §124).
 */
const ENTRY_KEYS = ['id', 'status', 'version', 'createdAt', 'updatedAt', 'publishedAt'] as const

const RESERVED_FIELD_NAMES: ReadonlySet<string> = new Set(ENTRY_KEYS)

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

  // The schema caps the outermost list; this caps the tree. A group of a hundred fields
  // costs a hundred fields, and the document every introspection request carries is the
  // whole tree (see `MAX_FIELDS`).
  const total = countFields(parsed.value.fields as readonly FieldSpec[])

  if (total > MAX_FIELDS) {
    issues.push({
      path: ['fields'],
      code: 'max',
      message: `A collection declares at most ${MAX_FIELDS} fields in total, nested fields included. This one declares ${total}.`,
    })
  }

  for (const [index, spec] of parsed.value.fields.entries()) {
    if (names.has(spec.name)) {
      issues.push({
        path: ['fields', index, 'name'],
        code: 'duplicate',
        message: `"${spec.name}" is declared twice`,
      })
    }

    if (RESERVED_FIELD_NAMES.has(spec.name)) {
      issues.push({
        path: ['fields', index, 'name'],
        code: 'reserved',
        message: `"${spec.name}" is part of every entry already, so a field cannot be called that. The reserved names are ${ENTRY_KEYS.join(', ')}.`,
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

/**
 * The whole stored row, hidden fields and all.
 *
 * What a revision records and what a restore puts back. Filtering it by whoever
 * happened to trigger the command would quietly drop fields from history, and the
 * restore would then write that loss back into the row (SPEC.md §64).
 */
const wholeEntry = (row: Record<string, unknown>): DynamicEntry => ({
  ...((row.data ?? {}) as Record<string, unknown>),
  id: String(row.id),
  status: String(row.status),
  version: Number(row.version ?? 1),
  createdAt: row.createdAt as Date,
  updatedAt: row.updatedAt as Date,
})

/**
 * A stored row, projected to what this reader may see.
 *
 * The declared fields are the filter. Spreading the JSONB whole would return a
 * `hidden()` field to anybody who asked — the column is one blob, so a dynamic
 * resource has no other place for that rule to live (SPEC.md §28, §52).
 */
const toEntry = (
  row: Record<string, unknown>,
  fields: ReadonlyMap<string, AnyField>,
  actor: Actor | undefined,
): DynamicEntry => {
  const data = (row.data ?? {}) as Record<string, unknown>
  const visible: Record<string, unknown> = {}

  for (const [name, field] of fields) {
    if (field.isHidden) continue
    if (!readableByActor(field, actor)) continue
    // `hasOwn` rather than `in`: a field name is caller-chosen, and `'constructor' in
    // data` is true of every object — the entry would come back holding a function.
    if (Object.hasOwn(data, name)) visible[name] = data[name]
  }

  return {
    ...visible,
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

  // The same validator a static resource uses, so a collection accepts and refuses
  // exactly what one does — a `null` that clears an optional field and a `slug` derived
  // from its source included (see `validation.ts`).
  const validate = (values: unknown, mode: 'create' | 'update'): Record<string, unknown> =>
    validateAgainstFields(values, mode, {
      resource: definition.name,
      fields,
      // Every field of a collection is clearable. There are no columns to ask: the
      // values are one JSONB document, which holds a `null` under any key.
      clearable: () => true,
    })

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
    writableFields: fields,

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

      const actor = currentContext()?.actor

      return { ...page, data: page.data.map((row) => toEntry(row.toJSON(), fields, actor)) }
    },

    async find(id: unknown) {
      const found = await entriesOf().where('id', String(id)).first()

      return found === null ? null : toEntry(found.toJSON(), fields, currentContext()?.actor)
    },

    validate,

    [PERSISTENCE]: {
      async load(id) {
        return wholeEntry((await load(id)).toJSON()) as unknown as Record<string, unknown>
      },

      async create(values) {
        const created = await ResourceEntryModel.create({
          resourceId: options.id,
          data: values,
          status: 'draft',
          version: 1,
        })

        return { id: created.id, after: wholeEntry(created.toJSON()) }
      },

      async update(id, values) {
        const entry = await load(id)
        const before = wholeEntry(entry.toJSON())

        await entry.update({
          data: { ...(entry.data as Record<string, unknown>), ...values },
          version: (entry.version ?? 1) + 1,
        })

        return { before, after: wholeEntry(entry.toJSON()) }
      },

      async remove(id) {
        const entry = await load(id)
        const before = wholeEntry(entry.toJSON())

        await entry.delete()

        return { before }
      },
    },
  }
}
