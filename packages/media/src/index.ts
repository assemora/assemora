/**
 * `@assemora/media` — the media library (SPEC.md §63).
 *
 * The storage interface names no vendor: a local disk driver ships here, and an
 * S3-compatible one arrives with deployment in phase 10.
 */
import { type ModuleBuilder, module } from '@assemora/core'

import { mediaCommands } from './commands.js'
import { mediaModels } from './models.js'
import { mediaQueries } from './queries.js'

export { DeleteMedia, mediaCommands, safeContentType, UploadMedia } from './commands.js'
export { Media, mediaModels } from './models.js'
export { GetMedia, ListMedia, mediaQueries } from './queries.js'
export {
  clearStorage,
  currentStorage,
  type LocalStorageOptions,
  localStorage,
  type StorageDriver,
  type StoredObject,
  useStorage,
} from './storage.js'

export const media = (): ModuleBuilder =>
  module('media')
    .models(...mediaModels)
    .commands(...mediaCommands)
    .queries(...mediaQueries)
