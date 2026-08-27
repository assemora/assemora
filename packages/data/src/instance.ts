/**
 * Model instances (SPEC.md §22, §26, §28, §29).
 *
 * An instance is the record itself plus the verbs that act on it, so a caller writes
 * `user.name = 'John'` and `await user.save()` rather than assembling an update.
 */
import { randomUUID } from 'node:crypto'

import { NotFoundError } from '@assemora/core'
import type { TableDescriptor } from '@assemora/database'
import { comparison, emptyQuery } from '@assemora/database'

import type { AnyColumn } from './columns.js'
import { definePivot, type PivotFields } from './pivot.js'
import type { Fields, InferRecord } from './query.js'
import { execute } from './runtime.js'

const ORIGINAL: unique symbol = Symbol('assemora.original')

/** The functions a model computes its extra fields with (SPEC.md §26). */
export type ComputedFunctions<F extends Fields> = Readonly<
  Record<string, (record: InferRecord<F>) => unknown>
>

/** The values those functions produce, keyed by name. */
export type ComputedValues = Readonly<Record<string, unknown>>

export type NoComputed = Readonly<Record<never, never>>

export type Computed<C extends ComputedValues> = { readonly [K in keyof C]: C[K] }

export type InstanceMethods<F extends Fields> = {
  save(): Promise<void>
  update(values: Partial<InferRecord<F>>): Promise<void>
  delete(): Promise<void>
  refresh(): Promise<void>
  restore(): Promise<void>
  isDirty(field?: keyof InferRecord<F> & string): boolean
  getOriginal<K extends keyof InferRecord<F> & string>(field: K): InferRecord<F>[K]
  toJSON(): Record<string, unknown>
}

export type Instance<F extends Fields, C extends ComputedValues = NoComputed> = InferRecord<F> &
  Computed<C> &
  PivotFields<F> &
  InstanceMethods<F>

export type InstanceContext<F extends Fields> = {
  readonly table: TableDescriptor
  readonly columns: Readonly<Record<string, AnyColumn>>
  readonly computed: ComputedFunctions<F>
  /**
   * Every declared model, for the far side of a `belongsToMany`: the join table takes
   * the type of the key it holds from the target's descriptor, and only the registry
   * has it. Resolved lazily, because two models may reference each other (ADR-0010).
   */
  readonly related: () => Readonly<Record<string, TableDescriptor>>
}

type Mutable = Record<string, unknown> & { [ORIGINAL]?: Record<string, unknown> }

const columnNames = (context: InstanceContext<Fields>): string[] => Object.keys(context.columns)

/** Values a write should carry: everything the model declares as a column. */
const persistable = (context: InstanceContext<Fields>, row: Mutable): Record<string, unknown> => {
  const values: Record<string, unknown> = {}

  for (const name of columnNames(context)) {
    if (name in row) values[name] = row[name]
  }

  return values
}

const touchTimestamps = (
  context: InstanceContext<Fields>,
  row: Mutable,
  moment: 'create' | 'update',
): void => {
  for (const [name, column] of Object.entries(context.columns)) {
    if (
      column.timestampRole === 'updated' ||
      (moment === 'create' && column.timestampRole === 'created')
    ) {
      row[name] = new Date()
    }
  }
}

const fillDefaults = (context: InstanceContext<Fields>, row: Mutable): void => {
  for (const [name, column] of Object.entries(context.columns)) {
    if (row[name] !== undefined) continue
    if (column.usesRandomDefault) row[name] = randomUUID()
    else if (column.hasDefault && column.defaultValue !== undefined) row[name] = column.defaultValue
  }
}

export type InstanceOrigin = {
  /**
   * Whether the row already exists in storage.
   *
   * Inferred from the primary key before, which was wrong: `create()` with an id of
   * its own then looked like an existing row and issued an update that matched
   * nothing, so the record was silently never written.
   */
  readonly persisted: boolean
}

