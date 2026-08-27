/**
 * Pivot operations (SPEC.md §24).
 *
 * `belongsToMany` is the one relation that stores nothing on either table it links, so
 * `user.roles` is the only handle there is on the join table. It is an array carrying
 * three verbs: the array is what a read loaded, the verbs write to the join table
 * whether or not anything was loaded, and both are true of the same value at once.
 *
 * The verbs are non-enumerable, so `Object.keys(user)`, `{ ...user }` and
 * `JSON.stringify(user)` see exactly what they saw before there were any. Every write is
 * an ordinary insert, delete or select through the Query AST, against the table
 * `@assemora/database` derives — no adapter method and no operation is added for a
 * pivot, because a link table is a table (ADR-0001, ADR-0013).
 */
import type {
  DatabaseAdapter,
  PivotAddress,
  RelationDescriptor,
  TableDescriptor,
} from '@assemora/database'
import { comparison, emptyQuery, pivotAddress } from '@assemora/database'

import type { Fields } from './query.js'
import { transaction } from './runtime.js'

/**
 * What a key column holds.
 *
 * A relation's target type is erased so that two models may reference each other
 * (ADR-0010), so an id cannot be typed as the target's primary key. This is as narrow
 * as it can honestly be — every column type a primary key is declared with — and it
 * still refuses `null`, `undefined` and an object that was meant to be its own id.
 */
export type RelatedKey = string | number | bigint

/**
 * One side of a many-to-many, as SPEC.md §24 writes it:
 *
 * ```ts
 * await user.roles.attach(roleId)
 * await user.roles.detach(roleId)
 * await user.roles.sync([adminId, editorId])
 * ```
 *
 * The rows are what `.with('roles')` returned — rows, not instances, because the type
 * of the other side is erased (ADR-0010). `readonly` on purpose: pushing into this
 * array would look like attaching and would write nothing.
 */
export type PivotRelation<Row = Record<string, unknown>> = readonly Row[] & {
  /**
   * Whether these rows came from a read that nothing has moved since.
   *
   * Without it an empty array would mean both "this row is linked to nothing" and
   * "nobody asked", which are different facts. A write puts it back to `false` — on
   * every array this relation has handed out, the ones a caller is still holding
   * included — because what was read is no longer what is stored, and a stale view
   * that still called itself loaded would be the same lie one step later.
   */
  readonly isLoaded: boolean
  /** Links these, ignoring the ones already linked. */
  attach(ids: RelatedKey | readonly RelatedKey[]): Promise<void>
  /** Unlinks these. Unlinking something that was never linked is not an error. */
  detach(ids: RelatedKey | readonly RelatedKey[]): Promise<void>
  /** The links become exactly these and nothing else, in one transaction. */
  sync(ids: readonly RelatedKey[]): Promise<void>
}

/**
 * The relations a join table stores, which are the only ones with pivot verbs.
 *
 * Matched on `kind` rather than on `Relation<'belongsToMany'>` so that a column, which
 * has no `kind` at all, is excluded by the same test.
 */
export type PivotFields<F extends Fields> = {
  readonly [K in keyof F as F[K] extends { readonly kind: 'belongsToMany' }
    ? K
    : never]: PivotRelation
}

/** What a pivot needs to reach its join table, resolved at the moment it is used. */
export type PivotContext = {
  readonly owner: TableDescriptor
  readonly relation: RelationDescriptor
  /**
   * The row the links belong to. The live instance, not a copy: `create()` builds one
   * before it has an id, and the address has to be taken against what it holds now.
   */
  readonly row: Readonly<Record<string, unknown>>
  readonly related: () => Readonly<Record<string, TableDescriptor>>
  readonly adapter: () => DatabaseAdapter
}

/**
 * Compared as text, because a key that came back from the database may be a number
 * where the caller wrote a string, and two links to the same record are one link.
 */
const keyOf = (value: unknown): string => String(value)

/** The same id twice is one link, so it is asked for once. */
const distinct = (ids: readonly RelatedKey[]): readonly RelatedKey[] => [
  ...new Map(ids.map((id) => [keyOf(id), id])).values(),
]

/** One id or several: a key is a primitive, so anything else is the list of them. */
const asKeys = (ids: RelatedKey | readonly RelatedKey[]): readonly RelatedKey[] =>
  typeof ids === 'object' ? distinct(ids) : [ids]

/**
 * What a read left on the row for this relation.
 *
 * Cast rather than inferred: an adapter answers with rows of the target table, and
 * naming that type here would need the target's type, which ADR-0010 erases.
 */
const loadedRows = (value: unknown): readonly Record<string, unknown>[] | undefined =>
  Array.isArray(value) ? (value as readonly Record<string, unknown>[]) : undefined

/**
 * Puts `user.roles` on a model instance (SPEC.md §24).
 *
 * Takes over whatever a read left under the relation's name, so the loaded rows and the
 * verbs are one value rather than two ways of spelling the same relation.
 */
