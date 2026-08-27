/**
 * `@assemora/data` — the Assemora data layer.
 *
 * An Eloquent-shaped API that is type-safe and schema-aware. Drizzle sits far below
 * this package and is never visible from it (SPEC.md §16, §125.1):
 *
 * ```ts
 * export const User = model('users', {
 *   id: uuid().primary().defaultRandom(),
 *   email: string().unique(),
 *   active: boolean().default(true),
 *   posts: hasMany(() => Post),
 * })
 *
 * const users = await User.where('active', true).with('posts').latest().take(10)
 * ```
 *
 * A many-to-many is edited through the relation itself (SPEC.md §24):
 *
 * ```ts
 * await user.roles.attach(roleId)
 * await user.roles.detach(roleId)
 * await user.roles.sync([adminId, editorId])
 * ```
 */

export {
  bigint,
  binary,
  boolean,
  type Column,
  type ColumnBuilder,
  type ColumnState,
  type ColumnValue,
  date,
  decimal,
  enumOf,
  integer,
  type JsonColumnBuilder,
  json,
  number,
  string,
  type TimestampColumnBuilder,
  text,
  timestamp,
  type UuidColumnBuilder,
  uuid,
} from './columns.js'
// `createQuery` and `createInstance` are not exported: they are the machinery
// `model()` is built from, and their type parameters cannot be inferred at a call
// site, so calling them directly silently loses every field-name check (SPEC.md §10).
export type {
  Computed,
  ComputedFunctions,
  ComputedValues,
  Instance,
  InstanceContext,
  InstanceMethods,
  NoComputed,
} from './instance.js'
export {
  clearModelRegistry,
  type Model,
  type ModelOptions,
  model,
  type NoScopes,
  registeredModels,
  type ScopeMap,
} from './model.js'
export { defineModelFacet, type ModelDescriptor } from './module.js'
// `definePivot` is not exported: `model()` puts the verbs on an instance, and calling
// it by hand would put a second set on a row nothing owns.
export type { PivotFields, PivotRelation, RelatedKey } from './pivot.js'
export type {
  Cursor,
  FieldName,
  Fields,
  FieldValue,
  InferRecord,
  JsonFieldName,
  Page,
  Query,
  QueryRuntime,
  QueryState,
  RelationName,
  RelationPath,
  ScopedQuery,
  ScopeMethods,
} from './query.js'
export {
  belongsTo,
  belongsToMany,
  hasMany,
  hasOne,
  isRelation,
  type RelatedModel,
  type Relation,
  type RelationOptions,
} from './relations.js'
// `execute` is not exported: it is the seam every query inside this package runs
// through, and a caller reaching for it directly would be assembling a Query AST by
// hand — which is `currentAdapter()`'s job, and is already as advanced as it looks.
export {
  clearAdapter,
  currentAdapter,
  dataTransactions,
  transaction,
  useAdapter,
} from './runtime.js'
export {
  clearSlowQueryLog,
  DEFAULT_SLOW_QUERY_MS,
  type SlowQueryLogOptions,
  useSlowQueryLog,
} from './slow-queries.js'
