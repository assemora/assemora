/**
 * `@assemora/media` — the media library (SPEC.md §63).
 *
 * The storage interface names no vendor. Both drivers SPEC.md §63 makes mandatory
 * ship here: local disk, and any S3-compatible object store.
 */
import { type ModuleBuilder, module } from '@assemora/core'

import { mediaCommands } from './commands.js'
import { mediaModels } from './models.js'
import { mediaQueries } from './queries.js'

export { DeleteMedia, mediaCommands, UploadMedia } from './commands.js'
export { safeContentType } from './content-type.js'
export { Media, mediaModels } from './models.js'
export { GetMedia, ListMedia, mediaQueries } from './queries.js'
export { type S3Addressing, type S3StorageOptions, s3Storage } from './s3-storage.js'
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
