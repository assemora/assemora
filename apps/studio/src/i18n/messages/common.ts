/**
 * The words that belong to no screen: the controls, the states, the refusals.
 *
 * A key lands here only when several screens say the same thing for the same reason.
 * `common.cancel` is the same word on every dialog; `pages.publish` is not
 * `common.publish` even though two screens have one, because the day one of them needs
 * different words the shared key is edited by whoever is looking at the other screen.
 */
import type { Catalogue } from '../catalogue.ts'

export const COMMON = {
  // --- controls ---------------------------------------------------------------
  'common.save': { en: 'Save', uk: 'Зберегти', ru: 'Сохранить' },
  'common.saving': { en: 'Saving…', uk: 'Зберігаємо…', ru: 'Сохраняем…' },
  'common.cancel': { en: 'Cancel', uk: 'Скасувати', ru: 'Отмена' },
  'common.create': { en: 'Create', uk: 'Створити', ru: 'Создать' },
  'common.delete': { en: 'Delete', uk: 'Видалити', ru: 'Удалить' },
  'common.remove': { en: 'Remove', uk: 'Прибрати', ru: 'Убрать' },
  'common.close': { en: 'Close', uk: 'Закрити', ru: 'Закрыть' },
  'common.search': { en: 'Search', uk: 'Пошук', ru: 'Поиск' },
  'common.retry': { en: 'Try again', uk: 'Спробувати ще раз', ru: 'Попробовать ещё раз' },
  'common.clear': { en: 'Clear', uk: 'Очистити', ru: 'Очистить' },

  // --- paging, which every list does the same way --------------------------------
  'paging.page': {
    en: 'Page {page} of {last}',
    uk: 'Сторінка {page} з {last}',
    ru: 'Страница {page} из {last}',
  },
  'paging.previous': { en: 'Previous', uk: 'Назад', ru: 'Назад' },
  'paging.next': { en: 'Next', uk: 'Далі', ru: 'Дальше' },
  'common.dismiss': { en: 'Dismiss', uk: 'Приховати', ru: 'Скрыть' },
  'common.confirmByTyping': {
    en: 'Type {word} to confirm',
    uk: 'Введіть {word}, щоб підтвердити',
    ru: 'Введите {word}, чтобы подтвердить',
  },

  // --- states -----------------------------------------------------------------
  'common.loading': { en: 'Loading', uk: 'Завантаження', ru: 'Загрузка' },
  'common.never': { en: 'Never', uk: 'Ніколи', ru: 'Никогда' },
  'common.default': { en: 'default', uk: 'основна', ru: 'основной' },

  // --- refusals ---------------------------------------------------------------
  //
  // What Studio says when the application said nothing a person can read. A refusal the
  // application *did* write is shown in the words it wrote them in — see the ADR: those
  // are the application's sentences and are not Studio's to translate.
  'common.wentWrong': {
    en: 'Something went wrong',
    uk: 'Щось пішло не так',
    ru: 'Что-то пошло не так',
  },
  'common.http': {
    en: 'The request failed with {status}',
    uk: 'Запит не вдався: {status}',
    ru: 'Запрос не удался: {status}',
  },
} as const satisfies Catalogue
