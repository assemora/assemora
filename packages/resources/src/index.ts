/**
 * `@assemora/resources` — how a model becomes content.
 *
 * A resource declares which fields are shown, what may be filtered, searched and
 * sorted, and which CRUD endpoints exist. That single declaration is what Studio
 * builds its forms from, what OpenAPI and the SDK are generated from, and what an
 * agent reads to learn the shape of the project (SPEC.md §35, §120).
 *
 * ```ts
 * export const Articles = resource(Article, {
 *   title: text().required().searchable(),
 *   slug: slug('title'),
 *   content: richText(),
 *   status: select('draft', 'published').filterable(),
 * })
 *
 * export default module('blog').models(Article).resources(Articles)
 * ```
 *
 * Reads go through the resource; every write goes through `entries.create`,
 * `entries.update` and `entries.delete` on the Command Bus (SPEC.md §2).
 */

export { readableByActor, refuseUnwritableFields } from './agent-fields.js'
export {
  type CollectionSummary,
  CreateCollection,
  collectionCommands,
  collectionQueries,
  DeleteCollection,
  GetCollection,
  ListCollections,
  UpdateCollection,
} from './collection-commands.js'
export { collections } from './collection-module.js'
export {
  type Collection,
  collectionByName,
  registeredCollections,
} from './collections.js'
export {
  CreateEntry,
  DeleteEntry,
  entryCommands,
  UpdateEntry,
} from './commands.js'
export {
  type ApiExposure,
  describeField,
  humanize,
  type ResourceDescriptor,
  type ResourceFieldDescriptor,
} from './descriptor.js'
export {
  type DynamicDefinition,
  type DynamicEntry,
  type DynamicResourceOptions,
  dynamicResource,
  parseDynamicDefinition,
} from './dynamic.js'
export {
  clearFieldKind,
  countFields,
  definitionSchema,
  type FieldFactory,
  type FieldShapeSpec,
  type FieldSpec,
  fieldFromSpec,
  fieldSpecSchema,
  hasFieldKind,
  MAX_FIELDS,
  MAX_NESTING_DEPTH,
  registeredFieldKinds,
  registerFieldKind,
} from './field-registry.js'
export {
  type AgentPermissions,
  type AnyField,
  array,
  boolean,
  type CodeValue,
  checkboxes,
  code,
  color,
  date,
  datetime,
  ELEMENT_NAME,
  email,
  type Field,
  type FieldBuilder,
  type FieldKind,
  type FieldState,
  type FieldValue,
  type GroupValue,
  type HiddenFieldBuilder,
  image,
  integer,
  json,
  type LinkValue,
  link,
  markdown,
  media,
  number,
  object,
  type Presentation,
  relation,
  richText,
  type SelectOption,
  select,
  slug,
  type TableValue,
  table,
  text,
  textarea,
  time,
  toggle,
  url,
  video,
} from './fields.js'
export { defineResourceFacet } from './module.js'
export { entryQueries, GetEntry, ListEntries } from './queries.js'
export {
  clearResourceRegistry,
  hasResource,
  registeredResources,
  registerResource,
  resourceByName,
  unregisterResource,
} from './registry.js'
// `PERSISTENCE` is deliberately not exported: it is how the write side of a resource
// stays reachable only from the CRUD commands (SPEC.md §2, ADR-0012). Exporting it
// would hand every caller the bypass the symbol exists to prevent.
export {
  type AnyResource,
  type ListQuery,
  type Persistence,
  type Resource,
  type ResourceFieldMap,
  type ResourceOptions,
  type ResourceRecord,
  resource,
} from './resource.js'
export {
  clearSingletonRegistry,
  registeredSingletons,
  registerSingleton,
  type Singleton,
  type SingletonDescriptor,
  type SingletonOptions,
  singleton,
  singletonByName,
} from './singleton.js'
export {
  GetSingleton,
  registerSingletonRestorer,
  singletonCommands,
  singletonQueries,
  UpdateSingleton,
} from './singleton-commands.js'
export {
  ResourceDefinitionModel,
  ResourceEntryModel,
  systemModels,
} from './system-models.js'
