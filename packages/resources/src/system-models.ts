/**
 * The tables a dynamic resource lives in (SPEC.md §38).
 *
 * The definition is data, and so are the entries: a collection created in Studio or
 * by an agent never becomes a TypeScript source file (SPEC.md §37).
 */
import { enumOf, integer, json, model, string, timestamp, uuid } from '@assemora/data'

import type { DynamicDefinition } from './dynamic.js'

export const ResourceDefinitionModel = model('assemora_resource_definitions', {
  id: uuid().primary().defaultRandom(),
  name: string().unique(),
  label: string(),
  schema: json<DynamicDefinition>(),
  settings: json<Record<string, unknown>>(),
  createdAt: timestamp().created(),
  updatedAt: timestamp().updated(),
})

export const ResourceEntryModel = model(
  'assemora_resource_entries',
  {
    id: uuid().primary().defaultRandom(),
    resourceId: uuid(),
    data: json<Record<string, unknown>>(),
    status: enumOf('draft', 'published', 'archived').default('draft'),
    version: integer().default(1),
    createdBy: uuid().nullable(),
    updatedBy: uuid().nullable(),
    createdAt: timestamp().created(),
    updatedAt: timestamp().updated(),
    deletedAt: timestamp().nullable(),
    publishedAt: timestamp().nullable(),
  },
  { softDeletes: true },
)

/**
 * A singleton's one row (SPEC.md §135).
 *
 * One table for every singleton rather than one per name, for the reason collections
 * share a table: a page there is exactly one of is data, and adding a footer to a site
 * must not be a migration.
 */
export const SingletonModel = model('assemora_singletons', {
  id: uuid().primary().defaultRandom(),
  name: string().unique(),
  values: json<Record<string, unknown>>(),
  version: integer().default(1),
  updatedBy: uuid().nullable(),
  createdAt: timestamp().created(),
  updatedAt: timestamp().updated(),
})

/** Every system table this package owns, for schema generation. */
export const systemModels = [ResourceDefinitionModel, ResourceEntryModel, SingletonModel] as const
