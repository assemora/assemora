/**
 * `@assemora/media` — the media library (SPEC.md §63).
 *
 * The storage interface names no vendor. Both drivers SPEC.md §63 makes mandatory
 * ship here: local disk, and any S3-compatible object store.
 */
import { type ModuleBuilder, megabytes, module } from '@assemora/core'

import { mediaCommands } from './commands.js'
import { mediaModels } from './models.js'
import { mediaQueries } from './queries.js'
import { currentStorage, currentUploadLimit, hasStorage } from './storage.js'

export { DeleteMedia, mediaCommands, UpdateMedia, UploadMedia } from './commands.js'
export { safeContentType } from './content-type.js'
export { Media, mediaModels } from './models.js'
export { GetMedia, ListMedia, mediaQueries } from './queries.js'
export { type S3Addressing, type S3StorageOptions, s3Storage } from './s3-storage.js'
export {
  clearStorage,
  currentStorage,
  currentUploadLimit,
  DEFAULT_UPLOAD_BYTES,
  hasStorage,
  type LocalStorageOptions,
  localStorage,
  type StorageDriver,
  type StoredObject,
  useStorage,
  useUploadLimit,
} from './storage.js'

export const media = (): ModuleBuilder =>
  module('media')
    .models(...mediaModels)
    .commands(...mediaCommands)
    .queries(...mediaQueries)
    /*
     * What the settings screen says about the media library (ADR-0031), declared by
     * the module that knows: which driver holds the bytes and where, and the ceiling
     * an upload has. At boot rather than here, because both are handed to this module
     * by the process that serves it, after `media()` has been written.
     *
     * Every block is locked: the driver and the ceiling are decided in the project's
     * source, and a control for either would offer to change a file it cannot reach.
     */
    .settings(() => {
      // An application may boot without a driver — `createApplication()` on its own,
      // or `db:generate` reading the registry — and it still has a ceiling to state.
      // The Storage block waits for a driver rather than throwing for want of one.
      const storage = hasStorage() ? currentStorage() : undefined

      return {
        name: 'media',
        section: 'content',
        label: 'Media',
        icon: 'image',
        blurb: 'What may be uploaded, how large, and where it is kept.',
        blocks: [
          {
            title: 'Uploads',
            note: 'Declared in assemora.config.ts. Changing it is a deploy, not a setting.',
            locked: true,
            rows: [
              {
                key: 'media.max-upload',
                kind: 'value',
                label: 'Largest file',
                help: 'Per file, as it arrives: base64 puts four bytes on the wire for every three stored.',
                value: megabytes(currentUploadLimit()),
              },
            ],
          },
          ...(storage === undefined
            ? []
            : [
                {
                  title: 'Storage',
                  note: 'Declared in assemora.config.ts. Changing it is a migration of the files, not a setting.',
                  locked: true,
                  rows: [
                    {
                      key: 'media.driver',
                      kind: 'value' as const,
                      label: 'Driver',
                      help: 'Local disk, or any S3-compatible object store (SPEC.md §63).',
                      value: storage.name,
                    },
                    ...(storage.where === undefined
                      ? []
                      : [
                          {
                            key: 'media.where',
                            kind: 'value' as const,
                            label: 'Location',
                            help: 'The directory or the bucket the originals live in.',
                            value: storage.where,
                          },
                        ]),
                  ],
                },
              ]),
        ],
      }
    })
