/**
 * Pages, the block builder and a page's history.
 */
import type { Catalogue } from '../catalogue.ts'

export const PAGES = {
  // --- pages, before there are any ---------------------------------------------
  'pages.new': { en: 'New page' },
  'pages.blank.noMatch': { en: 'No page matches that' },
  'pages.blank.tryAnother': { en: 'Try another word, or set the status back to any.' },
  'pages.blank.first': { en: 'Make your first page' },
  'pages.blank.what': {
    en: 'A page is a tree of blocks at an address — {about}, {pricing} — never a document of HTML.',
  },
  'pages.blank.then': {
    en: 'You put blocks on it in the builder, and publishing decides what a visitor sees. Until then it is a draft only you can open.',
  },

  // --- the block palette, which Studio may not fill ------------------------------
  'blocks.blank.title': { en: 'No blocks yet' },
  'blocks.blank.declared': {
    en: 'A block is a TypeScript declaration, so it is written in your project, not here.',
  },
  'blocks.blank.register': {
    en: 'That writes {file}. Register it with {call}, give it a view in your frontend, and it appears in this list.',
  },
  // --- the page list ---------------------------------------------------------------
  'pages.create': { en: 'Create page' },
  'pages.createFailed': { en: 'Could not create it' },
  'pages.title': { en: 'Title' },
  'pages.slug': { en: 'Slug' },
  'pages.slugHelp': { en: 'Where the page lives on the site' },
  'pages.search': { en: 'Search pages' },
  'pages.statusLabel': { en: 'Status' },
  'pages.anyStatus': { en: 'Any status' },
  'pages.status.draft': { en: 'Draft' },
  'pages.status.published': { en: 'Published' },
  'pages.status.archived': { en: 'Archived' },
  'pages.version': { en: 'Version' },
  'pages.updated': { en: 'Updated' },
  'pages.openBuilder': { en: 'Open builder' },
  'pages.pageCount': { en: { one: '{count} page', other: '{count} pages' } },
  // --- revision history --------------------------------------------------------------
  //
  // A block's `{type}` is the name its TypeScript declaration was given — `hero`, and
  // never a word Studio knows. It is quoted rather than declined, for the reason the
  // entry blanks are.
  'history.actor.person': { en: 'Person' },
  'history.actor.agent': { en: 'Agent' },
  'history.actor.token': { en: 'API token' },
  'history.actor.unknown': { en: 'Unknown' },
  'history.kind.undo': { en: 'undo' },
  'history.kind.redo': { en: 'redo' },
  'history.kind.restore': { en: 'restore' },
  'history.tree.added': { en: 'Added a {type}' },
  'history.tree.removed': { en: 'Removed a {type}' },
  'history.tree.moved': { en: 'Moved the {type}' },
  'history.tree.changed': { en: 'Changed the {type}: {fields}' },
  'history.tree.hidden': { en: 'Hid or showed the {type}' },
  'history.tree.restyled': { en: 'Restyled the {type}' },
  'history.backToBuilder': { en: 'Back to builder' },
  'history.comparing': { en: 'Comparing two revisions' },
  'history.noDifference': { en: 'Nothing differs between them.' },
  'history.nothingYet': { en: 'Nothing has happened yet' },
  'history.nothingChanged': { en: 'Nothing changed.' },
  'history.compare': { en: 'Compare' },
  'history.restore': { en: 'Restore' },
  'history.confirmRestore': { en: 'Put the page back the way it was at this revision?' },
  'history.revisionCount': { en: { one: '{count} revision', other: '{count} revisions' } },
  'history.newer': { en: 'Newer' },
  'history.older': { en: 'Older' },
  // --- the rich text strip, which is structure and nothing else ---------------------
  'richText.heading': { en: 'Heading' },
  'richText.subheading': { en: 'Subheading' },
  'richText.bold': { en: 'Bold' },
  'richText.italic': { en: 'Italic' },
  'richText.bullets': { en: 'Bulleted list' },
  'richText.numbers': { en: 'Numbered list' },
  'richText.quote': { en: 'Quote' },
  'richText.link': { en: 'Link' },
  'richText.unlink': { en: 'Remove link' },
  'richText.image': { en: 'Image' },
  // --- the canvas ---------------------------------------------------------------------
  'canvas.preview': { en: 'Page preview' },
  'canvas.addHere': { en: 'Add a block here' },
  'canvas.noBlocks': { en: 'This application declares no blocks' },
  'canvas.containerFull': { en: 'The {type} block will not take anything more' },
  'canvas.nothingFits': { en: 'Nothing can go on this page yet' },
  'canvas.nothingFitsBody': {
    en: 'This application declares no block types. A block is a TypeScript declaration, so Studio cannot make one — the Blocks panel on the left has the command that can.',
  },
  'canvas.empty': { en: 'This page has nothing on it yet' },
  'canvas.emptyBody': { en: 'Every page is a tree of blocks. Put the first one in.' },
  'builder.viewport.desktop': { en: 'Desktop' },
  'builder.viewport.tablet': { en: 'Tablet' },
  'builder.viewport.mobile': { en: 'Mobile' },
  // --- the builder's own chrome --------------------------------------------------------
  'builder.cannotOpen': { en: 'This page could not be opened' },
  'builder.noAnswer': { en: 'The application did not answer.' },
  'builder.backToPages': { en: 'Back to Pages' },
  'builder.unpublished': { en: 'unpublished changes' },
  // The shortcut is part of the label, and the keys are the same on every keyboard.
  'builder.undo': { en: 'Undo (⌘Z)' },
  'builder.redo': { en: 'Redo (⌘⇧Z)' },
  'builder.preview': { en: 'Preview' },
  'builder.publish': { en: 'Publish' },
  'builder.conflict': { en: 'Someone else has changed this page since you opened it' },
  'builder.conflictBody': {
    en: 'Reloading takes their version. Nothing here has been written over.',
  },
  'builder.reload': { en: 'Reload' },
  'builder.notReady': { en: 'This page is not ready to be published' },
  'builder.draftSaved': { en: 'Draft saved · not published' },
  // The version goes over as a string: it is a label on a build, not a quantity, so a
  // language that groups thousands must not turn v1024 into v1,024.
  'builder.published': { en: 'Published · v{version}' },
  // --- the rail beside the canvas --------------------------------------------------
  'palette.rail': { en: 'Rail' },
  'palette.outline': { en: 'Outline' },
  'palette.blocks': { en: 'Blocks' },
  'palette.beside': { en: 'beside' },
  'palette.inside': { en: 'inside' },
  'palette.emptyPage': { en: 'This page is empty' },
  'palette.emptyPageBody': { en: 'Open Blocks and choose one, or use a + on the page.' },
  // --- the inspector -----------------------------------------------------------------
  'properties.inspector': { en: 'Inspector' },
  'properties.content': { en: 'Content' },
  'properties.design': { en: 'Design' },
  'properties.hidden': { en: 'hidden' },
  'properties.noFields': { en: 'This block has no fields.' },
  'properties.duplicate': { en: 'Add a copy beside this block' },
  'properties.indent': { en: 'Move inside the block above' },
  'properties.outdent': { en: 'Move out of its container' },
  'properties.show': { en: 'Show this block' },
  'properties.hide': { en: 'Hide this block' },
  'properties.moveUp': { en: 'Move up' },
  'properties.moveDown': { en: 'Move down' },
  'properties.nothingSelected': { en: 'Nothing selected' },
} as const satisfies Catalogue