export const createInstance = <F extends Fields, C extends ComputedValues>(
  context: InstanceContext<F>,
  row: Record<string, unknown>,
  origin: InstanceOrigin = { persisted: true },
): Instance<F, C> => {
  const instance: Mutable = { ...row }
  let persisted = origin.persisted

  Object.defineProperty(instance, ORIGINAL, {
    enumerable: false,
    writable: true,
    value: { ...row },
  })

  const original = (): Record<string, unknown> => instance[ORIGINAL] ?? {}

  const key = context.table.primaryKey

  const identify = () => {
    const id = instance[key]

    if (id === undefined || id === null) {
      throw new NotFoundError(context.table.name)
    }

    return comparison(key, '=', id)
  }

  const write = async (operation: 'insert' | 'update' | 'delete', data?: Record<string, unknown>) =>
    execute(
      {
        ...emptyQuery(context.table.name, operation),
        where: operation === 'insert' ? [] : [identify()],
        ...(data === undefined ? {} : { data }),
      },
      { table: context.table },
    )

  const methods: InstanceMethods<F> = {
    async save() {
      if (persisted) {
        touchTimestamps(context, instance, 'update')
        const changed: Record<string, unknown> = {}

        for (const name of columnNames(context)) {
          if (instance[name] !== original()[name]) changed[name] = instance[name]
        }

        if (Object.keys(changed).length > 0) await write('update', changed)
      } else {
        fillDefaults(context, instance)
        touchTimestamps(context, instance, 'create')
        await write('insert', persistable(context, instance))
      }

      instance[ORIGINAL] = { ...persistable(context, instance) }
      persisted = true
    },

    async update(values) {
      Object.assign(instance, values)
      await methods.save()
    },

    async delete() {
      const softColumn = context.table.softDeleteColumn

      if (softColumn === undefined) {
        await write('delete')
        return
      }

      instance[softColumn] = new Date()
      await write('update', { [softColumn]: instance[softColumn] })
    },

    async restore() {
      const softColumn = context.table.softDeleteColumn

      if (softColumn === undefined) return

      instance[softColumn] = null
      await write('update', { [softColumn]: null })
    },

    async refresh() {
      const rows = await execute<Record<string, unknown>[]>(
        { ...emptyQuery(context.table.name), where: [identify()], limit: 1 },
        { table: context.table },
      )

      const fresh = rows[0]

      if (fresh === undefined) throw new NotFoundError(context.table.name, String(instance[key]))

      for (const name of columnNames(context)) delete instance[name]
      Object.assign(instance, fresh)
      instance[ORIGINAL] = { ...fresh }
      persisted = true
    },

    isDirty(field) {
      if (field !== undefined) return instance[field] !== original()[field]

      return columnNames(context).some((name) => instance[name] !== original()[name])
    },

    getOriginal(field) {
      return original()[field] as InferRecord<F>[typeof field]
    },

    toJSON() {
      const output: Record<string, unknown> = {}

      for (const [name, column] of Object.entries(context.columns)) {
        // A hidden column never reaches serialized output (SPEC.md §28).
        if (column.isHidden) continue
        if (name in instance) output[name] = instance[name]
      }

      for (const [name, compute] of Object.entries(context.computed)) {
        output[name] = compute(instance as InferRecord<F>)
      }

      return output
    },
  }

  Object.assign(instance, methods)

  for (const [name, compute] of Object.entries(context.computed)) {
    Object.defineProperty(instance, name, {
      enumerable: true,
      get: () => compute(instance as InferRecord<F>),
    })
  }

  // `user.roles` exists whether or not anybody loaded roles: the verbs of SPEC.md §24
  // act on the join table, and the row alone is enough to address it.
  for (const relation of context.table.relations) {
    if (relation.kind !== 'belongsToMany') continue

    definePivot(instance, {
      owner: context.table,
      relation,
      row: instance,
      related: context.related,
    })
  }

  return instance as Instance<F, C>
}
