/**
 * The media library, and the picker a field opens it in.
 */
import type { Catalogue } from '../catalogue.ts'

export const MEDIA = {
  // --- the library -----------------------------------------------------------------
  'media.upload': { en: 'Upload', uk: 'Завантажити', ru: 'Загрузить' },
  'media.uploading': { en: 'Uploading…', uk: 'Завантажуємо…', ru: 'Загружаем…' },
  'media.empty': { en: 'The library is empty', uk: 'Бібліотека порожня', ru: 'Библиотека пуста' },
  'media.emptyBody': {
    en: 'Upload an image and it becomes available to every `media()` field.',
    uk: 'Завантажте зображення — і воно стане доступним кожному полю `media()`.',
    ru: 'Загрузите изображение — и оно станет доступно каждому полю `media()`.',
  },
  'media.filename': { en: 'Filename', uk: 'Назва файлу', ru: 'Имя файла' },
  'media.type': { en: 'Type', uk: 'Тип', ru: 'Тип' },
  'media.sizeLabel': { en: 'Size', uk: 'Розмір', ru: 'Размер' },
  'media.url': { en: 'URL', uk: 'Адреса', ru: 'Адрес' },
  'media.file': { en: 'file', uk: 'файл', ru: 'файл' },
  'media.confirmDelete': {
    en: 'Delete {name}?',
    uk: 'Видалити «{name}»?',
    ru: 'Удалить «{name}»?',
  },

  // --- the picker a field opens ------------------------------------------------------
  'media.choose': { en: 'Choose a file', uk: 'Оберіть файл', ru: 'Выберите файл' },
  'media.pickerEmptyBody': {
    en: 'Upload a file to use it here.',
    uk: 'Завантажте файл, щоб скористатися ним тут.',
    ru: 'Загрузите файл, чтобы воспользоваться им здесь.',
  },

  // --- a size, whose unit is a word ---------------------------------------------------
  'media.size.bytes': { en: '{size} B', uk: '{size} Б', ru: '{size} Б' },
  'media.size.kilobytes': { en: '{size} KB', uk: '{size} КБ', ru: '{size} КБ' },
  'media.size.megabytes': { en: '{size} MB', uk: '{size} МБ', ru: '{size} МБ' },
} as const satisfies Catalogue
