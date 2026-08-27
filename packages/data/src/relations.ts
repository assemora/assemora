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
  /** The join table, for `belongsToMany` only. Named after both tables when omitted. */
  readonly through?: string
  /**
   * The join table column holding this model's key, for `belongsToMany` only.
   * Derived from this model's table name when omitted — `users` gives `userId`.
   *
   * A model linked to itself has to name both: `userId` twice is not a link.
   */
  readonly foreignPivotKey?: string
  /** The join table column holding the target's key, for `belongsToMany` only. */
  readonly relatedPivotKey?: string
}

/**
 * The kind is carried as a literal so a declaration can be told apart by it: only a
 * `belongsToMany` has pivot verbs, and `PivotFields` decides that from the type alone
 * (SPEC.md §24). Defaulted, so `Relation` still names any of them.
 */
export type Relation<K extends RelationKind = RelationKind> = RelationOptions & {
  readonly node: 'relation'
  readonly kind: K
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

const relation = <K extends RelationKind>(
  kind: K,
  target: RelationTarget,
  options: RelationOptions = {},
): Relation<K> => ({ node: 'relation', kind, target: () => asRelatedModel(target), ...options })

/** This model holds the foreign key. */
export const belongsTo = (
  target: RelationTarget,
  options?: RelationOptions,
): Relation<'belongsTo'> => relation('belongsTo', target, options)

/** The other model holds the foreign key, and there is at most one row. */
export const hasOne = (target: RelationTarget, options?: RelationOptions): Relation<'hasOne'> =>
  relation('hasOne', target, options)

/** The other model holds the foreign key, and there may be many rows. */
export const hasMany = (target: RelationTarget, options?: RelationOptions): Relation<'hasMany'> =>
  relation('hasMany', target, options)

/**
 * Both sides are linked through a join table, and the instance carries the verbs that
 * write to it: `user.roles.attach(id)` (SPEC.md §24).
 */
export const belongsToMany = (
  target: RelationTarget,
  options?: RelationOptions,
): Relation<'belongsToMany'> => relation('belongsToMany', target, options)

export const isRelation = (value: unknown): value is Relation =>
  typeof value === 'object' && value !== null && (value as { node?: string }).node === 'relation'
