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
  'settings.title': { en: 'Settings' },
  'settings.groups': { en: 'Settings groups' },
  'settings.find': { en: 'Find a setting…' },
  'settings.nothing': { en: 'No setting matches “{query}”.' },
  'settings.back': { en: 'Back to Studio' },
  'settings.close': { en: 'Close settings (Esc)' },
  'settings.section.workspace': { en: 'Workspace' },
  'settings.section.content': { en: 'Content' },
  'settings.section.platform': { en: 'Platform' },

  // The tag is set in mono and stays lowercase, the way the prototype writes it: it is
  // a state a block is in, not a heading.
  'settings.locked': { en: 'locked' },

  // --- the group Studio owns: what language it speaks (ADR-0030) -------------------
  'settings.studio': { en: 'Studio' },
  'settings.studio.blurb': { en: 'What this browser shows, and in which language.' },
  'settings.studio.note': {
    en: 'Applies to this browser only. Which language the content is in is a different question, on the account menu.',
  },
  'settings.language.help': { en: 'Every word Studio writes, in the language you read.' },

  // --- the save bar --------------------------------------------------------------
  'settings.unsavedCount': {
    en: { one: '{count} unsaved change', other: '{count} unsaved changes' },
  },
  'settings.allSaved': { en: 'All settings saved' },
  'settings.confirmLeave': { en: 'Your settings have not been saved. Leave the screen anyway?' },
} as const satisfies Catalogue
