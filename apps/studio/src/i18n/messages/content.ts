/**
 * Entries and the resources that hold them — the listing, the form, the fields and the language bar.
 */
import type { Catalogue } from '../catalogue.ts'

export const CONTENT = {
  // --- a collection with nothing in it ------------------------------------------
  //
  // `{name}` is the application's own word for one of these — `testimonial` — written
  // in whatever language its developer wrote it in. English can put a foreign noun into
  // a sentence uninflected; Ukrainian and Russian would have to decline it, and cannot.
  // So they say the sentence without it — the resource's own name is in the heading
  // directly above — which is what a hole a translation does not use is for.
  'entries.blank.title': { en: 'No {name} yet' },
  'entries.blank.create': { en: 'Create {name}' },
  'entries.blank.what': {
    en: 'An entry is one {name}, filled in against the fields declared for it.',
  },
  'entries.blank.cheapest': {
    en: 'Nothing is stored against them yet, which makes this the cheapest moment to change what they are: what a value is becomes fixed as soon as one exists.',
  },
  // --- what a cell says where a value is not its own words -----------------------
  'cell.yes': { en: 'Yes' },
  'cell.no': { en: 'No' },
  'cell.anEntry': { en: 'an entry' },

  // --- a row and its menu ---------------------------------------------------------
  'row.actions': { en: 'Actions' },
  'row.entryActions': { en: 'Entry actions' },
  'row.edit': { en: 'Edit' },
  'row.duplicate': { en: 'Duplicate' },

  // --- the listing ----------------------------------------------------------------
  'collection.reading': { en: 'Reading entries from the {resource} adapter' },
  'collection.unknown': { en: 'No collection called “{name}”' },
  'collection.unknownBody': { en: 'The application does not describe a resource by that name.' },
  'collection.searchPlaceholder': { en: 'Search…' },
  'collection.searchLabel': { en: 'Search {name}' },
  'collection.sortOrder': { en: 'Sort order' },
  'collection.defaultOrder': { en: 'Default order' },
  'collection.selected': { en: '{count} selected' },
  'collection.clearSelection': { en: 'Clear the selection' },
  'collection.selectAll': { en: 'Select every entry on this page' },
  'collection.selectOne': { en: 'Select entry {id}' },
  'collection.noMatch': { en: 'Nothing matches “{search}”' },
  'collection.clearSearch': { en: 'Clear search' },
  'collection.searchableOnly': {
    en: 'Only the fields the resource declares searchable are looked at.',
  },
  // The row's own language, where the listing answered with a fallback (SPEC.md §131).
  'collection.notTranslated': { en: 'Not translated — this is the {locale} original' },
  'collection.loadFailed': { en: 'Entries could not be loaded' },
  'collection.loadFailedBody': { en: 'Nothing was written, and no entry was changed.' },
  'collection.noEntries': { en: 'No entries' },
  'collection.entryCount': { en: { one: '{count} entry', other: '{count} entries' } },

  // --- deleting entries, which is always asked about ------------------------------
  'entries.delete.one': { en: 'Delete “{name}”?' },
  'entries.delete.many': { en: { one: 'Delete {count} entry?', other: 'Delete {count} entries?' } },
  'entries.delete.count': { en: 'Delete {count}' },
  'entries.delete.bodyOne': {
    en: 'It leaves {name} immediately. The revision history keeps what it held, so a restore is still possible.',
  },
  'entries.delete.bodyMany': {
    en: 'They leave {name} immediately. The revision history keeps what they held, so a restore is still possible.',
  },
  // --- one entry, in a form -------------------------------------------------------
  'entry.notFound': { en: 'Not found' },
  'entry.noResource': { en: 'No resource called “{name}”.' },
  'entry.noSuchId': { en: 'Nothing in {name} has that id.' },
  'entry.new': { en: 'New {name}' },
  'entry.edit': { en: 'Edit {name}' },
  'entry.moreActions': { en: 'More actions' },
  'entry.deleteThis': { en: 'Delete {name}' },
  'entry.deleteTitle': { en: 'Delete this {name}?' },
  'entry.mainContent': { en: 'Main content' },
  'entry.allMetadata': {
    en: 'Every field this resource declares is metadata, so they are all in the panel.',
  },
  'entry.savedAt': { en: 'Saved {when}' },
  'entry.unsaved': { en: 'Unsaved changes' },
  'entry.nothingYet': { en: 'Nothing filled in yet' },
  'entry.noChanges': { en: 'No unsaved changes' },
  'entry.discard': { en: 'Discard' },
  'entry.saveChanges': { en: 'Save changes' },

  // --- which fields differ, said as a sentence -------------------------------------
  //
  // The list joiner, and the two agreements around it. `differs` and `differ` are two
  // sentences in English and two in both Slavic languages, and neither is a count: the
  // subject is the list of names, so one name takes one verb and any number of names
  // takes the other.
  'entry.and': { en: 'and' },
  'entry.differ.oneSaved': { en: '{name} differs from the saved entry.' },
  'entry.differ.manySaved': { en: '{names} differ from the saved entry.' },
  'entry.differ.countSaved': {
    en: {
      one: '{count} field differs from the saved entry.',
      other: '{count} fields differ from the saved entry.',
    },
  },
  'entry.differ.oneEmpty': { en: '{name} differs from the empty entry.' },
  'entry.differ.manyEmpty': { en: '{names} differ from the empty entry.' },
  'entry.differ.countEmpty': {
    en: {
      one: '{count} field differs from the empty entry.',
      other: '{count} fields differ from the empty entry.',
    },
  },
  // --- which languages an entry is written in (SPEC.md §131) ----------------------
  //
  // `{locale}` here is a language *code* rather than a name — `uk`, `de` — because the
  // set is the deployment's and Studio has no list of what a language is called. It is
  // therefore always shown as a code, in every one of these.
  'translations.languages': { en: 'Languages' },
  'translations.translateInto': { en: 'Translate into {locale}' },
  'translations.translating': { en: 'Translating into {locale}…' },
  'translations.stale': { en: 'out of date' },
  'translations.isOriginal': { en: 'This is the {origin} original, not a {locale} translation.' },
  'translations.fallbackWarning': {
    en: 'Editing here changes what every language falls back to. To write it in {locale}, translate it — the translation starts as a copy of this.',
  },
  'translations.written': {
    en: {
      one: '{written} of {count} language written',
      other: '{written} of {count} languages written',
    },
  },
  // --- the controls one field kind at a time ---------------------------------------
  'fields.nothingChosen': { en: 'Nothing chosen' },
  'fields.choose': { en: 'Choose…' },
  'fields.replace': { en: 'Replace' },
  'fields.brokenJson': { en: 'Not valid JSON yet' },
  'fields.noOptions': { en: 'This field declares no options.' },
  'fields.pickColour': { en: 'Pick a colour' },
  'fields.language': { en: 'Language' },
  'fields.chooseLanguage': { en: 'Choose a language…' },
  'fields.neverRun': { en: 'Stored as written; never run' },
  'fields.theId': { en: 'The id it points at' },
  'fields.cannotList': { en: '{name} cannot be listed for you, so the id has to be written out.' },
  'fields.cannotListHere': { en: '{name} cannot be listed here, so the id has to be written out.' },
  'fields.noTarget': { en: 'This field names no target resource, so there is nothing to list.' },
  'fields.searchIn': { en: 'Search {name}…' },
  'fields.whichEntry': { en: 'Which entry' },
  'fields.chooseEntry': { en: 'Choose an entry…' },
  'fields.loading': { en: 'Loading…' },
  'fields.whichResource': { en: 'Which resource' },
  'fields.chooseResource': { en: 'Choose a resource…' },

  // --- a link, which is a web address or something in this application --------------
  'fields.linkPointsAt': { en: 'What this link points at' },
  'fields.aWebAddress': { en: 'A web address' },
  'fields.somethingHere': { en: 'Something in this application' },
  'fields.newTab': { en: 'Open in a new tab' },
  'fields.linkLabel': { en: 'What the link says, if not the page’s own title' },

  // --- a table, whose headings are part of its value ---------------------------------
  'fields.heading': { en: 'Heading' },
  'fields.columnHeading': { en: 'Heading of column {number}' },
  'fields.removeColumn': { en: 'Remove column {number}' },
  'fields.removeThisColumn': { en: 'Remove this column' },
  'fields.addColumn': { en: 'Add a column' },
  'fields.plusColumn': { en: '+ column' },
  'fields.cell': { en: 'Row {row}, column {column}' },
  'fields.removeRow': { en: 'Remove row {number}' },
  'fields.removeThisRow': { en: 'Remove this row' },
  'fields.addRow': { en: 'Add a row' },
  'fields.columnFirst': { en: 'Add a column first' },
  'fields.startsWithColumn': { en: 'A table starts with a column.' },

  // --- a repeater ---------------------------------------------------------------------
  'fields.item': { en: 'Item {number}' },
  'fields.up': { en: 'Move up' },
  'fields.down': { en: 'Move down' },
  'fields.moveUp': { en: 'Move item {number} up' },
  'fields.moveDown': { en: 'Move item {number} down' },
  'fields.removeItem': { en: 'Remove item {number}' },
  'fields.removeThisItem': { en: 'Remove this item' },
  'fields.nothingHereYet': { en: 'Nothing here yet.' },
  'fields.addItem': { en: 'Add an item' },
  'fields.readOnly': { en: 'Set by the application, not by hand' },
  'fields.madeFrom': { en: 'Left empty, this is made from {source}' },
} as const satisfies Catalogue
