/**
 * What a block *is* (SPEC.md §55).
 *
 * Fields, validation and the form Studio draws — and deliberately nothing about
 * appearance, which belongs to `app/site.tsx` and changes without a stored page being
 * touched.
 */
import { block } from '@assemora/pages'
import { number, relation, richText, text } from '@assemora/resources'

export const Hero = block(
  'hero',
  {
    title: text().required().label('Headline'),
    subtitle: text().label('Standfirst'),
  },
  { label: 'Hero', description: 'The top of a page' },
)

export const Prose = block(
  'prose',
  { body: richText().required().label('Text') },
  { label: 'Prose', description: 'A few paragraphs' },
)

/**
 * A block whose content is not in its props.
 *
 * The editor chooses a category and a length; the articles themselves are read at
 * render time from `GET /api/blog/articles`. That is what keeps a page a *layout*:
 * copying the ten current articles into the tree would freeze them there, and every
 * later article would be missing from a page nobody thought to edit.
 */
export const ArticleList = block(
  'articleList',
  {
    heading: text().label('Heading'),
    category: relation('categories').label('Category').help('Empty means every category'),
    limit: number().label('How many').help('Up to twenty'),
  },
  { label: 'Article list', description: 'The latest published articles, read live' },
)

export const blogBlocks = [Hero, Prose, ArticleList] as const
