/**
 * The frame around every screen: the chrome bar, the sidebar, the command palette, the account menu and the sign-in form.
 */
import type { Catalogue } from '../catalogue.ts'

export const CHROME = {
  // --- the first screen of an application with nothing in it ---------------------
  'start.collection.title': { en: 'Describe some content' },
  'start.collection.body': {
    en: 'A collection is a kind of content named and shaped here rather than in TypeScript. Once it exists it is a resource like any other — a screen, the same policies, and a tool an agent can call.',
  },
  'start.page.title': { en: 'Build a page' },
  'start.page.body': {
    en: 'A page is a tree of blocks at an address. The builder puts blocks on it; publishing decides what a visitor sees.',
  },
  'start.page.go': { en: 'Go to pages' },
  'start.block.title': { en: 'Declare a block' },
  'start.block.body': {
    en: 'Blocks are what a page is built from, and each one is a TypeScript declaration — so this is the step Studio cannot do for you.',
  },
  // --- the sidebar and the rail --------------------------------------------------
  //
  // A resource's own name is not here: it comes from the registry, in whatever language
  // the application declared it in. These are the headings Studio puts around them.
  'nav.dashboard': { en: 'Dashboard' },
  'nav.content': { en: 'Content' },
  'nav.collections': { en: 'Collections' },
  'nav.manageCollections': { en: 'Manage collections' },
  'nav.media': { en: 'Media' },
  'nav.pages': { en: 'Pages' },
  'nav.allPages': { en: 'All pages' },
  'nav.design': { en: 'Design' },
  'nav.theme': { en: 'Theme' },
  'nav.ai': { en: 'AI' },
  'nav.proposals': { en: 'Proposals' },
  'nav.settings': { en: 'Settings' },
  'nav.users': { en: 'Users' },
  'nav.developer': { en: 'Developer' },

  // --- the bar across the top ----------------------------------------------------
  'chrome.expandSidebar': { en: 'Expand the sidebar' },
  'chrome.collapseSidebar': { en: 'Collapse the sidebar' },
  'chrome.notifications': { en: 'Notifications' },

  // --- the breadcrumb, for the two segments that are not a section ---------------
  'crumb.new': { en: 'New' },
  'crumb.history': { en: 'History' },

  // --- the account menu ----------------------------------------------------------
  'account.menu': { en: 'Account' },
  // Two different questions, said in each language the way that language says them: the
  // content one names the thing being edited, the interface one names Studio itself.
  'account.editingIn': { en: 'Editing in' },
  'account.interface': { en: 'Studio language' },
  'account.signOut': { en: 'Sign out' },
  // --- the command palette --------------------------------------------------------
  'palette.label': { en: 'Search Studio' },
  'palette.placeholder': { en: 'Search collections, pages, settings…' },
  'palette.nothing': { en: 'Nothing matches “{query}”.' },
  'palette.overview': { en: 'Overview' },
  'palette.library': { en: 'Library' },
  // --- signing in ------------------------------------------------------------------
  'login.title': { en: 'Sign in to Studio' },
  'login.lede': { en: 'Editors, reviewers and owners use the same door.' },
  'login.email': { en: 'Email' },
  'login.password': { en: 'Password' },
  'login.show': { en: 'Show the password' },
  'login.hide': { en: 'Hide the password' },
  'login.submit': { en: 'Sign in' },
  'login.busy': { en: 'Signing in…' },
  'login.trouble': { en: 'Trouble signing in? A workspace owner can re-send your invite.' },
  // The one sentence a login screen must say the same way for both answers: an address
  // nobody has and a password that is wrong (SPEC.md §86).
  'login.mismatch': { en: 'That email and password do not match.' },
  'login.failed': { en: 'Could not sign in. Please try again.' },

  // What the dark panel says: facts about the framework, never about this deployment.
  'login.claim': { en: 'The content layer your build already trusts.' },
  'login.claimBody': {
    en: 'One declaration produces the editor, the API and the types. Nothing drifts, because nothing is written twice.',
  },
  'login.fact.mutations': { en: 'Mutations' },
  'login.fact.mutationsValue': { en: 'One path' },
  'login.fact.schema': { en: 'Schema' },
  'login.fact.schemaValue': { en: 'One source' },
  'login.fact.clients': { en: 'Clients' },
  'login.fact.clientsValue': { en: 'Four' },
  // --- the first screen ------------------------------------------------------------
  'dashboard.fresh': { en: 'Nothing has been made here yet' },
  'dashboard.declares': { en: 'What this application declares' },
  'dashboard.wired': { en: 'Already wired up for you' },
  'dashboard.resources': { en: 'Resources' },
  'dashboard.models': { en: 'Models' },
  'dashboard.commands': { en: 'Commands' },
  'dashboard.endpoints': { en: 'Endpoints' },
  'dashboard.blocks': { en: 'Blocks' },
  'dashboard.fieldCount': { en: { one: '{count} field', other: '{count} fields' } },
} as const satisfies Catalogue
