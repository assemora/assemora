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
  'common.save': { en: 'Save' },
  'common.saving': { en: 'Saving…' },
  'common.cancel': { en: 'Cancel' },
  'common.create': { en: 'Create' },
  'common.delete': { en: 'Delete' },
  'common.remove': { en: 'Remove' },
  'common.close': { en: 'Close' },
  'common.search': { en: 'Search' },
  'common.retry': { en: 'Try again' },
  'common.clear': { en: 'Clear' },

  // --- paging, which every list does the same way --------------------------------
  'paging.page': { en: 'Page {page} of {last}' },
  'paging.previous': { en: 'Previous' },
  'paging.next': { en: 'Next' },
  'common.dismiss': { en: 'Dismiss' },
  'common.confirmByTyping': { en: 'Type {word} to confirm' },

  // --- states -----------------------------------------------------------------
  'common.loading': { en: 'Loading' },
  'common.never': { en: 'Never' },
  'common.default': { en: 'default' },

  // --- refusals ---------------------------------------------------------------
  //
  // What Studio says when the application said nothing a person can read. A refusal the
  // application *did* write is shown in the words it wrote them in — see the ADR: those
  // are the application's sentences and are not Studio's to translate.
  'common.wentWrong': { en: 'Something went wrong' },
  'common.http': { en: 'The request failed with {status}' },
} as const satisfies Catalogue