export const definePivot = (target: object, context: PivotContext): void => {
  const name = context.relation.name
  const initial = loadedRows((target as Record<string, unknown>)[name])

  let loaded = initial !== undefined

  /**
   * Puts one array — the rows, carrying the three verbs — under the relation's name.
   *
   * Every array it ever publishes keeps the verbs and reads `isLoaded` off the same
   * flag, so a caller holding an older one can still write through it and is still
   * told that what it holds has been overtaken.
   */
  const publish = (rows: readonly Record<string, unknown>[]): void => {
    const items: Record<string, unknown>[] = [...rows]

    Object.defineProperties(items, {
      isLoaded: { enumerable: false, configurable: true, get: () => loaded },
      attach: { enumerable: false, configurable: true, value: verbs.attach },
      detach: { enumerable: false, configurable: true, value: verbs.detach },
      sync: { enumerable: false, configurable: true, value: verbs.sync },
    })

    Object.defineProperty(target, name, {
      // Enumerable exactly when it holds what a read returned, so `Object.keys(user)`
      // and `{ ...user }` show a loaded relation and nothing more — which is what they
      // showed before this relation had verbs to carry.
      enumerable: loaded,
      configurable: true,
      writable: false,
      value: items,
    })
  }

  /**
   * A write makes the loaded view a claim about a state the database has left.
   *
   * The rows are replaced rather than emptied where they lie. `user.roles` is an array
   * the caller may already be holding — `for (const role of user.roles) await
   * user.roles.detach(role.id)` binds it once — and truncating it mid-iteration ended
   * that loop after its first row with the rest still linked and nothing thrown. A
   * value handed out is the caller's; what a write invalidates is the answer to the
   * next read of `user.roles`, and `isLoaded`, which goes false on every array at once.
   *
   * Unconditional, even where the write turned out to change nothing: whether a delete
   * matched a row is not part of the adapter contract, and a view that is sometimes
   * still loaded after `attach` would be a rule nobody could state.
   */
  const invalidate = (): void => {
    loaded = false
    publish([])
  }

  const address = (): PivotAddress =>
    pivotAddress(
      context.owner,
      context.relation,
      context.row,
      context.related()[context.relation.target],
    )

  /** The keys this row is already linked to, narrowed to `only` when one is given. */
  const linked = async (
    pivot: PivotAddress,
    only?: readonly RelatedKey[],
  ): Promise<Map<string, unknown>> => {
    const rows = await context.adapter().execute<Record<string, unknown>[]>(
      {
        ...emptyQuery(pivot.table.name),
        where: [
          comparison(pivot.ownerColumn, '=', pivot.ownerValue),
          ...(only === undefined ? [] : [comparison(pivot.relatedColumn, 'in', only)]),
        ],
      },
      { table: pivot.table },
    )

    return new Map(rows.map((row) => [keyOf(row[pivot.relatedColumn]), row[pivot.relatedColumn]]))
  }

  const link = (pivot: PivotAddress, id: RelatedKey): Promise<unknown> =>
    context.adapter().execute(
      {
        ...emptyQuery(pivot.table.name, 'insert'),
        data: { [pivot.ownerColumn]: pivot.ownerValue, [pivot.relatedColumn]: id },
      },
      { table: pivot.table },
    )

  const unlink = (pivot: PivotAddress, ids: readonly unknown[]): Promise<unknown> =>
    context.adapter().execute(
      {
        ...emptyQuery(pivot.table.name, 'delete'),
        where: [
          comparison(pivot.ownerColumn, '=', pivot.ownerValue),
          comparison(pivot.relatedColumn, 'in', ids),
        ],
      },
      { table: pivot.table },
    )

  const verbs = {
    async attach(ids: RelatedKey | readonly RelatedKey[]): Promise<void> {
      const wanted = asKeys(ids)

      if (wanted.length === 0) return

      // Read first rather than let the unique constraint refuse the second row: only
      // one adapter holds constraints, and both have to answer the same way (ADR-0013).
      // The transaction is for the writes that follow, not for the read — two callers
      // attaching at once still race, and the constraint is what settles that.
      await transaction(async () => {
        const pivot = address()
        const held = await linked(pivot, wanted)

        for (const id of wanted) {
          if (!held.has(keyOf(id))) await link(pivot, id)
        }
      })

      invalidate()
    },

    async detach(ids: RelatedKey | readonly RelatedKey[]): Promise<void> {
      const going = asKeys(ids)

      if (going.length === 0) return

      // One statement, so it is already one act. Deleting rows that are not there
      // deletes nothing, which is what detaching something unattached should mean.
      await unlink(address(), going)

      invalidate()
    },

    async sync(ids: readonly RelatedKey[]): Promise<void> {
      const wanted = distinct(ids)

      // No early return on an empty list: `sync([])` says the links are now none.
      await transaction(async () => {
        const pivot = address()
        const held = await linked(pivot)
        const keep = new Set(wanted.map(keyOf))
        const going = [...held].filter(([key]) => !keep.has(key)).map(([, value]) => value)

        if (going.length > 0) await unlink(pivot, going)

        for (const id of wanted) {
          if (!held.has(keyOf(id))) await link(pivot, id)
        }
      })

      invalidate()
    },
  }

  publish(initial ?? [])
}
