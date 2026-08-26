/**
 * Relations (SPEC.md §23, §24).
 *
 * A relation names the other side through a thunk, so two models may reference each
 * other without either declaration depending on the other's type.
 */
import type { RelationKind } from '@assemora/database'

/** The minimum a relation needs to know about its target. */
export type RelatedModel = {
  readonly table: string
  readonly primaryKey: string
}

export type RelationOptions = {
  /** The column that holds the reference. Derived from the names when omitted. */
  readonly foreignKey?: string
  /** The column it points at. The target's primary key when omitted. */
  readonly ownerKey?: string
  /** The join table, for `belongsToMany` only. */
  readonly through?: string
}

export type Relation = RelationOptions & {
  readonly node: 'relation'
  readonly kind: RelationKind
  readonly target: () => RelatedModel
}

/**
 * A thunk returning the model on the other side: `() => Post`.
 *
 * Declared as `unknown` on purpose. Two models normally reference each other, and
 * any structural parameter type — `() => RelatedModel`, even `() => unknown` —
 * makes TypeScript resolve the target while the declaration that needs it is still
 * being computed, which is the circular-reference error that would force every
 * mutual relation to be annotated by hand. Erasing the type at this one boundary
 * keeps the API of SPEC.md §9 and §23 working; what the thunk returns is checked at
 * runtime instead, with a clear error (see ADR-0010).
 */
export type RelationTarget = unknown

const asRelatedModel = (target: RelationTarget): RelatedModel => {
  if (typeof target !== 'function') {
    throw new TypeError('A relation target must be a function returning the related model')
  }

  const resolved = (target as () => unknown)()

  if (
    typeof resolved !== 'object' ||
    resolved === null ||
    typeof (resolved as RelatedModel).table !== 'string'
  ) {
    throw new TypeError('A relation target must be a function returning the related model')
  }

  return resolved as RelatedModel
}

const relation = (
  kind: RelationKind,
  target: RelationTarget,
  options: RelationOptions = {},
): Relation => ({ node: 'relation', kind, target: () => asRelatedModel(target), ...options })

/** This model holds the foreign key. */
export const belongsTo = (target: RelationTarget, options?: RelationOptions): Relation =>
  relation('belongsTo', target, options)

/** The other model holds the foreign key, and there is at most one row. */
export const hasOne = (target: RelationTarget, options?: RelationOptions): Relation =>
  relation('hasOne', target, options)

/** The other model holds the foreign key, and there may be many rows. */
export const hasMany = (target: RelationTarget, options?: RelationOptions): Relation =>
  relation('hasMany', target, options)

/** Both sides are linked through a join table. */
export const belongsToMany = (target: RelationTarget, options?: RelationOptions): Relation =>
  relation('belongsToMany', target, options)

export const isRelation = (value: unknown): value is Relation =>
  typeof value === 'object' && value !== null && (value as { node?: string }).node === 'relation'
