/**
 * The settings screen: its chrome, its sidebar, its save bar and the one group Studio
 * owns.
 *
 * Nothing about a *group* is here. A group arrives from the registry with its own
 * words — a label, a blurb, a row's help — written by the application that declared it
 * (ADR-0031), and Studio prints them as they arrive, the way it prints a resource's
 * label. What is here is what Studio says around them.
 */
import type { Catalogue } from '../catalogue.ts'

export const SETTINGS = {
  // --- the chrome and the sidebar ------------------------------------------------
  'settings.title': { en: 'Settings', uk: 'Налаштування', ru: 'Настройки' },
  'settings.groups': { en: 'Settings groups', uk: 'Групи налаштувань', ru: 'Группы настроек' },
  'settings.find': { en: 'Find a setting…', uk: 'Знайти налаштування…', ru: 'Найти настройку…' },
  'settings.nothing': {
    en: 'No setting matches “{query}”.',
    uk: 'Жодне налаштування не відповідає «{query}».',
    ru: 'Ни одна настройка не соответствует «{query}».',
  },
  'settings.back': { en: 'Back to Studio', uk: 'Назад до Studio', ru: 'Назад в Studio' },
  'settings.close': {
    en: 'Close settings (Esc)',
    uk: 'Закрити налаштування (Esc)',
    ru: 'Закрыть настройки (Esc)',
  },
  'settings.section.workspace': {
    en: 'Workspace',
    uk: 'Робочий простір',
    ru: 'Рабочее пространство',
  },
  'settings.section.content': { en: 'Content', uk: 'Вміст', ru: 'Содержимое' },
  'settings.section.platform': { en: 'Platform', uk: 'Платформа', ru: 'Платформа' },

  // The tag is set in mono and stays lowercase, the way the prototype writes it: it is
  // a state a block is in, not a heading.
  'settings.locked': { en: 'locked', uk: 'зафіксовано', ru: 'зафиксировано' },

  // --- the group Studio owns: what language it speaks (ADR-0030) -------------------
  'settings.studio': { en: 'Studio', uk: 'Studio', ru: 'Studio' },
  'settings.studio.blurb': {
    en: 'What this browser shows, and in which language.',
    uk: 'Що показує цей браузер і якою мовою.',
    ru: 'Что показывает этот браузер и на каком языке.',
  },
  'settings.studio.note': {
    en: 'Applies to this browser only. Which language the content is in is a different question, on the account menu.',
    uk: 'Стосується лише цього браузера. Якою мовою вміст — інше питання, у меню облікового запису.',
    ru: 'Касается только этого браузера. На каком языке содержимое — другой вопрос, в меню учётной записи.',
  },
  'settings.language.help': {
    en: 'Every word Studio writes, in the language you read.',
    uk: 'Кожне слово, яке пише Studio, мовою, якою ви читаєте.',
    ru: 'Каждое слово, которое пишет Studio, на языке, на котором вы читаете.',
  },

  // --- the save bar --------------------------------------------------------------
  'settings.unsavedCount': {
    en: ['{count} unsaved change', '{count} unsaved changes', '{count} unsaved changes'],
    uk: ['{count} незбережена зміна', '{count} незбережені зміни', '{count} незбережених змін'],
    ru: [
      '{count} несохранённое изменение',
      '{count} несохранённых изменения',
      '{count} несохранённых изменений',
    ],
  },
  'settings.allSaved': {
    en: 'All settings saved',
    uk: 'Усі налаштування збережено',
    ru: 'Все настройки сохранены',
  },
  'settings.confirmLeave': {
    en: 'Your settings have not been saved. Leave the screen anyway?',
    uk: 'Налаштування не збережено. Усе одно піти з екрана?',
    ru: 'Настройки не сохранены. Всё равно уйти с экрана?',
  },
} as const satisfies Catalogue
