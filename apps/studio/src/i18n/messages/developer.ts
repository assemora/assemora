/**
 * The developer section, the API explorer, proposals, and the screens a collection is made on.
 */
import type { Catalogue } from '../catalogue.ts'

export const DEVELOPER = {
  // --- collections, before there are any ---------------------------------------
  'collections.new': { en: 'New collection' },
  'collections.blank.first': { en: 'Make your first collection' },
  'collections.blank.none': { en: 'No collections yet' },
  'collections.blank.what': {
    en: 'A collection is a kind of content this application holds — Testimonials, Recipes, Team members. You give it a name and say what fields one entry has.',
  },
  'collections.blank.then': {
    en: 'It is then a resource like every other: its own screen in the sidebar, the same policies, revisions and audit as everything else, and a tool an agent can call by name over MCP.',
  },
  'collections.blank.forbidden': {
    en: 'Making one needs a permission this account does not have.',
  },

  // --- how the field kinds are grouped in the picker -------------------------------
  'collections.kinds.text': { en: 'Text' },
  'collections.kinds.numbers': { en: 'Numbers and switches' },
  'collections.kinds.choices': { en: 'Choices' },
  'collections.kinds.dates': { en: 'Dates and times' },
  'collections.kinds.links': { en: 'Links and files' },
  'collections.kinds.several': { en: 'Several values' },
  'collections.kinds.other': { en: 'Other' },

  // --- what the form refuses before the command would ------------------------------
  //
  // `{kind}` is a machine word — `select`, `relation` — and stays one in every language:
  // it is what the definition holds and what the command's own refusal would name.
  'collections.issue.needsName': { en: 'A collection needs a name.' },
  'collections.issue.badName': {
    en: '“{name}” is not a name a collection can have. Start with a lower-case letter, then letters, numbers and underscores.',
  },
  'collections.issue.nameTaken': {
    en: '“{name}” is already a resource in this application. Choose another name.',
  },
  'collections.issue.needsAField': { en: 'A collection needs at least one field.' },
  'collections.issue.fieldNeedsName': { en: 'Every field needs a name.' },
  'collections.issue.badFieldName': {
    en: '“{name}” is not a name a field can have. Start with a letter, then letters, numbers and underscores.',
  },
  'collections.issue.duplicateField': { en: 'Another field is already called “{name}”.' },
  'collections.issue.needsOptions': { en: 'A {kind} field needs at least one option.' },
  'collections.issue.needsSource': { en: 'A slug field needs a source field.' },
  'collections.issue.needsTarget': { en: 'A relation field needs a target resource.' },
  'collections.issue.needsFields': { en: 'A group needs at least one field.' },
  'collections.issue.needsElement': { en: 'A repeater needs to say what one item is.' },
  'collections.issue.droppedName': {
    en: 'A field called “{name}” was removed while this collection held entries, and their values are still stored under that name. Choose another name, or empty the collection first.',
  },
  // --- the collections screen --------------------------------------------------------
  'collections.lede': {
    en: 'A collection is a resource made here rather than written in TypeScript. Both kinds are equal once they exist',
  },
  'collections.madeHere': { en: 'Made here' },
  'collections.noneMadeHere': { en: 'Nothing has been made here yet' },
  'collections.noneMadeHereBody': {
    en: 'A collection made here is stored as a row rather than a source file, so Studio can change its fields. Everything else about it is the same as the ones below.',
  },
  'collections.column.collection': { en: 'Collection' },
  'collections.column.name': { en: 'Name' },
  'collections.column.fields': { en: 'Fields' },
  'collections.column.entriesCan': { en: 'Entries can be' },
  'collections.entries': { en: 'Entries' },
  'collections.can.created': { en: 'created' },
  'collections.can.read': { en: 'read' },
  'collections.can.updated': { en: 'updated' },
  'collections.can.deleted': { en: 'deleted' },
  'collections.declared': { en: 'Declared in this application’s source' },
  'collections.declaredNote': {
    en: 'Their fields are a TypeScript declaration, which is what produces the record type, the API types and the SDK — so Studio can read them but never rewrite them, and they are changed by editing the application and restarting it. Everything else is the same: the same screens, the same policies, revisions and audit, and the same tools over MCP. A new collection may not take one of these names.',
  },
  // --- the collection editor -----------------------------------------------------------
  'editor.lede': { en: 'A resource stored in the database rather than written in TypeScript' },
  'editor.label': { en: 'Label' },
  'editor.labelHelp': { en: 'What this collection is called in the navigation and on its screens' },
  'editor.nameHelp': {
    en: 'Lower case, letters, numbers and underscores. This is what the API and an agent call it',
  },
  'editor.nameFrozen': {
    en: 'A collection’s name is what its entries, its API and an agent address it by, so it never changes',
  },
  'editor.fieldsInOrder': {
    en: {
      one: '{count} field, in the order they are shown',
      other: '{count} fields, in the order they are shown',
    },
  },
  'editor.addField': { en: 'Add a field' },
  'editor.whatThisSends': { en: 'What this sends' },
  'editor.createCollection': { en: 'Create collection' },
  'editor.somethingMissing': { en: 'Something is missing' },
  // Not "in table {name}", which the handoff's own prototype says: a collection's entries
  // share `assemora_resource_entries` with every other collection's — there is no table
  // per collection to name, and a footer that names one is teaching the wrong shape.
  'editor.ready': {
    en: { one: 'Ready — {count} field in {name}', other: 'Ready — {count} fields in {name}' },
  },
  'editor.nothingToRefuse': { en: 'No unsaved changes to refuse' },
  'editor.saved': { en: 'Saved.' },
  'editor.backToCollections': { en: 'Back to collections' },
  'editor.created': { en: 'Collection “{name}” was created' },
  'editor.addFirstEntry': { en: 'Add the first entry' },
  'editor.keepEditing': { en: 'Keep editing the fields' },
  'editor.gone': { en: '“{name}” is gone' },

  // --- deleting one, which entries can forbid ---------------------------------------------
  'editor.deleteCollection': { en: 'Delete collection' },
  'editor.deleteNamed': { en: 'Delete “{name}”?' },
  'editor.holdsEntries': {
    en: {
      one: '“{name}” holds {count} entry, and its definition is what makes them readable.',
      other: '“{name}” holds {count} entries, and its definition is what makes them readable.',
    },
  },
  'editor.deleteThemFirst': {
    en: 'Delete them first — a definition removed while entries exist would leave every one of them unreadable, so this is refused.',
  },
  'editor.deleteConsequence': {
    en: 'Its definition is removed, Studio stops offering it, and an agent can no longer address it. Any entry already in the bin can no longer be restored.',
  },
  'editor.openEntries': { en: 'Open the entries' },
  'editor.deleteIt': { en: 'Delete it' },
  'editor.deleting': { en: 'Deleting…' },

  // --- what a save will do that cannot be undone -------------------------------------------
  'editor.savingWill': { en: 'Saving this will' },
  'editor.dropOneHeld': {
    en: 'Remove {names}. Its values stay in every entry under that name, unreadable, and a later field of that name is refused while this collection holds entries.',
  },
  'editor.dropManyHeld': {
    en: 'Remove {names}. Their values stay in every entry under those names, unreadable, and a later field of any of those names is refused while this collection holds entries.',
  },
  'editor.dropOneEmpty': { en: 'Remove {names}. Nothing is stored under that name yet.' },
  'editor.dropManyEmpty': { en: 'Remove {names}. Nothing is stored under those names yet.' },
  'editor.leaveEntries': {
    en: {
      one: 'Leave the {count} entry as it is. What a stored value is — a field’s kind, its options, its slug source, its relation target — is fixed while entries exist; what it is called, shown and searched as is not.',
      other:
        'Leave the {count} entries as they are. What a stored value is — a field’s kind, its options, its slug source, its relation target — is fixed while entries exist; what it is called, shown and searched as is not.',
    },
  },
  'editor.addFields': {
    en: {
      one: 'Add {names}, which the {count} entry holds no value for yet.',
      other: 'Add {names}, which the {count} entries hold no value for yet.',
    },
  },
  // --- one row of a definition ------------------------------------------------------
  'row.nothingYet': { en: 'Nothing yet' },
  'row.kept': { en: 'kept' },
  'row.keptWhy': { en: 'An entry may hold this, so it cannot be taken away' },
  'row.removeWord': { en: 'Remove {word}' },
  'row.add': { en: 'Add' },
  'row.options': { en: 'Options' },
  'row.optionsOne': { en: 'A stored entry holds one of these' },
  'row.optionsMany': { en: 'A stored entry holds any number of these' },
  'row.addOption': { en: 'Add an option…' },
  'row.languages': { en: 'Languages' },
  'row.languagesHelp': { en: 'Leave this empty to let an entry name any language' },
  'row.accepts': { en: 'Accepts' },
  'row.acceptsHelp': {
    en: 'What the picker offers, as image/* or application/pdf. Empty means any file',
  },
  'row.madeFrom': { en: 'Made from' },
  'row.madeFromHelp': { en: 'Left empty on an entry, the slug comes from this' },
  'row.chooseField': { en: 'Choose a field…' },
  'row.pointsAt': { en: 'Points at' },
  'row.pointsAtHelp': { en: 'An entry holds the id of one of these' },
  'row.groupFields': { en: 'The fields in this group' },
  'row.groupFieldsNamed': { en: 'The fields in this group ({name})' },
  'row.addToGroup': { en: 'Add a field to this group' },
  'row.eachItemIs': { en: 'Each item is' },
  'row.unnamed': { en: 'unnamed' },
  'row.thisField': { en: 'this field' },
  'row.needsName': { en: 'needs a name' },
  'row.needsOptions': { en: 'needs options' },
  'row.required': { en: 'required' },
  'row.searchable': { en: 'searchable' },
  'row.filterable': { en: 'filterable' },
  'row.moveUp': { en: 'Move {name} up' },
  'row.moveDown': { en: 'Move {name} down' },
  'row.nameFrozen': { en: 'A field’s name is where its values are stored, so it never changes' },
  'row.kind': { en: 'Kind' },
  'row.kindFrozen': { en: 'Fixed: entries already hold values of this kind' },
  'row.labelHelp': { en: 'What an editor sees. Left empty, the name is used' },
  'row.removeNamed': { en: 'Remove {name}' },
  'row.removeField': { en: 'Remove this field' },
  'row.cannotRemove': {
    en: 'A field inside a group cannot be removed while the collection holds entries: the next save of an entry would delete the value rather than leave it behind',
  },
  'row.tableColumns': {
    en: 'An entry chooses this table’s columns, so there is nothing to declare here',
  },
  'row.deepest': {
    en: {
      one: '{count} level is as deep as a definition goes, so a field here holds one value',
      other: '{count} levels is as deep as a definition goes, so a field here holds one value',
    },
  },
  // --- the developer section ------------------------------------------------------------
  'developer.lede': { en: 'What this application declares, straight from the registry' },
  'developer.views': { en: 'Developer views' },
  'developer.filter': { en: 'Filter by name…' },
  'developer.tab.api': { en: 'API' },
  'developer.tab.logs': { en: 'Logs' },
  'developer.tab.resources': { en: 'Resources' },
  'developer.tab.blocks': { en: 'Blocks' },
  'developer.tab.commands': { en: 'Commands' },
  'developer.tab.queries': { en: 'Queries' },
  'developer.tab.models': { en: 'Models' },
  'developer.tab.policies': { en: 'Policies' },
  'developer.policy.answers': { en: 'Answers for: {actions}' },
  'developer.policy.noModule': { en: 'registered outside a module' },
  'developer.noPolicies': { en: 'No policies registered' },
  'developer.sortable': { en: 'sortable' },
  'developer.model': { en: 'model: {name}' },
  'developer.noResources': { en: 'No resources declared' },
  'developer.noBlocks': { en: 'No blocks declared' },
  'developer.acceptsChildren': { en: 'accepts children' },
  'developer.atMost': { en: 'at most {count}' },

  // --- the audit log (SPEC.md §67) --------------------------------------------------------
  'developer.nothingRecorded': { en: 'Nothing recorded yet' },
  'developer.when': { en: 'When' },
  'developer.action': { en: 'Action' },
  'developer.who': { en: 'Who' },
  'developer.from': { en: 'From' },
  'developer.outcome': { en: 'Outcome' },
  'developer.read': { en: 'read' },
  'developer.system': { en: 'system' },
  'developer.outcome.everything': { en: 'everything' },
  'developer.outcome.succeeded': { en: 'succeeded' },
  'developer.outcome.failed': { en: 'failed' },
  'developer.outcome.previewed': { en: 'previewed' },
  // --- the API explorer -------------------------------------------------------------------
  'explorer.filter': { en: 'Filter by path or tag…' },
  'explorer.endpoints': {
    en: {
      one: '{count} endpoint, described by the application itself',
      other: '{count} endpoints, all of them described by the application itself',
    },
  },
  'explorer.auth': { en: 'auth' },
  'explorer.params': { en: 'Params' },
  'explorer.query': { en: 'Query' },
  'explorer.body': { en: 'Body' },
  'explorer.response': { en: 'Response' },
  'explorer.queryString': { en: 'Query string' },
  'explorer.send': { en: 'Send' },
  'explorer.sending': { en: 'Sending…' },
  // A duration in milliseconds. The unit is a symbol and stays one in every language.
  'explorer.duration': { en: '{ms} ms' },
  // --- what an agent proposed (SPEC.md §75) ------------------------------------------------
  'proposals.lede': { en: 'What agents have asked for. Nothing changes until you apply it' },
  'proposals.statuses': { en: 'Proposal statuses' },
  'proposals.status.pending': { en: 'Pending' },
  'proposals.status.applied': { en: 'Applied' },
  'proposals.status.rejected': { en: 'Rejected' },
  'proposals.status.expired': { en: 'Expired' },
  'proposals.status.conflicted': { en: 'Conflicted' },
  'proposals.status.all': { en: 'All' },
  'proposals.somebody': { en: 'somebody' },
  'proposals.proposedBy': { en: 'proposed by {who}' },
  'proposals.changeCount': { en: { one: '{count} change', other: '{count} changes' } },
  'proposals.apply': { en: 'Apply' },
  'proposals.applying': { en: 'Applying…' },
  'proposals.reject': { en: 'Reject' },
  'proposals.conflicted': {
    en: 'Somebody changed one of these since it was proposed, so nothing was applied. Ask for it again against what the page says now.',
  },
  'proposals.expired': { en: 'This proposal expired before anybody decided.' },
  'proposals.none': { en: 'Nothing proposed' },
  'proposals.noneBody': {
    en: 'An agent connected over MCP proposes changes here, and they wait for you.',
  },
  // An example of the kind of word somebody types here, so it is a word rather than a
  // format: `testimonials` beside it is a machine name and stays Latin in every language.
  'editor.labelExample': { en: 'Testimonials' },
  'row.labelExample': { en: 'Author' },
  // --- what one field kind is, in one line ------------------------------------------------
  //
  // A kind's own name — `richText`, `slug` — is a machine word and is never translated:
  // it is what the definition holds, what the API answers with and what an agent names.
  // These sentences are what make the two dozen of them tellable apart.
  'kind.help.text': { en: 'One line, stored as text. Good for names and titles.' },
  'kind.help.textarea': { en: 'Many lines of plain text, no formatting.' },
  'kind.help.richText': { en: 'Formatted body copy with headings, links and images.' },
  'kind.help.markdown': { en: 'Plain text with markdown marks, stored exactly as written.' },
  'kind.help.code': { en: 'Source in a language you name. Stored as written; never run.' },
  'kind.help.number': { en: 'Stored as a number, so it sorts and filters numerically.' },
  'kind.help.integer': { en: 'A whole number — a decimal part is refused.' },
  'kind.help.boolean': { en: 'A single switch — on or off.' },
  'kind.help.date': { en: 'A day, with no time and no timezone.' },
  'kind.help.datetime': { en: 'A moment in time, stored in UTC.' },
  'kind.help.time': { en: 'A time of day, with no date and no timezone.' },
  'kind.help.select': { en: 'One value from a list you define.' },
  'kind.help.checkboxes': { en: 'Any number of values from a list you define.' },
  'kind.help.color': { en: 'A hex colour, typed or picked from a swatch.' },
  'kind.help.json': { en: 'Any shape at all, edited as JSON. Nothing checks what is in it.' },
  'kind.help.slug': { en: 'A name for an address, made from another field when left empty.' },
  'kind.help.url': { en: 'A web address, checked as one.' },
  'kind.help.link': { en: 'A web address, or an entry in this application.' },
  'kind.help.email': { en: 'An email address, checked as one.' },
  'kind.help.media': { en: 'One item from the media library.' },
  'kind.help.relation': { en: 'Points at an entry in another collection.' },
  'kind.help.table': { en: 'A grid whose columns an editor adds, not you.' },
  'kind.help.object': { en: 'A group of fields, filled in together.' },
  'kind.help.array': { en: 'Any number of one field, added and reordered by an editor.' },

  // --- a shape people ask for often --------------------------------------------------------
  'preset.testimonial': { en: 'Testimonial' },
  'preset.post': { en: 'Blog post' },
  'preset.member': { en: 'Team member' },
  // --- the form this definition will be ------------------------------------------------
  //
  // A drawing of the entry form, beside the definition being written. The hints inside
  // its ghost controls are what an editor would see as placeholder text, so they are
  // words rather than formats.
  'sees.title': { en: 'What an editor sees' },
  'sees.entry': { en: '{name} entry' },
  'sees.untitled': { en: 'Untitled' },
  'sees.untitledField': { en: 'Untitled field' },
  'sees.nothingYet': { en: 'Fields you add appear here as the editor will meet them.' },
  'sees.offByDefault': { en: 'Off by default' },
  'sees.dropAnImage': { en: 'Drop an image' },
  'sees.needsAnOption': { en: 'Needs at least one option' },
  'sees.aTable': { en: 'A grid the editor gives its own columns' },
  'sees.aGroup': {
    en: { one: '{count} field, filled in together', other: '{count} fields, filled in together' },
  },
  'sees.aRepeater': { en: 'Any number of these, added by the editor' },
  'sees.hint.line': { en: 'One line' },
  'sees.hint.slug': { en: 'made-from-the-title' },
  'sees.hint.number': { en: '0' },
  'sees.hint.date': { en: 'Pick a date' },
  'sees.hint.time': { en: 'Pick a time' },
  'sees.hint.entry': { en: 'Find an entry' },
  'sees.hint.text': { en: 'Plain text' },
  'sees.hint.body': { en: 'Formatted body copy' },
  'sees.hint.json': { en: '{ }' },
  'sees.hint.code': { en: 'Source, stored as written' },
  // --- the three shapes a collection's name takes ------------------------------------------
  //
  // `api` and `studio` are names rather than words and stay as they are in every
  // language; `agent` is a word. The values beside them are addresses, and are mono.
  'editor.becomes.api': { en: 'api' },
  'editor.becomes.studio': { en: 'studio' },
  'editor.becomes.agent': { en: 'agent' },

  // --- a definition with no fields in it yet -------------------------------------------------
  'editor.noFieldsYet': { en: 'none yet' },
  'editor.noFields': { en: 'No fields yet' },
  'editor.noFieldsBody': { en: 'Start from a shape we see often, then rename anything.' },
  'editor.presetFields': { en: { one: '{count} field', other: '{count} fields' } },
  // --- what a collection is drawn as (SPEC.md §58) ------------------------------------
  //
  // The names themselves — `shopping-cart`, `utensils` — are the drawing set's own and
  // stay as they are in every language, the way a field kind's name does.
  'editor.icon': { en: 'Icon' },
  'editor.iconHelp': { en: 'What it is drawn as in the sidebar and wherever else it is listed' },
  'editor.iconDefault': { en: 'A document, as every resource was' },
  'icons.group.content': { en: 'Content' },
  'icons.group.people': { en: 'People' },
  'icons.group.shop': { en: 'Shop' },
  'icons.group.media': { en: 'Media' },
  'icons.group.world': { en: 'Places and time' },
  'icons.group.signals': { en: 'Signals' },
  'icons.group.structure': { en: 'Structure' },
  'collections.declaredPresentation': {
    en: 'How one is shown — its label, its heading and its icon — is one line in that same declaration: {call}. The order they are listed in, here and in the sidebar, is the order they are registered in.',
  },
} as const satisfies Catalogue
