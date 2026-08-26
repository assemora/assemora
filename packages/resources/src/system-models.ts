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

/** Every system table this package owns, for schema generation. */
export const systemModels = [ResourceDefinitionModel, ResourceEntryModel] as const
