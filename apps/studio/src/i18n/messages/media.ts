/**
 * The media library, and the picker a field opens it in.
 */
import type { Catalogue } from '../catalogue.ts'

export const MEDIA = {
  // --- the library -----------------------------------------------------------------
  'media.upload': { en: 'Upload' },
  'media.uploading': { en: 'Uploading…' },
  'media.empty': { en: 'The library is empty' },
  'media.emptyBody': { en: 'Upload an image and it becomes available to every `media()` field.' },
  'media.filename': { en: 'Filename' },
  'media.type': { en: 'Type' },
  'media.sizeLabel': { en: 'Size' },
  'media.url': { en: 'URL' },
  'media.file': { en: 'file' },
  'media.alt': { en: 'Alt text' },
  'media.altHelp': {
    en: 'What the image says to somebody who cannot see it. Leave it empty only when the image is decorative.',
  },
  'media.altMissing': { en: 'Not described' },
  'media.altPlaceholder': { en: 'Ada Lovelace at a writing desk' },
  'media.confirmDelete': { en: 'Delete {name}?' },

  // --- the picker a field opens ------------------------------------------------------
  'media.choose': { en: 'Choose a file' },
  'media.pickerEmptyBody': { en: 'Upload a file to use it here.' },

  // --- a size, whose unit is a word ---------------------------------------------------
  'media.size.bytes': { en: '{size} B' },
  'media.size.kilobytes': { en: '{size} KB' },
  'media.size.megabytes': { en: '{size} MB' },
} as const satisfies Catalogue
