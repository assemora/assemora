/**
 * The media library (SPEC.md §63).
 */
import { integer, json, model, string, timestamp, uuid } from '@assemora/data'

export const Media = model('assemora_media', {
  id: uuid().primary().defaultRandom(),
  /** Which storage holds the bytes: `local`, or the name of an S3-compatible bucket. */
  disk: string().default('local'),
  path: string(),
  filename: string(),
  mimeType: string(),
  size: integer(),
  width: integer().nullable(),
  height: integer().nullable(),
  alt: string().nullable(),
  metadata: json<Record<string, unknown>>(),
  createdBy: uuid().nullable(),
  createdAt: timestamp().created(),
})

export const mediaModels = [Media] as const
