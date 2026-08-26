/**
 * Seven blocks, and the composition rules between them (SPEC.md §55, §56).
 *
 * A block declaration says what a block *is*. What it looks like is `app/blocks.tsx`,
 * and how much room it takes is not here at all: spacing, width, alignment,
 * background, container and responsive visibility are the universal controls every
 * block gets for free (SPEC.md §61), and `app/theme.css` decides what each token
 * means.
 *
 * Everything a marketing site actually varies — a headline, a link, three columns of
 * copy — is a field below. Everything it varies *visually* is a token. There is
 * deliberately no way from either to a stylesheet.
 */
import { block } from '@assemora/pages'
import { richText, select, text } from '@assemora/resources'

export const Hero = block(
  'hero',
  {
    headline: text().required().label('Headline'),
    subhead: text().label('Subhead'),
    image: text().label('Image').help('A path in this site’s bundle, or an absolute URL'),
    action: text().label('Button label'),
    href: text().label('Button link'),
    variant: select('centered', 'split').required().label('Layout'),
  },
  { label: 'Hero', description: 'The top of a page' },
)

/**
 * The block that holds other blocks (SPEC.md §56).
 *
 * `allowedChildren` is what turns a builder from a free-for-all into a design system:
 * a hero cannot be dropped inside a section, and the refusal comes from this
 * declaration rather than from anything Studio knows. `maxChildren` is the other half
 * — a row of features stops being a row at some number, and that number belongs to
 * whoever designed the block.
 */
export const Section = block(
  'section',
  {
    heading: text().label('Heading'),
    lede: text().label('Intro'),
    columns: select('one', 'two', 'three').label('Columns'),
  },
  {
    label: 'Section',
    description: 'Groups other blocks',
    acceptsChildren: true,
    allowedChildren: ['feature', 'prose', 'cta', 'team', 'openings'],
    maxChildren: 12,
  },
)

export const Feature = block(
  'feature',
  {
    title: text().required().label('Title'),
    body: richText().required().label('Body'),
    icon: select('spark', 'shield', 'graph').label('Icon'),
  },
  { label: 'Feature', description: 'One point, inside a section' },
)

export const Prose = block(
  'prose',
  { body: richText().required().label('Text') },
  { label: 'Prose', description: 'A few paragraphs' },
)

export const Cta = block(
  'cta',
  {
    title: text().required().label('Title'),
    label: text().required().label('Button label'),
    href: text().required().label('Button link'),
  },
  { label: 'Call to action' },
)

/**
 * Two blocks whose content is not in their props.
 *
 * They carry a heading and nothing else; the people and the roles are read at render
 * time from the public routes in `src/routes.ts`. A team pasted into a page tree is
 * wrong the first time somebody joins, and no editor is watching for that.
 */
export const TeamGrid = block(
  'team',
  { heading: text().label('Heading') },
  { label: 'Team', description: 'Everybody currently on the site' },
)

export const OpenRoles = block(
  'openings',
  { heading: text().label('Heading') },
  { label: 'Open roles', description: 'Roles currently open, read live' },
)

export const siteBlocks = [Hero, Section, Feature, Prose, Cta, TeamGrid, OpenRoles] as const
