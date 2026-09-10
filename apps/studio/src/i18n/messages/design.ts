/**
 * The theme screen and the universal design controls a block carries.
 */
import type { Catalogue } from '../catalogue.ts'

export const DESIGN = {
  // --- the seven controls every block carries (SPEC.md §61) -------------------------
  //
  // A token's own name — `lg`, `wide`, `surface` — is never translated: it is what the
  // block stores and what the theme declares, and a Ukrainian word here would name
  // nothing.
  'design.themeDefault': { en: 'Theme default' },
  'design.notInTheme': { en: '{token} — not in the theme' },
  'design.spaceAbove': { en: 'Space above' },
  'design.spaceBelow': { en: 'Space below' },
  'design.width': { en: 'Width' },
  'design.container': { en: 'Container' },
  'design.alignment': { en: 'Alignment' },
  'design.background': { en: 'Background' },
  'design.hiddenOn': { en: 'Hidden on' },
  'design.hiddenOnHelp': { en: 'Responsive visibility. The block stays in the tree' },
  // --- the five groups of tokens (SPEC.md §62) ----------------------------------------
  'design.group.colours': { en: 'Colours' },
  'design.group.coloursHelp': {
    en: 'A block names one of these as its background, so this list is the list of backgrounds there are',
  },
  'design.group.fonts': { en: 'Font stacks' },
  'design.group.fontsHelp': {
    en: 'Most preferred family first, ending in a generic family a browser always has',
  },
  'design.group.sizes': { en: 'Type scale' },
  'design.group.sizesHelp': { en: 'The sizes text is set at' },
  'design.group.weights': { en: 'Font weights' },
  'design.group.weightsHelp': { en: '1 to 1000, as a font declares them' },
  'design.group.lineHeights': { en: 'Line heights' },
  'design.group.lineHeightsHelp': {
    en: 'Unitless, so they scale with whatever size they are used at',
  },
  'design.group.spacing': { en: 'Spacing' },
  'design.group.spacingHelp': { en: 'What the space above and below a block means' },
  'design.group.radius': { en: 'Corner radius' },
  'design.group.radiusHelp': { en: 'The corners a site rounds, from square to a pill' },
  'design.group.container': { en: 'Container widths' },
  'design.group.containerHelp': {
    en: 'How wide a block is allowed to be at each of the four widths',
  },
  'design.typography': { en: 'Typography' },
  'design.typographyHelp': {
    en: 'Four maps rather than one, so every entry holds a single kind of value and is checked as that kind',
  },

  // --- the theme screen ------------------------------------------------------------------
  'design.lede': {
    en: 'The tokens every page is drawn from. A block picks a name; this decides what it looks like',
  },
  'design.neverEdited': { en: 'never edited' },
  'design.unsaved': { en: 'unsaved' },
  'design.changed': { en: 'changed' },
  'design.undo': { en: 'Undo' },
  'design.undoQuiet': { en: 'undo' },
  'design.reset': { en: 'Reset' },
  'design.resetTitle': { en: 'Stop overriding it and take the default back' },
  'design.removeTitle': { en: 'Take this token out of the theme' },
  'design.backTo': { en: 'back to {value}' },
  'design.backToDefault': { en: 'back to the default' },
  'design.removedFromTheme': { en: 'removed from the theme' },
  'design.newToken': { en: 'New token' },
  'design.nameTaken': { en: 'The theme already has a token by that name' },
  'design.name.colour': {
    en: 'Lowercase letters, digits and single dashes, opening with a letter',
  },
  'design.name.token': { en: 'Lowercase letters, digits and single dashes' },
  'design.openNames': { en: 'your own names' },
  'design.fixedNames': { en: 'fixed names' },
  'design.fixedNamesWhy': { en: ' — a block names these, so none can be added or removed' },
  'design.unsavedCount': {
    en: { one: '{count} unsaved change', other: '{count} unsaved changes' },
  },
  'design.unsavedTokens': { en: { one: '{count} unsaved token', other: '{count} unsaved tokens' } },
  'design.confirmLeave': { en: 'Your theme changes have not been saved. Leave the screen anyway?' },
  'design.confirmRemoval': {
    en: 'Saving takes {names} out of the theme. A block whose background names one is drawn with no background at all. The change is a revision, so undo puts it back.',
  },
  'design.conflict': {
    en: 'Somebody else has changed the theme since this screen read it. Reloading takes their version and drops the changes listed below.',
  },
  'design.readOnly': {
    en: 'You can read the theme but not change it. Editing needs the {permission} permission.',
  },
  'design.noTheme': { en: 'This application has no theme' },
  'design.noThemeBody': {
    en: 'Add {call} to its modules and the five groups of tokens appear here.',
  },
  'design.previewNote': {
    en: 'Drawn from the tokens above, under the names the generated stylesheet declares — {groups} groups, {tokens} tokens.',
  },
  'design.lastSaved': { en: 'Last saved {when}.' },
  // --- the sample the tokens are drawn on -----------------------------------------------
  'preview.heading': { en: 'A page heading' },
  'preview.body': {
    en: 'Body text, at the size and line height the theme decides. A block never says any of this: it names a token, and this answers.',
  },
  'preview.sunken': { en: 'A sunken surface, the way a card sits on a page.' },
  'preview.button': { en: 'A button' },
  // `{step}` is a token name — `sm`, `2xl` — and stays as the theme wrote it.
  'preview.spaceStep': { en: 'space above and below: {step}' },
  'preview.corners': { en: 'Corners' },
  'preview.everyColour': { en: 'Every colour' },
  'preview.stylesheet': {
    en: 'The stylesheet this renders to is served under {version}, which changes when and only when the CSS does — so a cached copy is never the wrong one.',
  },

  // --- the token inputs -----------------------------------------------------------------
  'inputs.unit': { en: 'Unit' },
  'inputs.moveEarlier': { en: 'Move {name} earlier' },
  'inputs.addFamily': { en: 'Add a family, such as Inter or sans-serif' },
  'design.didNotWork': { en: 'That did not work' },
  'design.themeShort': { en: 'theme' },
  'design.sevenControls': {
    en: 'Seven controls every block has. The values are theme tokens — what `lg` means is the theme’s answer, not this panel’s.',
  },
  'design.containerHelp': { en: 'Ignored when the width is full.' },
  'design.backgroundHelp': { en: 'Only colours the theme declares.' },
} as const satisfies Catalogue
