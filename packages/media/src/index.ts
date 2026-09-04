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
        label: { en: 'Media', uk: 'Медіа', ru: 'Медиа' },
        icon: 'image',
        blurb: {
          en: 'What may be uploaded, how large, and where it is kept.',
          uk: 'Що можна завантажувати, якого розміру і де це зберігається.',
          ru: 'Что можно загружать, какого размера и где это хранится.',
        },
        blocks: [
          {
            title: { en: 'Uploads', uk: 'Завантаження', ru: 'Загрузки' },
            note: {
              en: 'Declared in assemora.config.ts. Changing it is a deploy, not a setting.',
              uk: 'Оголошено в assemora.config.ts. Зміна — це розгортання, а не налаштування.',
              ru: 'Объявлено в assemora.config.ts. Изменение — это развёртывание, а не настройка.',
            },
            locked: true,
            rows: [
              {
                key: 'media.max-upload',
                kind: 'value',
                label: { en: 'Largest file', uk: 'Найбільший файл', ru: 'Наибольший файл' },
                help: {
                  en: 'Per file, as it arrives: base64 puts four bytes on the wire for every three stored.',
                  uk: 'На один файл, як він надходить: base64 передає чотири байти на кожні три збережені.',
                  ru: 'На один файл, как он приходит: base64 передаёт четыре байта на каждые три сохранённых.',
                },
                value: megabytes(currentUploadLimit()),
              },
            ],
          },
          ...(storage === undefined
            ? []
            : [
                {
                  title: { en: 'Storage', uk: 'Сховище', ru: 'Хранилище' },
                  note: {
                    en: 'Declared in assemora.config.ts. Changing it is a migration of the files, not a setting.',
                    uk: 'Оголошено в assemora.config.ts. Зміна — це перенесення файлів, а не налаштування.',
                    ru: 'Объявлено в assemora.config.ts. Изменение — это перенос файлов, а не настройка.',
                  },
                  locked: true,
                  rows: [
                    {
                      key: 'media.driver',
                      kind: 'value' as const,
                      label: { en: 'Driver', uk: 'Драйвер', ru: 'Драйвер' },
                      help: {
                        en: 'Local disk, or any S3-compatible object store (SPEC.md §63).',
                        uk: 'Локальний диск або будь-яке S3-сумісне сховище об’єктів (SPEC.md §63).',
                        ru: 'Локальный диск или любое S3-совместимое хранилище объектов (SPEC.md §63).',
                      },
                      value: storage.name,
                    },
                    ...(storage.where === undefined
                      ? []
                      : [
                          {
                            key: 'media.where',
                            kind: 'value' as const,
                            label: { en: 'Location', uk: 'Розташування', ru: 'Расположение' },
                            help: {
                              en: 'The directory or the bucket the originals live in.',
                              uk: 'Каталог або бакет, де лежать оригінали.',
                              ru: 'Каталог или бакет, где лежат оригиналы.',
                            },
                            value: storage.where,
                          },
                        ]),
                  ],
                },
              ]),
        ],
      }
    })
